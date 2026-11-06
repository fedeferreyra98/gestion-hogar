package ar.hogar.stock

import ar.hogar.common.PageResponse
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

/** Stock del hogar (UC-30..34): lectura y escritura para cualquier miembro. */
@RestController
@RequestMapping("/api/v1/stock")
@PreAuthorize("hasAnyRole('OWNER','MEMBER')")
class StockController(
    private val service: StockService,
) {
    private fun Jwt.householdId() = UUID.fromString(getClaimAsString("hid"))

    private fun Jwt.memberId() = UUID.fromString(subject)

    @GetMapping
    fun list(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestParam(required = false) productId: UUID?,
        @RequestParam(required = false) categoryId: UUID?,
        @RequestParam(required = false) location: String?,
        @RequestParam(required = false) expiry: ExpiryFilter?,
        @RequestParam(required = false) status: StockStatus?,
        @RequestParam(required = false) page: Int?,
        @RequestParam(required = false) size: Int?,
    ): PageResponse<StockItemDto> =
        service.list(jwt.householdId(), productId, categoryId, location, expiry, status, page, size)

    @PostMapping
    fun create(
        @AuthenticationPrincipal jwt: Jwt,
        @Valid @RequestBody req: CreateStockItemRequest,
    ): ResponseEntity<StockItemDto> =
        ResponseEntity.status(HttpStatus.CREATED).body(service.create(jwt.householdId(), jwt.memberId(), req))

    @PostMapping("/consume")
    fun consumeByProduct(
        @AuthenticationPrincipal jwt: Jwt,
        @Valid @RequestBody req: ConsumeByProductRequest,
    ): ConsumeResultDto = service.consumeByProduct(jwt.householdId(), jwt.memberId(), req)

    @GetMapping("/alerts")
    fun alerts(
        @AuthenticationPrincipal jwt: Jwt,
    ): StockAlertsDto = service.alerts(jwt.householdId())

    @GetMapping("/summary")
    fun summary(
        @AuthenticationPrincipal jwt: Jwt,
    ): List<StockSummaryRowDto> = service.summary(jwt.householdId())

    @PatchMapping("/{id}")
    fun update(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
        @Valid @RequestBody req: UpdateStockItemRequest,
    ): StockItemDto = service.update(jwt.householdId(), jwt.memberId(), id, req)

    @PostMapping("/{id}/consume")
    fun consumeItem(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
        @Valid @RequestBody req: ConsumeItemRequest,
    ): StockItemDto = service.consumeItem(jwt.householdId(), jwt.memberId(), id, req)

    @PostMapping("/{id}/discard")
    fun discard(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
        @Valid @RequestBody(required = false) req: DiscardRequest?,
    ): StockItemDto = service.discard(jwt.householdId(), jwt.memberId(), id, req?.reason)
}
