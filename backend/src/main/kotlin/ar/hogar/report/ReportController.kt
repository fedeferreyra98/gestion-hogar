package ar.hogar.report

import org.springframework.format.annotation.DateTimeFormat
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.LocalDate
import java.util.UUID

/** Reportes de gasto (UC-23): cualquier miembro del hogar. */
@RestController
@RequestMapping("/api/v1")
@PreAuthorize("hasAnyRole('OWNER','MEMBER')")
class ReportController(
    private val service: ReportService,
) {
    private fun Jwt.householdId() = UUID.fromString(getClaimAsString("hid"))

    @GetMapping("/expenses/summary")
    fun summary(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) from: LocalDate?,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) to: LocalDate?,
        @RequestParam groupBy: String,
    ): List<SummaryRowDto> = service.summary(jwt.householdId(), from, to, groupBy)

    @GetMapping("/products/{id}/price-history")
    fun priceHistory(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) from: LocalDate?,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) to: LocalDate?,
    ): List<PricePointDto> = service.priceHistory(jwt.householdId(), id, from, to)
}
