package ar.hogar.auth

import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.testcontainers.service.connection.ServiceConnection
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.testcontainers.containers.PostgreSQLContainer
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AuthIntegrationTest {
    companion object {
        @JvmStatic
        @ServiceConnection
        val postgres: PostgreSQLContainer<*> =
            PostgreSQLContainer("postgres:16-alpine").withReuse(true).also { it.start() }

        // Datos mock (docs/07-sensitive-data.md)
        const val EMAIL = "owner@example.test"
        const val PASSWORD = "mock-password-123"
    }

    @Autowired lateinit var mockMvc: MockMvc

    @Autowired lateinit var mapper: ObjectMapper

    @Autowired lateinit var jdbc: JdbcTemplate

    @BeforeEach
    fun clean() {
        jdbc.execute("TRUNCATE refresh_token, member, household CASCADE")
    }

    private fun json(vararg pairs: Pair<String, String>) = mapper.writeValueAsString(mapOf(*pairs))

    private fun post(
        path: String,
        body: String,
        bearer: String? = null,
    ): MvcResult =
        mockMvc
            .post("/api/v1/auth/$path") {
                contentType = MediaType.APPLICATION_JSON
                content = body
                bearer?.let { header("Authorization", "Bearer $it") }
            }.andReturn()

    private fun register(email: String = EMAIL) =
        post(
            "register-owner",
            json(
                "householdName" to "Hogar Mock",
                "email" to email,
                "password" to PASSWORD,
                "displayName" to "Owner Mock",
            ),
        )

    private fun tokens(r: MvcResult) = mapper.readTree(r.response.contentAsString)

    @Test
    fun `register creates household and owner then allows login`() {
        val reg = register()
        assertEquals(201, reg.response.status)
        assertTrue(tokens(reg)["accessToken"].asText().isNotBlank())
        assertEquals(3600, tokens(reg)["expiresInSeconds"].asLong())

        val login = post("login", json("email" to EMAIL.uppercase(), "password" to PASSWORD))
        assertEquals(200, login.response.status)
        assertEquals("OWNER", jdbc.queryForObject("select role from member", String::class.java))
        // El refresh token se persiste solo como hash
        val stored = jdbc.queryForObject("select token_hash from refresh_token limit 1", String::class.java)
        assertNotEquals(tokens(login)["refreshToken"].asText(), stored)
    }

    @Test
    fun `second register returns 409`() {
        register()
        val second = register("otro@example.test")
        assertEquals(409, second.response.status)
        assertTrue(second.response.contentAsString.contains("\"code\":\"CONFLICT\""))
    }

    @Test
    fun `register validates input`() {
        val r =
            post(
                "register-owner",
                json(
                    "householdName" to "H",
                    "email" to "no-email",
                    "password" to "short",
                    "displayName" to "X",
                ),
            )
        assertEquals(400, r.response.status)
    }

    @Test
    fun `login with wrong password or unknown email returns generic 401`() {
        register()
        val wrongPass = post("login", json("email" to EMAIL, "password" to "incorrecta-123"))
        val unknown = post("login", json("email" to "nadie@example.test", "password" to PASSWORD))
        assertEquals(401, wrongPass.response.status)
        assertEquals(401, unknown.response.status)
        assertEquals(wrongPass.response.contentAsString, unknown.response.contentAsString)
    }

    @Test
    fun `inactive member cannot login`() {
        register()
        jdbc.update("update member set active = false")
        assertEquals(401, post("login", json("email" to EMAIL, "password" to PASSWORD)).response.status)
    }

    @Test
    fun `refresh rotates the token and reuse of the old one returns 401`() {
        val first = tokens(register())
        val oldRefresh = first["refreshToken"].asText()

        val rotated = post("refresh", json("refreshToken" to oldRefresh))
        assertEquals(200, rotated.response.status)
        val newRefresh = tokens(rotated)["refreshToken"].asText()
        assertNotEquals(oldRefresh, newRefresh)

        assertEquals(401, post("refresh", json("refreshToken" to oldRefresh)).response.status)
        assertEquals(200, post("refresh", json("refreshToken" to newRefresh)).response.status)
    }

    @Test
    fun `refresh with unknown or expired token returns 401`() {
        val refresh = tokens(register())["refreshToken"].asText()
        assertEquals(401, post("refresh", json("refreshToken" to "desconocido")).response.status)
        jdbc.update("update refresh_token set expires_at = now() - interval '1 minute'")
        assertEquals(401, post("refresh", json("refreshToken" to refresh)).response.status)
    }

    @Test
    fun `logout revokes the refresh token`() {
        val t = tokens(register())
        val refresh = t["refreshToken"].asText()
        val out = post("logout", json("refreshToken" to refresh), bearer = t["accessToken"].asText())
        assertEquals(204, out.response.status)
        assertEquals(401, post("refresh", json("refreshToken" to refresh)).response.status)
    }

    @Test
    fun `logout without access token returns 401`() {
        val refresh = tokens(register())["refreshToken"].asText()
        assertEquals(401, post("logout", json("refreshToken" to refresh)).response.status)
    }

    @Test
    fun `protected routes without or with invalid token return 401 problem json`() {
        mockMvc.get("/api/v1/me").andReturn().let {
            assertEquals(401, it.response.status)
            assertTrue(it.response.contentAsString.contains("\"code\":\"UNAUTHORIZED\""))
        }
        mockMvc.get("/api/v1/me") { header("Authorization", "Bearer basura") }.andReturn().let {
            assertEquals(401, it.response.status)
        }
    }

    @Test
    fun `valid access token passes authentication`() {
        val access = tokens(register())["accessToken"].asText()
        // /me aún no existe (BL-103): autenticado => 404, no 401
        val status =
            mockMvc
                .get("/api/v1/me") { header("Authorization", "Bearer $access") }
                .andReturn()
                .response.status
        assertEquals(404, status)
    }
}
