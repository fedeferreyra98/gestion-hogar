package ar.hogar.shopping

import ar.hogar.auth.HouseholdRepository
import ar.hogar.catalog.Product
import ar.hogar.catalog.ProductRepository
import ar.hogar.common.BusinessRuleException
import ar.hogar.common.ConflictException
import ar.hogar.common.CurrencyPolicy
import ar.hogar.common.FieldError
import ar.hogar.common.Money
import ar.hogar.common.NotFoundException
import ar.hogar.common.PageRequests
import ar.hogar.common.PageResponse
import ar.hogar.common.ValidationException
import ar.hogar.common.toPageResponse
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.domain.Sort
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.math.BigDecimal
import java.time.Clock
import java.util.UUID

private const val MAX_NAME = 160
private const val COPY_SUFFIX = " (copia)"
private const val LEFTOVER_SUFFIX = " (pendientes)"

/** UC-10, UC-11, UC-15: listas de compra. Solo una lista `OPEN` admite cambios. */
@Service
class ShoppingService(
    private val lists: ShoppingListRepository,
    private val items: ShoppingListItemRepository,
    private val products: ProductRepository,
    private val households: HouseholdRepository,
    private val clock: Clock,
) {
    @Transactional(readOnly = true)
    fun list(
        householdId: UUID,
        status: ShoppingListStatus?,
        page: Int?,
        size: Int?,
        sort: String?,
    ): PageResponse<ShoppingListSummaryDto> {
        val pageable =
            PageRequests.of(page, size, sort, setOf("createdAt", "name"), Sort.by(Sort.Direction.DESC, "createdAt"))
        return lists.summaries(householdId, status, pageable).toPageResponse {
            ShoppingListSummaryDto(
                it.id,
                it.name,
                it.status,
                it.itemCount.toInt(),
                it.checkedCount.toInt(),
                it.createdAt,
            )
        }
    }

    @Transactional
    fun create(
        householdId: UUID,
        memberId: UUID,
        req: ShoppingListInput,
    ): ShoppingListDto = newList(householdId, memberId, req.name.trim()).toDto(emptyList())

    @Transactional(readOnly = true)
    fun get(
        householdId: UUID,
        id: UUID,
    ): ShoppingListDto = list(householdId, id).let { it.toDto(items.findByList(it.id)) }

    @Transactional
    fun update(
        householdId: UUID,
        id: UUID,
        req: UpdateShoppingListRequest,
    ): ShoppingListDto {
        val list = lockedList(householdId, id)
        if (req.name == null && req.status == null) return list.toDto(items.findByList(id))
        if (req.status != null && req.status != ShoppingListStatus.ARCHIVED) {
            throw ValidationException("Invalid status", listOf(FieldError("status", "must be ARCHIVED")))
        }
        requireOpen(list)
        req.name?.let { list.name = it.trim() }
        if (req.status != null) list.status = ShoppingListStatus.ARCHIVED
        list.updatedAt = clock.instant()
        return lists.save(list).let { it.toDto(items.findByList(id)) }
    }

    /** Copia los ítems sin tildar (plantilla). Se puede duplicar una lista en cualquier estado. */
    @Transactional
    fun duplicate(
        householdId: UUID,
        memberId: UUID,
        id: UUID,
        req: DuplicateListRequest?,
    ): ShoppingListDto {
        val source = list(householdId, id)
        val copy = newList(householdId, memberId, req?.name?.trim() ?: copyName(source.name))
        val now = clock.instant()
        val copied =
            items.findByList(source.id).filter { !it.checked }.map {
                ShoppingListItem(
                    id = UUID.randomUUID(),
                    listId = copy.id,
                    productId = it.productId,
                    quantity = it.quantity,
                    unit = it.unit,
                    estimatedPriceMinor = it.estimatedPriceMinor,
                    estimatedPriceCurrency = it.estimatedPriceCurrency,
                    note = it.note,
                    createdAt = now,
                    updatedAt = now,
                )
            }
        return items.saveAll(copied).let { copy.toDto(items.findByList(copy.id)) }
    }

    /** Suma la cantidad si ya existe el par producto+unidad (UC-10). */
    @Transactional
    fun addItem(
        householdId: UUID,
        id: UUID,
        req: ShoppingListItemInput,
    ): ShoppingListItemDto {
        val list = lockedList(householdId, id)
        requireOpen(list)
        val product = product(householdId, req.productId!!)
        val price = req.estimatedPrice?.let { validPrice(householdId, it) }
        val unit = req.unit!!
        val quantity = req.quantity!!.setScale(3)
        val now = clock.instant()
        if (quantity >= BigDecimal(MAX_QUANTITY)) throw tooLarge()
        val itemId =
            items.upsertAddingQuantity(
                id = UUID.randomUUID(),
                listId = id,
                productId = product.id,
                quantity = quantity,
                unit = unit.name,
                priceMinor = price?.amountMinor,
                priceCurrency = price?.currency?.currencyCode,
                note = req.note?.trim()?.ifEmpty { null },
                noteProvided = req.note != null,
                now = now,
            ) ?: throw tooLarge()
        return items.findById(itemId).get().toDto(product.name)
    }

    @Transactional
    fun updateItem(
        householdId: UUID,
        id: UUID,
        itemId: UUID,
        req: UpdateShoppingListItemRequest,
    ): ShoppingListItemDto {
        val list = lockedList(householdId, id)
        requireOpen(list)
        val item = item(id, itemId)
        val now = clock.instant()
        req.quantity?.let {
            if (it.setScale(3) >= BigDecimal(MAX_QUANTITY)) throw tooLarge()
            item.quantity = it.setScale(3)
        }
        req.unit?.let { item.unit = it }
        req.estimatedPrice?.let { item.setPrice(validPrice(householdId, it)) }
        req.note?.let { item.note = it.trim().ifEmpty { null } }
        req.checked?.let {
            if (it != item.checked) {
                item.checked = it
                item.checkedAt = if (it) now else null
            }
        }
        item.updatedAt = now
        val saved = flush { items.saveAndFlush(item) }
        return saved.toDto(products.findById(saved.productId).get().name)
    }

    @Transactional
    fun deleteItem(
        householdId: UUID,
        id: UUID,
        itemId: UUID,
    ) {
        requireOpen(lockedList(householdId, id))
        items.delete(item(id, itemId))
    }

    // ---- operaciones internas para la compra (UC-13, BL-108); sin endpoint propio ----

    /** Lista bloqueada para completarla: 404 si no es del hogar, 422 `LIST_NOT_OPEN` si ya no está abierta. */
    @Transactional
    fun lockOpenList(
        householdId: UUID,
        id: UUID,
    ): ShoppingList {
        val list =
            lists.findWithLockByIdAndHouseholdId(id, householdId)
                ?: throw NotFoundException("Shopping list not found")
        requireOpen(list)
        return list
    }

    @Transactional(readOnly = true)
    fun itemsOf(listId: UUID): List<ShoppingListItem> = items.findByList(listId)

    @Transactional(readOnly = true)
    fun nameOf(
        householdId: UUID,
        id: UUID,
    ): String? =
        lists
            .findById(id)
            .orElse(null)
            ?.takeIf { it.householdId == householdId }
            ?.name

    @Transactional
    fun markCompleted(list: ShoppingList) {
        val now = clock.instant()
        list.status = ShoppingListStatus.COMPLETED
        list.completedAt = now
        list.updatedAt = now
        lists.saveAndFlush(list)
    }

    /** Lista nueva `OPEN` con los ítems pendientes de [source] (misma cantidad, unidad, precio estimado y nota). */
    @Transactional
    fun createLeftoverList(
        householdId: UUID,
        memberId: UUID,
        source: ShoppingList,
        pending: List<ShoppingListItem>,
    ): ShoppingList {
        val name = source.name.take(MAX_NAME - LEFTOVER_SUFFIX.length).trimEnd() + LEFTOVER_SUFFIX
        val copy = newList(householdId, memberId, name)
        val now = clock.instant()
        items.saveAll(
            pending.map {
                ShoppingListItem(
                    id = UUID.randomUUID(),
                    listId = copy.id,
                    productId = it.productId,
                    quantity = it.quantity,
                    unit = it.unit,
                    estimatedPriceMinor = it.estimatedPriceMinor,
                    estimatedPriceCurrency = it.estimatedPriceCurrency,
                    note = it.note,
                    createdAt = now,
                    updatedAt = now,
                )
            },
        )
        return copy
    }

    // ---- helpers ----

    private fun newList(
        householdId: UUID,
        memberId: UUID,
        name: String,
    ): ShoppingList {
        val now = clock.instant()
        return lists.saveAndFlush(
            ShoppingList(
                id = UUID.randomUUID(),
                householdId = householdId,
                name = name,
                createdBy = memberId,
                createdAt = now,
                updatedAt = now,
            ),
        )
    }

    private fun list(
        householdId: UUID,
        id: UUID,
    ) = lists.findById(id).orElse(null)?.takeIf { it.householdId == householdId }
        ?: throw NotFoundException("Shopping list not found")

    /**
     * Lista bloqueada (`FOR UPDATE`) para toda mutación: serializa contra "completar" y evita pisar el estado
     * (p. ej. archivar una lista recién completada o agregar un ítem a una lista `COMPLETED`).
     */
    private fun lockedList(
        householdId: UUID,
        id: UUID,
    ) = lists.findWithLockByIdAndHouseholdId(id, householdId) ?: throw NotFoundException("Shopping list not found")

    private fun item(
        listId: UUID,
        itemId: UUID,
    ) = items.findById(itemId).orElse(null)?.takeIf { it.listId == listId }
        ?: throw NotFoundException("Shopping list item not found")

    private fun product(
        householdId: UUID,
        id: UUID,
    ): Product =
        products.findById(id).orElse(null)?.takeIf { it.householdId == householdId }
            ?: throw NotFoundException("Product not found")

    private fun requireOpen(list: ShoppingList) {
        if (list.status != ShoppingListStatus.OPEN) {
            throw BusinessRuleException("LIST_NOT_OPEN", "Shopping list is ${list.status}, not OPEN")
        }
    }

    /** Valida moneda contra la política del hogar (ADR-004). */
    private fun validPrice(
        householdId: UUID,
        dto: MoneyDto,
    ): Money {
        val money = Money.of(dto.amountMinor!!, dto.currency!!)
        val base =
            households
                .findById(
                    householdId,
                ).orElseThrow { NotFoundException("Household not found") }
                .baseCurrency
        CurrencyPolicy(Money.currencyOf(base.trim())).requireSupported(money)
        return money
    }

    private fun ShoppingListItem.setPrice(m: Money) {
        estimatedPriceMinor = m.amountMinor
        estimatedPriceCurrency = m.currency.currencyCode
    }

    /** `"<nombre> (copia)"` truncando el nombre original para respetar el máximo de 160. */
    private fun copyName(name: String): String = name.take(MAX_NAME - COPY_SUFFIX.length).trimEnd() + COPY_SUFFIX

    private fun tooLarge() = BusinessRuleException("BUSINESS_RULE", "Quantity too large")

    /** Carrera entre dos altas del mismo producto+unidad: el índice único responde 409. */
    private fun <T> flush(block: () -> T): T =
        try {
            block()
        } catch (_: DataIntegrityViolationException) {
            throw ConflictException("Item with the same product and unit already exists in the list")
        }

    private fun ShoppingList.toDto(itemList: List<ShoppingListItem>): ShoppingListDto {
        val names =
            products.findAllById(itemList.map { it.productId }.toSet()).associate { it.id to it.name }
        return ShoppingListDto(
            id,
            name,
            status,
            createdBy,
            createdAt,
            completedAt,
            itemList.map { it.toDto(names.getValue(it.productId)) },
        )
    }

    private fun ShoppingListItem.toDto(productName: String) =
        ShoppingListItemDto(
            id,
            RefDto(productId, productName),
            quantity,
            unit,
            estimatedPriceMinor?.let { MoneyDto(it, estimatedPriceCurrency!!.trim()) },
            note,
            checked,
            checkedAt,
        )
}
