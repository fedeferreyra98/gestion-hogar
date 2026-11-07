package ar.hogar.purchase

import ar.hogar.auth.HouseholdRepository
import ar.hogar.auth.MemberRepository
import ar.hogar.catalog.Product
import ar.hogar.catalog.ProductRepository
import ar.hogar.common.CurrencyPolicy
import ar.hogar.common.FieldError
import ar.hogar.common.Money
import ar.hogar.common.NotFoundException
import ar.hogar.common.PageRequests
import ar.hogar.common.PageResponse
import ar.hogar.common.ValidationException
import ar.hogar.common.toPageResponse
import ar.hogar.expense.ExpenseService
import ar.hogar.shopping.MoneyDto
import ar.hogar.shopping.RefDto
import ar.hogar.shopping.ShoppingService
import ar.hogar.stock.StockService
import org.springframework.data.domain.Sort
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDate
import java.util.Currency
import java.util.UUID

/**
 * UC-13/14/22. [completeList] y [create] corren en una única transacción (ADR-007): compra, ítems, gasto,
 * lotes de stock y estado de la lista se persisten juntos o no se persiste nada.
 */
@Service
class PurchaseService(
    private val purchases: PurchaseRepository,
    private val purchaseItems: PurchaseItemRepository,
    private val shopping: ShoppingService,
    private val expenses: ExpenseService,
    private val stock: StockService,
    private val products: ProductRepository,
    private val households: HouseholdRepository,
    private val members: MemberRepository,
    private val clock: java.time.Clock,
) {
    /** Línea ya validada: producto resuelto y total de la línea calculado en unidades menores. */
    private class Line(
        val input: PurchaseItemInput,
        val product: Product,
        val totalMinor: Long,
        /** Vencimiento del lote: el informado o `purchaseDate + defaultShelfLifeDays`; ya validado. */
        val stockExpiry: LocalDate?,
    )

    private companion object {
        val MIN_PURCHASE_DATE: LocalDate = LocalDate.of(1900, 1, 1)
        val MAX_PURCHASE_DATE: LocalDate = LocalDate.of(2100, 12, 31)
    }

    @Transactional
    fun completeList(
        householdId: UUID,
        memberId: UUID,
        listId: UUID,
        req: CompleteListRequest,
    ): PurchaseDto {
        // El lock serializa dos "completar" simultáneos: el segundo ve la lista COMPLETED → 422 LIST_NOT_OPEN.
        val list = shopping.lockOpenList(householdId, listId)
        val listItems = shopping.itemsOf(list.id)
        val listItemsById = listItems.associateBy { it.id }
        val referenced = req.items!!.mapNotNull { it.listItemId }
        if (referenced.size != referenced.toSet().size || !listItemsById.keys.containsAll(referenced)) {
            throw ValidationException(
                "Invalid list items",
                listOf(FieldError("items.listItemId", "must be distinct items of this list")),
            )
        }
        // Un ítem de la lista se compra con su mismo producto (no se sustituye en silencio).
        req.items.forEachIndexed { index, item ->
            val listed = item.listItemId?.let { listItemsById.getValue(it) }
            if (listed != null && listed.productId != item.productId) {
                throw ValidationException(
                    "Invalid list items",
                    listOf(FieldError("items[$index].productId", "must match the product of the list item")),
                )
            }
        }
        val purchase =
            register(
                householdId = householdId,
                memberId = memberId,
                listId = list.id,
                store = req.store.clean(),
                fallbackName = list.name,
                date = req.purchaseDate!!,
                paidBy = req.paidBy!!,
                total = req.total!!,
                items = req.items.map { it.toInput() },
            )
        shopping.markCompleted(list)
        if (req.leftoverAction == LeftoverAction.NEW_LIST) {
            // Pendientes = ítems sin tildar que no se compraron; una lista sin pendientes no genera lista nueva.
            val pending = listItems.filter { !it.checked && it.id !in referenced }
            if (pending.isNotEmpty()) shopping.createLeftoverList(householdId, memberId, list, pending)
        }
        return purchase
    }

    @Transactional
    fun create(
        householdId: UUID,
        memberId: UUID,
        req: CreatePurchaseRequest,
    ): PurchaseDto =
        register(
            householdId = householdId,
            memberId = memberId,
            listId = null,
            store = req.store.clean(),
            fallbackName = null,
            date = req.purchaseDate!!,
            paidBy = req.paidBy!!,
            total = req.total!!,
            items = req.items!!,
        )

    @Transactional(readOnly = true)
    fun get(
        householdId: UUID,
        id: UUID,
    ): PurchaseDto = toDto(purchase(householdId, id))

    @Transactional(readOnly = true)
    fun search(
        householdId: UUID,
        from: LocalDate?,
        to: LocalDate?,
        store: String?,
        page: Int?,
        size: Int?,
        sort: String?,
    ): PageResponse<PurchaseSummaryDto> {
        if (from != null && to != null && from.isAfter(to)) {
            throw ValidationException("Invalid range", listOf(FieldError("from", "must not be after to")))
        }
        val pageable =
            PageRequests.of(
                page,
                size,
                sort,
                setOf("purchaseDate", "totalMinor", "createdAt"),
                Sort.by(Sort.Order.desc("purchaseDate"), Sort.Order.desc("createdAt"), Sort.Order.asc("id")),
            )
        val pattern =
            store
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?.let {
                    "%" +
                        it
                            .lowercase()
                            .replace("\\", "\\\\")
                            .replace("%", "\\%")
                            .replace("_", "\\_") + "%"
                }
        val result = purchases.search(householdId, from, to, pattern, pageable)
        val payers = memberRefs(result.content.map { it.paidBy })
        return result.toPageResponse {
            PurchaseSummaryDto(
                it.id,
                it.store,
                it.purchaseDate,
                MoneyDto(it.totalMinor, it.currency.trim()),
                it.itemCount.toInt(),
                payers.getValue(it.paidBy),
            )
        }
    }

    /**
     * Edita la cabecera, reemplaza los ítems y recalcula el gasto asociado. Los lotes de stock ya creados no se
     * tocan (reflejan lo que hay en la alacena, que pudo consumirse): quedan desvinculados del ítem reemplazado.
     */
    @Transactional
    fun update(
        householdId: UUID,
        id: UUID,
        req: UpdatePurchaseRequest,
    ): PurchaseDto {
        val purchase =
            purchases.findWithLockByIdAndHouseholdId(id, householdId)
                ?: throw NotFoundException("Purchase not found")
        // `store` ausente = sin cambios; en blanco se rechaza (no se puede borrar el comercio).
        val store =
            if (req.store == null) {
                purchase.store
            } else {
                req.store.clean()
                    ?: throw ValidationException("Invalid store", listOf(FieldError("store", "must not be blank")))
            }
        val date = validDate(req.purchaseDate ?: purchase.purchaseDate)
        val paidBy = req.paidBy ?: purchase.paidBy
        val total =
            req.total?.let { validatedTotal(householdId, it) }
                ?: Money.of(purchase.totalMinor, purchase.currency.trim())
        requirePayer(householdId, paidBy, currentPayer = purchase.paidBy)
        val lines = lines(householdId, date, req.items!!)

        purchaseItems.deleteByPurchase(purchase.id)
        insertItems(purchase.id, lines)

        purchase.store = store
        purchase.purchaseDate = date
        purchase.paidBy = paidBy
        purchase.totalMinor = total.amountMinor
        purchase.currency = total.currency.currencyCode
        purchase.updatedAt = clock.instant()
        purchases.saveAndFlush(purchase)
        val fallbackName = purchase.shoppingListId?.let { shopping.nameOf(householdId, it) }
        expenses.updateFromPurchase(
            householdId,
            purchase.expenseId,
            description(store, fallbackName),
            total,
            date,
            paidBy,
        )
        return toDto(purchase)
    }

    // ---- helpers ----

    private fun register(
        householdId: UUID,
        memberId: UUID,
        listId: UUID?,
        store: String?,
        fallbackName: String?,
        date: LocalDate,
        paidBy: UUID,
        total: MoneyDto,
        items: List<PurchaseItemInput>,
    ): PurchaseDto {
        val money = validatedTotal(householdId, total)
        validDate(date)
        requirePayer(householdId, paidBy, currentPayer = null)
        val lines = lines(householdId, date, items)
        val now = clock.instant()

        val expenseId =
            expenses.createFromPurchase(householdId, memberId, description(store, fallbackName), money, date, paidBy)
        val purchase =
            purchases.saveAndFlush(
                Purchase(
                    id = UUID.randomUUID(),
                    householdId = householdId,
                    shoppingListId = listId,
                    store = store,
                    purchaseDate = date,
                    totalMinor = money.amountMinor,
                    currency = money.currency.currencyCode,
                    paidBy = paidBy,
                    expenseId = expenseId,
                    createdBy = memberId,
                    createdAt = now,
                    updatedAt = now,
                ),
            )
        val saved = insertItems(purchase.id, lines)
        // Vencimiento: el informado o, si falta, fecha de compra + vida útil por defecto del producto.
        lines.zip(saved).forEach { (line, item) ->
            stock.addPurchased(
                householdId,
                memberId,
                line.product.id,
                item.quantity,
                item.unit,
                line.stockExpiry,
                item.id,
            )
        }
        return toDto(purchase)
    }

    private fun insertItems(
        purchaseId: UUID,
        lines: List<Line>,
    ): List<PurchaseItem> =
        purchaseItems.saveAllAndFlush(
            lines.mapIndexed { index, it ->
                PurchaseItem(
                    id = UUID.randomUUID(),
                    purchaseId = purchaseId,
                    position = index,
                    productId = it.product.id,
                    quantity = it.input.quantity!!.setScale(3),
                    unit = it.input.unit!!,
                    unitPriceMinor = it.input.unitPrice!!.amountMinor!!,
                    totalMinor = it.totalMinor,
                    expiryDate = it.input.expiryDate,
                )
            },
        )

    /** Valida producto (del hogar), moneda y calcula `total = round(quantity × unitPrice)` sin floats (ADR-004). */
    private fun lines(
        householdId: UUID,
        date: LocalDate,
        inputs: List<PurchaseItemInput>,
    ): List<Line> {
        val policy = currencyPolicy(householdId)
        val byId =
            products
                .findAllById(inputs.map { it.productId!! }.toSet())
                .filter { it.householdId == householdId }
                .associateBy { it.id }
        return inputs.mapIndexed { index, input ->
            val product = byId[input.productId] ?: throw NotFoundException("Product not found")
            val price = Money.of(input.unitPrice!!.amountMinor!!, input.unitPrice.currency!!)
            policy.requireSupported(price)
            val total =
                try {
                    input.quantity!!
                        .multiply(BigDecimal.valueOf(price.amountMinor))
                        .setScale(0, RoundingMode.HALF_UP)
                        .longValueExact()
                } catch (_: ArithmeticException) {
                    throw ValidationException(
                        "Invalid item total",
                        listOf(FieldError("items[$index].unitPrice", "quantity × unitPrice is too large")),
                    )
                }
            Line(input, product, total, expiry(index, date, input, product))
        }
    }

    /** Vencimiento del lote; uno fuera de rango (informado o calculado) → 400 sobre el ítem, nunca un 500. */
    private fun expiry(
        index: Int,
        date: LocalDate,
        input: PurchaseItemInput,
        product: Product,
    ): LocalDate? {
        input.expiryDate?.let {
            stock.checkExpiryRange(it)
            return it
        }
        val days = product.defaultShelfLifeDays ?: return null
        val computed =
            try {
                date.plusDays(days.toLong()).also(stock::checkExpiryRange)
            } catch (_: java.time.DateTimeException) {
                null
            } catch (_: ValidationException) {
                null
            }
        return computed
            ?: throw ValidationException(
                "Invalid expiry",
                listOf(
                    FieldError("items[$index].expiryDate", "default shelf life is out of range; provide expiryDate"),
                ),
            )
    }

    private fun validDate(date: LocalDate): LocalDate {
        if (date.isBefore(MIN_PURCHASE_DATE) || date.isAfter(MAX_PURCHASE_DATE)) {
            throw ValidationException(
                "Invalid purchaseDate",
                listOf(FieldError("purchaseDate", "must be between $MIN_PURCHASE_DATE and $MAX_PURCHASE_DATE")),
            )
        }
        return date
    }

    /** Total > 0 (400) y en la moneda del hogar (422 `UNSUPPORTED_CURRENCY`). */
    private fun validatedTotal(
        householdId: UUID,
        dto: MoneyDto,
    ): Money {
        val money = Money.of(dto.amountMinor!!, dto.currency!!)
        if (money.amountMinor <= 0) {
            throw ValidationException("Invalid total", listOf(FieldError("total.amountMinor", "must be > 0")))
        }
        currencyPolicy(householdId).requireSupported(money)
        return money
    }

    private fun currencyPolicy(householdId: UUID): CurrencyPolicy {
        val household = households.findById(householdId).orElseThrow { NotFoundException("Household not found") }
        return CurrencyPolicy(Currency.getInstance(household.baseCurrency.trim()))
    }

    /** El pagador debe ser miembro activo del hogar (o seguir siendo el actual al editar una compra vieja). */
    private fun requirePayer(
        householdId: UUID,
        paidBy: UUID,
        currentPayer: UUID?,
    ) {
        val ok =
            members.findById(paidBy).filter { it.householdId == householdId && (it.active || paidBy == currentPayer) }
        if (ok.isEmpty) {
            throw ValidationException("Invalid payer", listOf(FieldError("paidBy", "must be an active member")))
        }
    }

    private fun description(
        store: String?,
        fallbackName: String?,
    ): String = ("Compra " + (store ?: fallbackName).orEmpty()).trim()

    private fun purchase(
        householdId: UUID,
        id: UUID,
    ): Purchase = purchases.findByIdAndHouseholdId(id, householdId) ?: throw NotFoundException("Purchase not found")

    private fun memberRefs(ids: Collection<UUID>): Map<UUID, MemberRefDto> =
        members.findAllById(ids.toSet()).associate { it.id to MemberRefDto(it.id, it.displayName) }

    private fun toDto(purchase: Purchase): PurchaseDto {
        val items = purchaseItems.findByPurchase(purchase.id)
        val names = products.findAllById(items.map { it.productId }.toSet()).associate { it.id to it.name }
        val currency = purchase.currency.trim()
        return PurchaseDto(
            id = purchase.id,
            shoppingListId = purchase.shoppingListId,
            store = purchase.store,
            purchaseDate = purchase.purchaseDate,
            total = MoneyDto(purchase.totalMinor, currency),
            paidBy = memberRefs(listOf(purchase.paidBy)).getValue(purchase.paidBy),
            expenseId = purchase.expenseId,
            items =
                items.map {
                    PurchaseItemDto(
                        id = it.id,
                        product = RefDto(it.productId, names.getValue(it.productId)),
                        quantity = it.quantity,
                        unit = it.unit,
                        unitPrice = MoneyDto(it.unitPriceMinor, currency),
                        total = MoneyDto(it.totalMinor, currency),
                        expiryDate = it.expiryDate,
                    )
                },
        )
    }

    private fun String?.clean(): String? = this?.trim()?.takeIf { it.isNotEmpty() }
}
