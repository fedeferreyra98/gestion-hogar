package ar.hogar.auth

import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
@RequestMapping("/api/v1/auth")
class AuthController(
    private val service: AuthService,
) {
    @PostMapping("/register-owner")
    fun registerOwner(
        @Valid @RequestBody req: RegisterOwnerRequest,
    ): ResponseEntity<AuthTokens> = ResponseEntity.status(HttpStatus.CREATED).body(service.registerOwner(req))

    @PostMapping("/login")
    fun login(
        @Valid @RequestBody req: LoginRequest,
    ): AuthTokens = service.login(req)

    @PostMapping("/refresh")
    fun refresh(
        @Valid @RequestBody req: RefreshRequest,
    ): AuthTokens = service.refresh(req.refreshToken)

    @PostMapping("/logout")
    fun logout(
        @AuthenticationPrincipal jwt: Jwt,
        @Valid @RequestBody req: RefreshRequest,
    ): ResponseEntity<Void> {
        service.logout(UUID.fromString(jwt.subject), req.refreshToken)
        return ResponseEntity.noContent().build()
    }
}
