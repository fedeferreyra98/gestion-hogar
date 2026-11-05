package ar.hogar.auth

import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

data class RegisterOwnerRequest(
    @field:NotBlank @field:Size(max = 120) val householdName: String,
    @field:NotBlank @field:Email @field:Size(max = 254) val email: String,
    // 72: límite de BCrypt en bytes
    @field:Size(min = 8, max = 72) val password: String,
    @field:NotBlank @field:Size(max = 120) val displayName: String,
)

data class LoginRequest(
    @field:NotBlank val email: String,
    @field:NotBlank val password: String,
)

data class RefreshRequest(
    @field:NotBlank val refreshToken: String,
)

data class AuthTokens(
    val accessToken: String,
    val refreshToken: String,
    val expiresInSeconds: Long,
)
