package ar.hogar.auth

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

/** `app.jwt.*`: el secreto viene siempre del entorno (`JWT_SECRET`), nunca del repo. */
@ConfigurationProperties(prefix = "app.jwt")
data class AuthProperties(
    val secret: String,
    val accessTtl: Duration = Duration.ofHours(1),
    val refreshTtl: Duration = Duration.ofDays(30),
) {
    init {
        require(secret.toByteArray().size >= 32) { "app.jwt.secret must be at least 32 bytes (HS256)" }
    }
}
