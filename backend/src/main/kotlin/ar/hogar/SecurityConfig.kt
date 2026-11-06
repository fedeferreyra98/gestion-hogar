package ar.hogar

import ar.hogar.auth.AuthProperties
import ar.hogar.common.ApiExceptionHandler
import ar.hogar.common.ProblemDetailBody
import com.fasterxml.jackson.databind.ObjectMapper
import com.nimbusds.jose.jwk.source.ImmutableSecret
import jakarta.servlet.http.HttpServletResponse
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpStatus
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.annotation.web.invoke
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.oauth2.jose.jws.MacAlgorithm
import org.springframework.security.oauth2.jwt.JwtDecoder
import org.springframework.security.oauth2.jwt.JwtEncoder
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter
import org.springframework.security.web.AuthenticationEntryPoint
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.access.AccessDeniedHandler
import java.time.Clock
import javax.crypto.spec.SecretKeySpec

/** Spring Security stateless con JWT HS256 (ADR-008). Errores 401/403 como RFC 7807. */
@Configuration
@EnableMethodSecurity
@EnableConfigurationProperties(AuthProperties::class)
class SecurityConfig {
    @Bean
    fun filterChain(
        http: HttpSecurity,
        entryPoint: AuthenticationEntryPoint,
        deniedHandler: AccessDeniedHandler,
        jwtConverter: JwtAuthenticationConverter,
    ): SecurityFilterChain {
        http {
            csrf { disable() }
            sessionManagement { sessionCreationPolicy = SessionCreationPolicy.STATELESS }
            authorizeHttpRequests {
                authorize("/actuator/health/**", permitAll)
                // Solo responden si springdoc está habilitado (perfil `local`)
                authorize("/swagger-ui.html", permitAll)
                authorize("/swagger-ui/**", permitAll)
                authorize("/v3/api-docs/**", permitAll)
                authorize("/api/v1/auth/register-owner", permitAll)
                authorize("/api/v1/auth/login", permitAll)
                authorize("/api/v1/auth/refresh", permitAll)
                authorize("/error", permitAll) // el 404/500 se reenvía a /error
                authorize("/api/**", authenticated)
                authorize(anyRequest, denyAll)
            }
            oauth2ResourceServer {
                jwt { jwtAuthenticationConverter = jwtConverter }
                authenticationEntryPoint = entryPoint
                accessDeniedHandler = deniedHandler
            }
            exceptionHandling {
                authenticationEntryPoint = entryPoint
                accessDeniedHandler = deniedHandler
            }
        }
        return http.build()
    }

    @Bean
    fun passwordEncoder(): PasswordEncoder = BCryptPasswordEncoder()

    @Bean
    fun clock(): Clock = Clock.systemUTC()

    @Bean
    fun jwtEncoder(props: AuthProperties): JwtEncoder = NimbusJwtEncoder(ImmutableSecret(secretKey(props)))

    @Bean
    fun jwtDecoder(props: AuthProperties): JwtDecoder =
        NimbusJwtDecoder.withSecretKey(secretKey(props)).macAlgorithm(MacAlgorithm.HS256).build()

    /** El claim `role` (OWNER|MEMBER) se expone como autoridad `ROLE_*` para `@PreAuthorize`. */
    @Bean
    fun jwtAuthenticationConverter(): JwtAuthenticationConverter {
        val authorities =
            JwtGrantedAuthoritiesConverter().apply {
                setAuthoritiesClaimName("role")
                setAuthorityPrefix("ROLE_")
            }
        return JwtAuthenticationConverter().apply { setJwtGrantedAuthoritiesConverter(authorities) }
    }

    @Bean
    fun authenticationEntryPoint(mapper: ObjectMapper): AuthenticationEntryPoint =
        AuthenticationEntryPoint { _, response, _ ->
            writeProblem(
                mapper,
                response,
                HttpStatus.UNAUTHORIZED,
                "UNAUTHORIZED",
                "Unauthorized",
                "Authentication required",
            )
        }

    @Bean
    fun accessDeniedHandler(mapper: ObjectMapper): AccessDeniedHandler =
        AccessDeniedHandler { _, response, _ ->
            writeProblem(mapper, response, HttpStatus.FORBIDDEN, "FORBIDDEN", "Forbidden", "Access denied")
        }

    private fun secretKey(props: AuthProperties) = SecretKeySpec(props.secret.toByteArray(), "HmacSHA256")

    private fun writeProblem(
        mapper: ObjectMapper,
        response: HttpServletResponse,
        status: HttpStatus,
        code: String,
        title: String,
        detail: String,
    ) {
        response.status = status.value()
        response.contentType = ApiExceptionHandler.PROBLEM_JSON.toString()
        mapper.writeValue(
            response.outputStream,
            ProblemDetailBody(title = title, status = status.value(), code = code, detail = detail),
        )
    }
}
