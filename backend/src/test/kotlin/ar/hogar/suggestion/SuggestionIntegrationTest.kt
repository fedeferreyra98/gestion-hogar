package ar.hogar.suggestion

import ar.hogar.IntegrationTestBase
import ar.hogar.auth.JwtService
import ar.hogar.auth.Member
import ar.hogar.auth.Role
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.assertEquals

@Import(SuggestionIntegrationTest.FixedClockConfig::class)
class SuggestionIntegrationTest : IntegrationTestBase() {
    private companion object {
        const val PASSWORD = "mock-password-123" // Datos mock (docs/07-sensitive-data.md)

        // 2040-06-15 12:00 UTC = 2040-06-16 00:00 en Auckland (UTC+12); aviso por defecto: 3 días.
        val NOW: Instant = Instant.parse("2040-06-15T12:00:00Z")
    }

    @TestConfiguration
    class FixedClockConfig {
        @Bean
        @Primary
        fun fixedClock(): Clock = Clock.fixed(NOW, ZoneOffset.UTC)
    }

    @Autowired lateinit var mapper: ObjectMapper

    @Autowired lateinit var jwt: JwtService

    private fun call(
        method: HttpMethod,
        path: String,
        body: Any? = null,
        bearer: String? = null,
    ): MvcResult =
        mockMvc
            .request(method, "/api/v1/$path") {
                contentType = MediaType.APPLICATION_JSON
                body?.let { content = mapper.writeValueAsString(it) }
                bearer?.let { header("Authorization", "Bearer $it") }
            }.andReturn()

    private fun json(r: MvcResult): JsonNode = mapper.readTree(r.response.contentAsString)

    private fun owner(): String {
        val t =
            json(
                call(
                    HttpMethod.POST,
                    "auth/register-owner",
                    mapOf(
                        "householdName" to "Hogar Mock",
                        "email" to "owner@example.test",
                        "password" to PASSWORD,
                        "displayName" to "Owner",
                    ),
                ),
            )["accessToken"].asText()
        memberId = json(call(HttpMethod.GET, "me", bearer = t))["member"]["id"].asText()
        return t
    }

    private var memberId = ""

    private fun otherHouseholdToken(): String {
        val h = UUID.randomUUID()
        val m = UUID.randomUUID()
        jdbc.update("INSERT INTO household (id, name, created_at, updated_at) VALUES (?, 'Hogar B', now(), now())", h)
        jdbc.update(
            "INSERT INTO member (id, household_id, email, password_hash, display_name, role, created_at, updated_at) " +
                "VALUES (?, ?, 'b@example.test', 'x', 'B', 'OWNER', now(), now())",
            m,
            h,
        )
        val now = Instant.now()
        return jwt.issueAccessToken(Member(m, h, "b@example.test", "x", "B", Role.OWNER, true, now, now))
    }

    private fun product(
        t: String,
        name: String,
        defaultUnit: String = "UNIT",
    ) = json(
        call(HttpMethod.POST, "products", mapOf("name" to name, "defaultUnit" to defaultUnit), t),
    )["id"].asText()

    private fun newList(t: String) =
        json(call(HttpMethod.POST, "shopping-lists", mapOf("name" to "Semanal"), t))["id"].asText()

    private fun addToList(
        t: String,
        list: String,
        productId: String,
    ) = call(
        HttpMethod.POST,
        "shopping-lists/$list/items",
        mapOf("productId" to productId, "quantity" to "1", "unit" to "UNIT"),
        t,
    )

    /** Compra previa real (completa una lista): deja un lote de stock con el vencimiento dado. */
    private fun buy(
        t: String,
        productId: String,
        expiry: String? = null,
    ) {
        val l = newList(t)
        val item = json(addToList(t, l, productId))["id"].asText()
        call(HttpMethod.PATCH, "shopping-lists/$l/items/$item", mapOf("checked" to true), t)
        val r =
            call(
                HttpMethod.POST,
                "shopping-lists/$l/complete",
                mapOf(
                    "purchaseDate" to "2040-06-10",
                    "paidBy" to memberId,
                    "total" to mapOf("amountMinor" to 1000, "currency" to "ARS"),
                    "items" to
                        listOf(
                            mapOf(
                                "listItemId" to item,
                                "productId" to productId,
                                "quantity" to "1",
                                "unit" to "UNIT",
                                "unitPrice" to mapOf("amountMinor" to 1000, "currency" to "ARS"),
                                "expiryDate" to expiry,
                            ),
                        ),
                    "leftoverAction" to "DISCARD",
                ),
                t,
            )
        assertEquals(201, r.response.status, r.response.contentAsString)
    }

    private fun suggestions(
        t: String,
        list: String,
    ) = json(call(HttpMethod.GET, "shopping-lists/$list/suggestions", bearer = t))
        .map {
            Triple(
                it["product"]["name"].asText(),
                it["reason"].asText(),
                it["detail"]
                    ?.takeUnless { d ->
                        d.isNull
                    }?.asText(),
            )
        }

    private fun consumeAll(
        t: String,
        productId: String,
    ) = call(HttpMethod.POST, "stock/consume", mapOf("productId" to productId, "quantity" to "1", "unit" to "UNIT"), t)

    @Test
    fun `suggests out of stock after a purchase, expiring and expired, ordered by reason then name`() {
        val t = owner()
        val agotado = product(t, "Yerba")
        val porVencer = product(t, "Leche")
        val vencido = product(t, "Pan")
        val sano = product(t, "Arroz")
        product(t, "Sal") // sin compra ni stock: no se sugiere
        buy(t, agotado)
        consumeAll(t, agotado)
        buy(t, porVencer, "2040-06-18") // hoy + 3: límite inclusivo
        buy(t, vencido, "2040-06-14")
        buy(t, sano, "2040-06-19") // hoy + 4: fuera
        val list = newList(t)

        assertEquals(
            listOf(
                Triple("Yerba", "OUT_OF_STOCK", null),
                Triple("Leche", "EXPIRING", "2040-06-18"),
                Triple("Pan", "EXPIRED", "2040-06-14"),
            ),
            suggestions(t, list),
        )
    }

    @Test
    fun `each suggestion carries the default unit of its product`() {
        val t = owner()
        val agotado = product(t, "Harina", "KG")
        val porVencer = product(t, "Jugo", "L")
        val vencido = product(t, "Fideos", "PACK")
        buy(t, agotado)
        consumeAll(t, agotado)
        buy(t, porVencer, "2040-06-18")
        buy(t, vencido, "2040-06-14")
        val list = newList(t)

        val units =
            json(call(HttpMethod.GET, "shopping-lists/$list/suggestions", bearer = t))
                .associate { it["product"]["name"].asText() to it["defaultUnit"].asText() }
        assertEquals(mapOf("Harina" to "KG", "Jugo" to "L", "Fideos" to "PACK"), units)
    }

    @Test
    fun `a product with an expired and an expiring lot is reported once as EXPIRED`() {
        val t = owner()
        val p = product(t, "Yogur")
        buy(t, p, "2040-06-17")
        buy(t, p, "2040-06-01")
        assertEquals(listOf(Triple("Yogur", "EXPIRED", "2040-06-01")), suggestions(t, newList(t)))
    }

    @Test
    fun `a product with a healthy lot is not out of stock even if another lot was consumed`() {
        val t = owner()
        val p = product(t, "Fideos")
        buy(t, p, "2041-01-01")
        buy(t, p, "2041-02-01")
        consumeAll(t, p) // consume solo el lote más próximo (FEFO); queda el otro
        assertEquals(emptyList(), suggestions(t, newList(t)))
    }

    @Test
    fun `products already on the list are excluded and archived products never suggested`() {
        val t = owner()
        val enLista = product(t, "Yerba")
        val archivado = product(t, "Café")
        val libre = product(t, "Azúcar")
        listOf(enLista, archivado, libre).forEach {
            buy(t, it)
            consumeAll(t, it)
        }
        call(HttpMethod.POST, "products/$archivado/archive", bearer = t)
        val list = newList(t)
        assertEquals(listOf("Azúcar", "Yerba"), suggestions(t, list).map { it.first })

        addToList(t, list, enLista)
        assertEquals(listOf("Azúcar"), suggestions(t, list).map { it.first })
    }

    @Test
    fun `today follows the household timezone`() {
        val t = owner()
        val p = product(t, "Pan")
        buy(t, p, "2040-06-15")
        val list = newList(t)
        assertEquals(listOf(Triple("Pan", "EXPIRING", "2040-06-15")), suggestions(t, list)) // hoy UTC = 15/06
        jdbc.update("UPDATE household SET timezone = 'Pacific/Auckland'") // hoy = 16/06
        assertEquals(listOf(Triple("Pan", "EXPIRED", "2040-06-15")), suggestions(t, list))
    }

    @Test
    fun `other household data is isolated and its list answers 404`() {
        val t = owner()
        val p = product(t, "Yerba")
        buy(t, p)
        consumeAll(t, p)
        val list = newList(t)
        val b = otherHouseholdToken()
        val listB = newList(b)

        assertEquals(emptyList(), suggestions(b, listB)) // el hogar B no ve productos del A
        assertEquals(404, call(HttpMethod.GET, "shopping-lists/$list/suggestions", bearer = b).response.status)
        assertEquals(
            404,
            call(HttpMethod.GET, "shopping-lists/${UUID.randomUUID()}/suggestions", bearer = t).response.status,
        )
        assertEquals(401, call(HttpMethod.GET, "shopping-lists/$list/suggestions").response.status)
        assertEquals(1, suggestions(t, list).size)
    }

    @Test
    fun `a COMPLETED list is accepted and the MEMBER role can read suggestions`() {
        val t = owner()
        val p = product(t, "Yerba")
        buy(t, p)
        consumeAll(t, p)
        val completed = newList(t)
        jdbc.update("UPDATE shopping_list SET status = 'COMPLETED' WHERE id = ?::uuid", completed)
        assertEquals(listOf("Yerba"), suggestions(t, completed).map { it.first })

        call(
            HttpMethod.POST,
            "members",
            mapOf("email" to "member@example.test", "displayName" to "Member Mock", "password" to PASSWORD),
            t,
        )
        val member =
            json(
                call(HttpMethod.POST, "auth/login", mapOf("email" to "member@example.test", "password" to PASSWORD)),
            )["accessToken"].asText()
        assertEquals(listOf("Yerba"), suggestions(member, completed).map { it.first })
    }

    @Test
    fun `a malformed list id answers 400`() {
        val t = owner()
        assertEquals(400, call(HttpMethod.GET, "shopping-lists/not-a-uuid/suggestions", bearer = t).response.status)
    }

    @Test
    fun `at most 50 suggestions are returned`() {
        val t = owner()
        val list = newList(t)
        repeat(55) { i ->
            val p = product(t, "Prod %02d".format(i))
            buy(t, p)
            consumeAll(t, p)
        }
        assertEquals(50, suggestions(t, list).size)
    }
}
