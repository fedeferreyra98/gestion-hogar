package ar.hogar.expense

import jakarta.validation.Valid
import org.springframework.format.annotation.DateTimeFormat
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.DeleteMapping
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

/** Gastos del hogar: cualquier miembro (OWNER o MEMBER). */
@RestController
@RequestMapping("/api/v1/expenses")
@PreAuthorize("hasAnyRole('OWNER','MEMBER')")
class ExpenseController(
    private val service: ExpenseService,
) {
    private fun Jwt.householdId() = UUID.fromString(getClaimAsString("hid"))

    private fun Jwt.memberId() = UUID.fromString(subject)

    @GetMapping
    fun list(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) from: LocalDate?,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) to: LocalDate?,
        @RequestParam(required = false) categoryId: UUID?,
        @RequestParam(required = false) paidBy: UUID?,
        @RequestParam(required = false) source: ExpenseSource?,
        @RequestParam(required = false) shared: Boolean?,
        @RequestParam(required = false) q: String?,
        @RequestParam(required = false) page: Int?,
        @RequestParam(required = false) size: Int?,
        @RequestParam(required = false) sort: String?,
    ): ExpensePageResponse =
        service.search(
            jwt.householdId(),
            ExpenseFilter(from, to, categoryId, paidBy, source, shared, q),
            page,
            size,
            sort,
        )

    @PostMapping
    fun create(
        @AuthenticationPrincipal jwt: Jwt,
        @Valid @RequestBody req: ExpenseInput,
    ): ResponseEntity<ExpenseDto> =
        ResponseEntity.status(HttpStatus.CREATED).body(service.create(jwt.householdId(), jwt.memberId(), req))

    @GetMapping("/{id}")
    fun get(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
    ): ExpenseDto = service.get(jwt.householdId(), id)

    @PutMapping("/{id}")
    fun update(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
        @Valid @RequestBody req: ExpenseInput,
    ): ExpenseDto = service.update(jwt.householdId(), id, req)

    @DeleteMapping("/{id}")
    fun delete(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
    ): ResponseEntity<Void> {
        service.delete(jwt.householdId(), id)
        return ResponseEntity.noContent().build()
    }
}
