package ar.hogar.suggestion

import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
@RequestMapping("/api/v1/shopping-lists")
@PreAuthorize("hasAnyRole('OWNER','MEMBER')")
class SuggestionController(
    private val service: SuggestionService,
) {
    @GetMapping("/{id}/suggestions")
    fun suggestions(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
    ): List<SuggestionDto> = service.suggest(UUID.fromString(jwt.getClaimAsString("hid")), id)
}
