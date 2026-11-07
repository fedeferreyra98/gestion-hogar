package ar.hogar.stock

import ar.hogar.auth.HouseholdRepository
import ar.hogar.catalog.CatalogService
import ar.hogar.common.BusinessRuleException
import ar.hogar.common.ConflictException
import ar.hogar.common.FieldError
import ar.hogar.common.NotFoundException
import ar.hogar.common.PageRequests
import ar.hogar.common.PageResponse
import ar.hogar.common.ValidationException
import org.springframework.data.domain.Pageable
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.math.BigDecimal
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

enum class ExpiryFilter { EXPIRED, EXPIRING_SOON, OK }

/** UC-30..34. "Hoy" siempre se calcula con el [Clock] inyectado en la zona horaria del hogar. */
@Service
class StockService(
    private val items: StockItemRepository,
    private val movements: StockMovementRepository,
    private val households: HouseholdRepository,
    private val catalog: CatalogService,
    private val clock: Clock,
) {
    private companion object {
        val MAX_QUANTITY: BigDecimal = BigDecimal("999999999.999")
        val QUANTITY_FORMAT = Regex("""^\d+(\.\d{1,3})?$""")

        // Centinelas de los extremos abiertos de la búsqueda; el rango válido de expiryDate queda adentro,
        // así ningún lote creado por la API puede quedar fuera de EXPIRED/alertas.
        val MIN_DATE: LocalDate = LocalDate.of(1000, 1, 1)
        val MAX_DATE: LocalDate = LocalDate.of(9999, 12, 31)
        val MIN_EXPIRY: LocalDate = LocalDate.of(1900, 1, 1)
        val MAX_EXPIRY: LocalDate = LocalDate.of(2999, 12, 31)
    }

    @Transactional(readOnly = true)
    fun list(
        householdId: UUID,
        productId: UUID?,
        categoryId: UUID?,
        location: String?,
        expiry: ExpiryFilter?,
        status: StockStatus?,
        page: Int?,
        size: Int?,
    ): PageResponse<StockItemDto> {
        // El orden es fijo (FEFO); la query ya ordena, así que el Pageable va sin sort.
        val pageable = PageRequests.of(page, size, null, emptySet())
        val ctx = context(householdId)
        val (min, max) = expiryRange(expiry, ctx)
        val result =
            items.search(
                householdId,
                status ?: StockStatus.ACTIVE,
                productId,
                categoryId,
                location?.trim()?.takeIf { it.isNotEmpty() }?.lowercase(),
                expiry != null,
                min,
                max,
                pageable,
            )
        val dtos = toDtos(householdId, result.content, ctx)
        return PageResponse(dtos, result.number, result.size, result.totalElements, result.totalPages)
    }

    @Transactional
    fun create(
        householdId: UUID,
        memberId: UUID,
        req: CreateStockItemRequest,
    ): StockItemDto {
        val quantity = parseQuantity("quantity", req.quantity, allowZero = false)
        req.expiryDate?.let(::checkExpiryRange)
        catalog.requireProduct(householdId, req.productId!!)
        val now = clock.instant()
        val item =
            items.save(
                StockItem(
                    id = UUID.randomUUID(),
                    householdId = householdId,
                    productId = req.productId,
                    quantity = quantity,
                    initialQuantity = quantity,
                    unit = req.unit!!,
                    expiryDate = req.expiryDate,
                    location = req.location.clean(),
                    addedAt = now,
                    updatedAt = now,
                ),
            )
        movements.save(movement(item.id, MovementType.IN, quantity, memberId))
        return toDtos(householdId, listOf(item), context(householdId)).single()
    }

    /** Alta de un lote por una compra (BL-108): vinculado al ítem de compra, con movimiento `IN`. */
    @Transactional
    fun addPurchased(
        householdId: UUID,
        memberId: UUID,
        productId: UUID,
        quantity: BigDecimal,
        unit: ar.hogar.catalog.Unit,
        expiryDate: LocalDate?,
        purchaseItemId: UUID,
    ) {
        expiryDate?.let(::checkExpiryRange)
        val now = clock.instant()
        val item =
            items.save(
                StockItem(
                    id = UUID.randomUUID(),
                    householdId = householdId,
                    productId = productId,
                    quantity = quantity,
                    initialQuantity = quantity,
                    unit = unit,
                    expiryDate = expiryDate,
                    location = null,
                    purchaseItemId = purchaseItemId,
                    addedAt = now,
                    updatedAt = now,
                ),
            )
        movements.save(movement(item.id, MovementType.IN, quantity, memberId))
    }

    @Transactional
    fun update(
        householdId: UUID,
        memberId: UUID,
        id: UUID,
        req: UpdateStockItemRequest,
    ): StockItemDto {
        // Validar antes de tocar: un body inválido no debe dejar cambios a medias.
        val newQuantity = req.quantity?.let { parseQuantity("quantity", it, allowZero = true) }
        req.expiryDate?.let(::checkExpiryRange)
        // No se puede borrar la ubicación por PATCH (docs/04): vacío o en blanco es inválido.
        if (req.location != null && req.location.isBlank()) {
            throw ValidationException("Invalid location", listOf(FieldError("location", "must not be blank")))
        }
        val item = lockedActive(householdId, id)
        req.expiryDate?.let { item.expiryDate = it }
        req.location?.let { item.location = it.clean() }
        if (newQuantity != null && newQuantity.compareTo(item.quantity) != 0) {
            movements.save(movement(item.id, MovementType.ADJUST, newQuantity - item.quantity, memberId))
            item.quantity = newQuantity
            if (newQuantity.signum() == 0) item.status = StockStatus.CONSUMED
        }
        item.updatedAt = clock.instant()
        return toDtos(householdId, listOf(items.save(item)), context(householdId)).single()
    }

    @Transactional
    fun consumeByProduct(
        householdId: UUID,
        memberId: UUID,
        req: ConsumeByProductRequest,
    ): ConsumeResultDto {
        val quantity = parseQuantity("quantity", req.quantity, allowZero = false)
        catalog.requireProduct(householdId, req.productId!!)
        // Solo lotes de la misma unidad: no hay conversión entre unidades (ver docs/04 §Cambios de contrato).
        val lots = items.lockActive(householdId, req.productId, req.unit!!)
        val allocations =
            Fefo.allocate(lots.map { FefoLot(it.id, it.expiryDate, it.addedAt, it.quantity) }, quantity)
        val byId = lots.associateBy { it.id }
        val now = clock.instant()
        for (a in allocations) {
            val lot = byId.getValue(a.lotId)
            lot.quantity -= a.quantity
            if (a.depleted) lot.status = StockStatus.CONSUMED
            lot.updatedAt = now
            items.save(lot)
            movements.save(movement(lot.id, MovementType.CONSUME, a.quantity, memberId))
        }
        return ConsumeResultDto(allocations.map { ConsumedLotDto(it.lotId, it.quantity.fmt()) })
    }

    @Transactional
    fun consumeItem(
        householdId: UUID,
        memberId: UUID,
        id: UUID,
        req: ConsumeItemRequest,
    ): StockItemDto {
        val quantity = parseQuantity("quantity", req.quantity, allowZero = false)
        val item = lockedActive(householdId, id)
        if (quantity > item.quantity) {
            throw BusinessRuleException("INSUFFICIENT_STOCK", "Only ${item.quantity.fmt()} available in this lot")
        }
        item.quantity -= quantity
        if (item.quantity.signum() == 0) item.status = StockStatus.CONSUMED
        item.updatedAt = clock.instant()
        movements.save(movement(item.id, MovementType.CONSUME, quantity, memberId))
        return toDtos(householdId, listOf(items.save(item)), context(householdId)).single()
    }

    @Transactional
    fun discard(
        householdId: UUID,
        memberId: UUID,
        id: UUID,
        reason: String?,
    ): StockItemDto {
        val item = lockedActive(householdId, id)
        // El remanente se conserva en el lote para estadísticas de desperdicio (UC-33).
        item.status = StockStatus.DISCARDED
        item.discardReason = reason.clean()
        item.updatedAt = clock.instant()
        movements.save(movement(item.id, MovementType.DISCARD, item.quantity, memberId))
        return toDtos(householdId, listOf(items.save(item)), context(householdId)).single()
    }

    @Transactional(readOnly = true)
    fun alerts(householdId: UUID): StockAlertsDto {
        val ctx = context(householdId)

        fun fetch(filter: ExpiryFilter): List<StockItemDto> {
            val (min, max) = expiryRange(filter, ctx)
            val found =
                items.search(householdId, StockStatus.ACTIVE, null, null, null, true, min, max, Pageable.unpaged())
            return toDtos(householdId, found.content, ctx)
        }
        return StockAlertsDto(fetch(ExpiryFilter.EXPIRED), fetch(ExpiryFilter.EXPIRING_SOON))
    }

    @Transactional(readOnly = true)
    fun summary(householdId: UUID): List<StockSummaryRowDto> {
        val rows = items.summarize(householdId)
        val names = catalog.productNames(householdId, rows.map { it[0] as UUID })
        return rows
            .map {
                StockSummaryRowDto(
                    ProductRefDto(it[0] as UUID, names.getValue(it[0] as UUID)),
                    (it[2] as BigDecimal).fmt(),
                    it[1] as ar.hogar.catalog.Unit,
                    it[3] as LocalDate?,
                )
            }.sortedWith(compareBy({ it.product.name.lowercase() }, { it.product.id }, { it.unit.name }))
    }

    // ---- helpers ----

    private class Ctx(
        val today: LocalDate,
        val warningDays: Int,
    )

    private fun context(householdId: UUID): Ctx {
        val household =
            households.findById(householdId).orElseThrow { NotFoundException("Household not found") }
        return Ctx(LocalDate.now(clock.withZone(ZoneId.of(household.timezone))), household.expiryWarningDays)
    }

    /** Rango inclusivo de fechas de cada filtro; extremos abiertos con fechas centinela. */
    private fun expiryRange(
        filter: ExpiryFilter?,
        ctx: Ctx,
    ): Pair<LocalDate, LocalDate> {
        val limit = ctx.today.plusDays(ctx.warningDays.toLong())
        return when (filter) {
            null -> MIN_DATE to MAX_DATE
            ExpiryFilter.EXPIRED -> MIN_DATE to ctx.today.minusDays(1)
            ExpiryFilter.EXPIRING_SOON -> ctx.today to limit
            ExpiryFilter.OK -> limit.plusDays(1) to MAX_DATE
        }
    }

    private fun lockedActive(
        householdId: UUID,
        id: UUID,
    ): StockItem {
        val item =
            items.findWithLockByIdAndHouseholdId(id, householdId) ?: throw NotFoundException("Stock item not found")
        if (item.status != StockStatus.ACTIVE) throw ConflictException("Stock item is ${item.status}")
        return item
    }

    private fun toDtos(
        householdId: UUID,
        list: List<StockItem>,
        ctx: Ctx,
    ): List<StockItemDto> {
        val names = catalog.productNames(householdId, list.map { it.productId }.toSet())
        return list.map {
            StockItemDto(
                id = it.id,
                product = ProductRefDto(it.productId, names.getValue(it.productId)),
                quantity = it.quantity.fmt(),
                initialQuantity = it.initialQuantity.fmt(),
                unit = it.unit,
                expiryDate = it.expiryDate,
                expiryStatus = ExpiryPolicy.statusOf(it.expiryDate, ctx.today, ctx.warningDays),
                location = it.location,
                status = it.status,
                addedAt = it.addedAt,
            )
        }
    }

    private fun movement(
        itemId: UUID,
        type: MovementType,
        quantity: BigDecimal,
        memberId: UUID,
    ) = StockMovement(UUID.randomUUID(), itemId, type, quantity, memberId, clock.instant())

    private fun parseQuantity(
        field: String,
        raw: String?,
        allowZero: Boolean,
    ): BigDecimal {
        fun bad(msg: String): Nothing = throw ValidationException("Invalid $field", listOf(FieldError(field, msg)))
        val s = raw?.trim() ?: bad("must not be null")
        if (!QUANTITY_FORMAT.matches(s)) bad("must be a decimal string with up to 3 decimals")
        val value = BigDecimal(s).setScale(3)
        if (value.signum() == 0 && !allowZero) bad("must be greater than 0")
        if (value > MAX_QUANTITY) bad("must be at most $MAX_QUANTITY")
        return value
    }

    /** `expiryDate` dentro de [MIN_EXPIRY, MAX_EXPIRY]; fuera de rango → 400. */
    fun checkExpiryRange(date: LocalDate) {
        if (date.isBefore(MIN_EXPIRY) || date.isAfter(MAX_EXPIRY)) {
            throw ValidationException(
                "Invalid expiryDate",
                listOf(FieldError("expiryDate", "must be between $MIN_EXPIRY and $MAX_EXPIRY")),
            )
        }
    }

    private fun BigDecimal.fmt(): String = setScale(3).toPlainString()

    private fun String?.clean(): String? = this?.trim()?.takeIf { it.isNotEmpty() }
}
