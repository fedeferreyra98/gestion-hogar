package ar.hogar.member

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.testcontainers.service.connection.ServiceConnection
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request
import org.testcontainers.containers.PostgreSQLContainer
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MemberIntegrationTest {
    companion object {
        @JvmStatic
        @ServiceConnection
        val postgres: PostgreSQLContainer<*> =
            PostgreSQLContainer("postgres:16-alpine").withReuse(true).also { it.start() }

        // Datos mock (docs/07-sensitive-data.md)
        const val OWNER_EMAIL = "owner@example.test"
        const val MEMBER_EMAIL = "member@example.test"
        const val PASSWORD = "mock-password-123"
    }

    @Autowired lateinit var mockMvc: MockMvc

    @Autowired lateinit var mapper: ObjectMapper

    @Autowired lateinit var jdbc: JdbcTemplate

    @BeforeEach
    fun clean() {
        jdbc.execute("TRUNCATE refresh_token, member, household CASCADE")
    }

    private fun call(
        method: HttpMethod,
        path: String,
        body: Map<String, Any?>? = null,
        bearer: String? = null,
    ): MvcResult =
        mockMvc
            .request(method, "/api/v1/$path") {
                contentType = MediaType.APPLICATION_JSON
                body?.let { content = mapper.writeValueAsString(it) }
                bearer?.let { header("Authorization", "Bearer $it") }
            }.andReturn()

    private fun JsonNode.token() = this["accessToken"].asText()

    private fun body(r: MvcResult): JsonNode = mapper.readTree(r.response.contentAsString)

    private fun registerOwner(): String =
        body(
            call(
                HttpMethod.POST,
                "auth/register-owner",
                mapOf(
                    "householdName" to "Hogar Mock",
                    "email" to OWNER_EMAIL,
                    "password" to PASSWORD,
                    "displayName" to "Owner Mock",
                ),
            ),
        ).token()

    private fun createMember(owner: String) =
        call(
            HttpMethod.POST,
            "members",
            mapOf("email" to MEMBER_EMAIL, "displayName" to "Member Mock", "password" to PASSWORD),
            owner,
        )

    private fun login(email: String) =
        call(HttpMethod.POST, "auth/login", mapOf("email" to email, "password" to PASSWORD))

    @Test
    fun `me returns profile and household`() {
        val owner = registerOwner()
        val r = call(HttpMethod.GET, "me", bearer = owner)
        assertEquals(200, r.response.status)
        assertEquals("OWNER", body(r)["member"]["role"].asText())
        assertEquals("Hogar Mock", body(r)["household"]["name"].asText())
        assertEquals("ARS", body(r)["household"]["baseCurrency"].asText())
    }

    @Test
    fun `me without token is 401`() {
        assertEquals(401, call(HttpMethod.GET, "me").response.status)
    }

    @Test
    fun `owner creates member who can login and list members`() {
        val owner = registerOwner()
        val created = createMember(owner)
        assertEquals(201, created.response.status)
        assertEquals("MEMBER", body(created)["role"].asText())
        assertEquals(200, login(MEMBER_EMAIL).response.status)
        val list = call(HttpMethod.GET, "members", bearer = owner)
        assertEquals(2, body(list).size())
    }

    @Test
    fun `member cannot create members nor edit but can read`() {
        val owner = registerOwner()
        val memberId = body(createMember(owner))["id"].asText()
        val member = body(login(MEMBER_EMAIL)).token()

        val forbidden =
            call(
                HttpMethod.POST,
                "members",
                mapOf("email" to "x@example.test", "displayName" to "X", "password" to PASSWORD),
                member,
            )
        assertEquals(403, forbidden.response.status)
        assertEquals("FORBIDDEN", body(forbidden)["code"].asText())
        assertEquals(403, call(HttpMethod.PATCH, "members/$memberId", mapOf("active" to false), member).response.status)
        assertEquals(403, call(HttpMethod.PUT, "household", mapOf("name" to "Otro"), member).response.status)
        assertEquals(200, call(HttpMethod.GET, "members", bearer = member).response.status)
        assertEquals(200, call(HttpMethod.GET, "me", bearer = member).response.status)
    }

    @Test
    fun `duplicate email is 409 and invalid body is 400`() {
        val owner = registerOwner()
        assertEquals(201, createMember(owner).response.status)
        assertEquals(409, createMember(owner).response.status)
        val bad =
            call(HttpMethod.POST, "members", mapOf("email" to "nope", "displayName" to "", "password" to "x"), owner)
        assertEquals(400, bad.response.status)
    }

    @Test
    fun `deactivated member cannot login nor refresh but stays listed`() {
        val owner = registerOwner()
        val memberId = body(createMember(owner))["id"].asText()
        val refresh = body(login(MEMBER_EMAIL))["refreshToken"].asText()

        val patched = call(HttpMethod.PATCH, "members/$memberId", mapOf("active" to false), owner)
        assertEquals(200, patched.response.status)
        assertEquals(false, body(patched)["active"].asBoolean())

        assertEquals(401, login(MEMBER_EMAIL).response.status)
        assertEquals(401, call(HttpMethod.POST, "auth/refresh", mapOf("refreshToken" to refresh)).response.status)
        assertTrue(body(call(HttpMethod.GET, "members", bearer = owner)).any { it["id"].asText() == memberId })

        call(HttpMethod.PATCH, "members/$memberId", mapOf("active" to true, "displayName" to "Renombrado"), owner)
        assertEquals(200, login(MEMBER_EMAIL).response.status)
    }

    @Test
    fun `owner cannot deactivate self and unknown member is 404`() {
        val owner = registerOwner()
        val ownerId = body(call(HttpMethod.GET, "me", bearer = owner))["member"]["id"].asText()
        assertEquals(409, call(HttpMethod.PATCH, "members/$ownerId", mapOf("active" to false), owner).response.status)
        val unknown = "00000000-0000-0000-0000-000000000001"
        assertEquals(404, call(HttpMethod.PATCH, "members/$unknown", mapOf("active" to false), owner).response.status)
    }

    @Test
    fun `owner updates household partially`() {
        val owner = registerOwner()
        val r =
            call(HttpMethod.PUT, "household", mapOf("name" to "Casa Nueva", "expiryWarningDays" to 5), owner)
        assertEquals(200, r.response.status)
        assertEquals("Casa Nueva", body(r)["name"].asText())
        assertEquals(5, body(r)["expiryWarningDays"].asInt())
        assertEquals(true, body(r)["sharePurchasesByDefault"].asBoolean())
        assertEquals(400, call(HttpMethod.PUT, "household", mapOf("expiryWarningDays" to -1), owner).response.status)
    }
}
