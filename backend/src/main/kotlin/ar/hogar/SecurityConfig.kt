package ar.hogar

import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.annotation.web.invoke
import org.springframework.security.web.SecurityFilterChain

/**
 * Configuración mínima de BL-002: solo `/actuator/health` es público.
 * La autenticación JWT real llega con las tareas de auth.
 */
@Configuration
class SecurityConfig(
    // Solo `local`: deja pasar /api/** para que los endpoints aún no implementados respondan 404
    // (así `make seed`/`make smoke` saltean secciones). Se elimina cuando exista auth (JWT).
    @Value("\${app.security.permit-unimplemented-api:false}")
    private val permitUnimplementedApi: Boolean,
) {
    @Bean
    fun filterChain(http: HttpSecurity): SecurityFilterChain {
        http {
            csrf { disable() }
            authorizeHttpRequests {
                authorize("/actuator/health/**", permitAll)
                // Solo responden si springdoc está habilitado (perfil `local`)
                authorize("/swagger-ui.html", permitAll)
                authorize("/swagger-ui/**", permitAll)
                authorize("/v3/api-docs/**", permitAll)
                if (permitUnimplementedApi) {
                    authorize("/api/**", permitAll)
                    authorize("/error", permitAll) // el 404 se reenvía a /error
                }
                authorize(anyRequest, denyAll)
            }
        }
        return http.build()
    }
}
