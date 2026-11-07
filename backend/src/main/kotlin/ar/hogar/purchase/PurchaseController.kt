package ar.hogar.purchase

import ar.hogar.common.PageResponse
import jakarta.validation.Valid
import org.springframework.format.annotation.DateTimeFormat
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.LocalDate
import java.util.UUID

/** UC-13 (completar lista), UC-14 (compra sin lista) y UC-22 (consulta/edición de compras). */
@RestController
@RequestMapping("/api/v1")
@PreAuthorize("hasAnyRole('OWNER','MEMBER')")
class PurchaseController(
    private val service: PurchaseService,
) {
    private fun Jwt.householdId() = UUID.fromString(getClaimAsString("hid"))

    private fun Jwt.memberId() = UUID.fromString(subject)

    @PostMapping("/shopping-lists/{id}/complete")
    fun complete(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
        @Valid @RequestBody req: CompleteListRequest,
    ): ResponseEntity<PurchaseDto> =
        ResponseEntity
            .status(HttpStatus.CREATED)
            .body(service.completeList(jwt.householdId(), jwt.memberId(), id, req))

    @PostMapping("/purchases")
    fun create(
        @AuthenticationPrincipal jwt: Jwt,
        @Valid @RequestBody req: CreatePurchaseRequest,
    ): ResponseEntity<PurchaseDto> =
        ResponseEntity.status(HttpStatus.CREATED).body(service.create(jwt.householdId(), jwt.memberId(), req))

    @GetMapping("/purchases")
    fun list(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) from: LocalDate?,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) to: LocalDate?,
        @RequestParam(required = false) store: String?,
        @RequestParam(required = false) page: Int?,
        @RequestParam(required = false) size: Int?,
        @RequestParam(required = false) sort: String?,
    ): PageResponse<PurchaseSummaryDto> = service.search(jwt.householdId(), from, to, store, page, size, sort)

    @GetMapping("/purchases/{id}")
    fun get(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
    ): PurchaseDto = service.get(jwt.householdId(), id)

    @PutMapping("/purchases/{id}")
    fun update(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
        @Valid @RequestBody req: UpdatePurchaseRequest,
    ): PurchaseDto = service.update(jwt.householdId(), id, req)
}
