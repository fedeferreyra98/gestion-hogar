package ar.hogar

import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.get

class HogarApplicationIntegrationTest : IntegrationTestBase() {
    @Test
    fun `context loads and health endpoint is public and UP`() {
        mockMvc.get("/actuator/health").andExpect {
            status { isOk() }
            jsonPath("$.status") { value("UP") }
        }
    }
}
