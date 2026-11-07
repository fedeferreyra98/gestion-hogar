package ar.hogar.report

import ar.hogar.IntegrationTestBase
import ar.hogar.auth.JwtService
import ar.hogar.auth.Member
import ar.hogar.auth.Role
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ReportIntegrationTest : IntegrationTestBase() {
    private companion object {
        const val PASSWORD = "mock-password-123" // Datos mock (docs/07-sensitive-data.md)
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

    private fun body(r: MvcResult): JsonNode = mapper.readTree(r.response.contentAsString)

    private class Ctx(
        val token: String,
        val memberId: String,
        val householdId: UUID,
    )

    private fun owner(): Ctx {
        val b =
            body(
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
            )
        val token = b["accessToken"].asText()
        val me = body(call(HttpMethod.GET, "me", bearer = token))
        return Ctx(token, me["member"]["id"].asText(), UUID.fromString(me["household"]["id"].asText()))
    }

    private fun otherHousehold(): Ctx {
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
        return Ctx(
            jwt.issueAccessToken(Member(m, h, "b@example.test", "x", "B", Role.OWNER, true, now, now)),
            "$m",
            h,
        )
    }

    private fun money(
        minor: Long,
        currency: String = "ARS",
    ) = mapOf("amountMinor" to minor, "currency" to currency)

    private fun category(
        c: Ctx,
        name: String,
    ) = body(call(HttpMethod.POST, "categories", mapOf("name" to name), c.token))["id"].asText()

    private fun product(
        c: Ctx,
        name: String,
    ) = body(
        call(HttpMethod.POST, "products", mapOf("name" to name, "defaultUnit" to "UNIT"), c.token),
    )["id"].asText()

    private fun expense(
        c: Ctx,
        date: String,
        minor: Long,
        categoryId: String? = null,
    ): String {
        val r =
            call(
                HttpMethod.POST,
                "expenses",
                mapOf(
                    "description" to "Gasto mock",
                    "amount" to money(minor),
                    "expenseDate" to date,
                    "categoryId" to categoryId,
                    "paidBy" to c.memberId,
                ),
                c.token,
            )
        assertEquals(201, r.response.status, r.response.contentAsString)
        return body(r)["id"].asText()
    }

    private fun purchase(
        c: Ctx,
        date: String,
        store: String?,
        productId: String,
        unitPrice: Long,
        total: Long = unitPrice,
        unit: String = "UNIT",
    ) {
        val r =
            call(
                HttpMethod.POST,
                "purchases",
                mapOf(
                    "purchaseDate" to date,
                    "store" to store,
                    "paidBy" to c.memberId,
                    "total" to money(total),
                    "items" to
                        listOf(
                            mapOf(
                                "productId" to productId,
                                "quantity" to "1",
                                "unit" to unit,
                                "unitPrice" to money(unitPrice),
                            ),
                        ),
                ),
                c.token,
            )
        assertEquals(201, r.response.status, r.response.contentAsString)
    }

    /** Gasto en otra moneda: la API solo acepta la moneda base, se inserta directo. */
    private fun foreignExpense(
        c: Ctx,
        date: String,
        minor: Long,
        currency: String,
        categoryId: String? = null,
    ) {
        jdbc.update(
            "INSERT INTO expense (id, household_id, description, amount_minor, currency, expense_date, category_id, " +
                "paid_by, source, created_by, created_at, updated_at) " +
                "VALUES (?, ?, 'Gasto USD', ?, ?, ?::date, ?::uuid, ?::uuid, 'MANUAL', ?::uuid, now(), now())",
            UUID.randomUUID(),
            c.householdId,
            minor,
            currency,
            date,
            categoryId,
            c.memberId,
            c.memberId,
        )
    }

    private fun rows(r: MvcResult): List<Triple<String, Long, String>> {
        assertEquals(200, r.response.status, r.response.contentAsString)
        return body(r).map {
            Triple(it["key"].asText(), it["total"]["amountMinor"].asLong(), it["total"]["currency"].asText())
        }
    }

    @Test
    fun `summary by month aggregates several months and currencies without mixing`() {
        val c = owner()
        expense(c, "2026-01-31", 1000)
        expense(c, "2026-01-01", 500)
        expense(c, "2026-03-15", 2000)
        val deleted = expense(c, "2026-03-20", 99999)
        assertEquals(204, call(HttpMethod.DELETE, "expenses/$deleted", bearer = c.token).response.status)
        foreignExpense(c, "2026-03-02", 700, "USD")
        purchase(c, "2026-02-10", "Super Mock", product(c, "Leche"), 300)

        val r = call(HttpMethod.GET, "expenses/summary?groupBy=month", bearer = c.token)
        assertEquals(
            listOf(
                Triple("2026-01", 1500L, "ARS"),
                Triple("2026-02", 300L, "ARS"),
                Triple("2026-03", 2000L, "ARS"),
                Triple("2026-03", 700L, "USD"),
            ),
            rows(r),
        )

        // rango inclusivo en ambos extremos
        val ranged =
            call(HttpMethod.GET, "expenses/summary?groupBy=month&from=2026-01-31&to=2026-03-15", bearer = c.token)
        assertEquals(
            listOf(
                Triple("2026-01", 1000L, "ARS"),
                Triple("2026-02", 300L, "ARS"),
                Triple("2026-03", 2000L, "ARS"),
                Triple("2026-03", 700L, "USD"),
            ),
            rows(ranged),
        )
    }

    @Test
    fun `summary by category groups per currency and labels uncategorized`() {
        val c = owner()
        val lacteos = category(c, "Lácteos")
        val limpieza = category(c, "Limpieza")
        expense(c, "2026-01-10", 1000, lacteos)
        expense(c, "2026-02-10", 2500, lacteos)
        expense(c, "2026-02-11", 4000, limpieza)
        expense(c, "2026-02-12", 150) // sin categoría
        foreignExpense(c, "2026-02-13", 50, "USD", lacteos)

        val r = call(HttpMethod.GET, "expenses/summary?groupBy=category", bearer = c.token)
        assertEquals(200, r.response.status)
        val b = body(r)
        assertEquals(
            listOf(
                Triple(limpieza, 4000L, "ARS"),
                Triple(lacteos, 3500L, "ARS"),
                Triple("uncategorized", 150L, "ARS"),
                Triple(lacteos, 50L, "USD"),
            ),
            rows(r),
        )
        assertEquals(listOf("Limpieza", "Lácteos", "Sin categoría", "Lácteos"), b.map { it["label"].asText() })
    }

    @Test
    fun `summary by store uses purchases only and groups stores case-insensitively`() {
        val c = owner()
        val p = product(c, "Pan")
        purchase(c, "2026-01-05", "Super Mock", p, 1000)
        purchase(c, "2026-02-05", "super mock ", p, 500)
        purchase(c, "2026-02-06", "Kiosco Mock", p, 200)
        purchase(c, "2026-02-07", null, p, 50)
        expense(c, "2026-02-08", 99999) // manual: sin comercio, no entra

        val r = call(HttpMethod.GET, "expenses/summary?groupBy=store", bearer = c.token)
        assertEquals(
            listOf(
                Triple("super mock", 1500L, "ARS"),
                Triple("kiosco mock", 200L, "ARS"),
                Triple("", 50L, "ARS"),
            ),
            rows(r),
        )
        assertEquals("Super Mock", body(r)[0]["label"].asText())
        assertEquals("Sin comercio", body(r)[2]["label"].asText())
    }

    @Test
    fun `summary validates parameters`() {
        val c = owner()

        fun status(q: String) = call(HttpMethod.GET, "expenses/summary?$q", bearer = c.token).response.status
        assertEquals(400, status("groupBy=month&from=2026-03-02&to=2026-03-01"))
        assertEquals(400, status("groupBy=year"))
        assertEquals(400, status("from=2026-01-01")) // groupBy requerido
        assertEquals(400, status("groupBy=month&from=nope"))
        assertEquals(200, status("groupBy=month&from=2026-03-01&to=2026-03-01"))
        assertEquals(401, call(HttpMethod.GET, "expenses/summary?groupBy=month").response.status)
    }

    @Test
    fun `summary is isolated per household`() {
        val a = owner()
        val b = otherHousehold()
        expense(a, "2026-01-10", 1000)
        jdbc.update(
            "INSERT INTO expense (id, household_id, description, amount_minor, currency, expense_date, paid_by, " +
                "source, " +
                "created_by, created_at, updated_at) VALUES (?, ?, 'B', 777, 'ARS', '2026-01-10', ?::uuid, 'MANUAL', ?::uuid, now(), now())",
            UUID.randomUUID(),
            b.householdId,
            b.memberId,
            b.memberId,
        )
        assertEquals(
            listOf(Triple("2026-01", 1000L, "ARS")),
            rows(call(HttpMethod.GET, "expenses/summary?groupBy=month", bearer = a.token)),
        )
        assertEquals(
            listOf(Triple("2026-01", 777L, "ARS")),
            rows(call(HttpMethod.GET, "expenses/summary?groupBy=month", bearer = b.token)),
        )
    }

    @Test
    fun `price history lists unit prices chronologically with store and currency`() {
        val c = owner()
        val leche = product(c, "Leche")
        val otro = product(c, "Pan")
        purchase(c, "2026-03-10", "Super Mock", leche, 1300)
        purchase(c, "2026-01-10", "Kiosco Mock", leche, 1000)
        purchase(c, "2026-02-10", null, leche, 1150)
        purchase(c, "2026-02-11", "Super Mock", otro, 5)

        val r = call(HttpMethod.GET, "products/$leche/price-history", bearer = c.token)
        assertEquals(200, r.response.status, r.response.contentAsString)
        val b = body(r)
        assertEquals(listOf("2026-01-10", "2026-02-10", "2026-03-10"), b.map { it["date"].asText() })
        assertEquals(listOf(1000L, 1150L, 1300L), b.map { it["unitPrice"]["amountMinor"].asLong() })
        assertTrue(b.all { it["unitPrice"]["currency"].asText() == "ARS" })
        assertEquals("Kiosco Mock", b[0]["store"].asText())
        assertTrue(b[1]["store"] == null || b[1]["store"].isNull)

        val ranged =
            body(call(HttpMethod.GET, "products/$leche/price-history?from=2026-02-01&to=2026-02-28", bearer = c.token))
        assertEquals(listOf("2026-02-10"), ranged.map { it["date"].asText() })

        assertEquals(
            400,
            call(
                HttpMethod.GET,
                "products/$leche/price-history?from=2026-03-02&to=2026-03-01",
                bearer = c.token,
            ).response.status,
        )
    }

    @Test
    fun `price history of a product from another household is 404 and empty history is ok`() {
        val a = owner()
        val b = otherHousehold()
        val mine = product(a, "Leche")
        val foreign =
            body(
                call(HttpMethod.POST, "products", mapOf("name" to "Ajeno", "defaultUnit" to "UNIT"), b.token),
            )["id"].asText()
        assertEquals(404, call(HttpMethod.GET, "products/$foreign/price-history", bearer = a.token).response.status)
        assertEquals(
            404,
            call(HttpMethod.GET, "products/${UUID.randomUUID()}/price-history", bearer = a.token).response.status,
        )
        val r = call(HttpMethod.GET, "products/$mine/price-history", bearer = a.token)
        assertEquals(200, r.response.status)
        assertEquals(0, body(r).size())
    }

    @Test
    fun `category summary puts every purchase expense under uncategorized next to categorized manual ones`() {
        val c = owner()
        val lacteos = category(c, "Lácteos")
        expense(c, "2026-02-01", 1000, lacteos)
        expense(c, "2026-02-02", 300)
        purchase(c, "2026-02-03", "Super Mock", product(c, "Leche"), 2000)
        purchase(c, "2026-02-04", "Kiosco Mock", product(c, "Pan"), 500)

        val r = call(HttpMethod.GET, "expenses/summary?groupBy=category", bearer = c.token)
        assertEquals(
            listOf(Triple("uncategorized", 2800L, "ARS"), Triple(lacteos, 1000L, "ARS")),
            rows(r),
        )
        assertEquals("Sin categoría", body(r)[0]["label"].asText())
    }

    @Test
    fun `store summary keeps currencies apart and a store named unspecified does not collide`() {
        val c = owner()
        val p = product(c, "Pan")
        purchase(c, "2026-01-05", "Unspecified", p, 400)
        purchase(c, "2026-01-06", null, p, 100)
        // compra en USD insertada directo (la API solo acepta la moneda base)
        val expenseId = UUID.randomUUID()
        foreignExpense(c, "2026-01-07", 900, "USD")
        jdbc.update("UPDATE expense SET id = ?, source = 'PURCHASE' WHERE currency = 'USD'", expenseId)
        jdbc.update(
            "INSERT INTO purchase (id, household_id, store, purchase_date, total_minor, currency, paid_by, " +
                "expense_id, created_by, created_at, updated_at) " +
                "VALUES (?, ?, 'Unspecified', '2026-01-07', 900, 'USD', ?::uuid, ?, ?::uuid, now(), now())",
            UUID.randomUUID(),
            c.householdId,
            c.memberId,
            expenseId,
            c.memberId,
        )

        val r = call(HttpMethod.GET, "expenses/summary?groupBy=store", bearer = c.token)
        assertEquals(
            listOf(
                Triple("unspecified", 400L, "ARS"),
                Triple("", 100L, "ARS"),
                Triple("unspecified", 900L, "USD"),
            ),
            rows(r),
        )
        assertEquals(listOf("Unspecified", "Sin comercio", "Unspecified"), body(r).map { it["label"].asText() })
    }

    @Test
    fun `price history carries the unit of each line and can be filtered by unit`() {
        val c = owner()
        val queso = product(c, "Queso")
        purchase(c, "2026-01-10", "Super Mock", queso, 800000, unit = "KG")
        purchase(c, "2026-02-10", "Super Mock", queso, 900, unit = "G")
        purchase(c, "2026-03-10", "Super Mock", queso, 820000, unit = "KG")

        val all = body(call(HttpMethod.GET, "products/$queso/price-history", bearer = c.token))
        assertEquals(listOf("KG", "G", "KG"), all.map { it["unit"].asText() })

        val kg = body(call(HttpMethod.GET, "products/$queso/price-history?unit=KG", bearer = c.token))
        assertEquals(listOf(800000L, 820000L), kg.map { it["unitPrice"]["amountMinor"].asLong() })
        val g = body(call(HttpMethod.GET, "products/$queso/price-history?unit=G", bearer = c.token))
        assertEquals(listOf(900L), g.map { it["unitPrice"]["amountMinor"].asLong() })
        assertEquals(
            400,
            call(HttpMethod.GET, "products/$queso/price-history?unit=BOX", bearer = c.token).response.status,
        )
    }

    @Test
    fun `price history includes archived products and skips soft-deleted expenses`() {
        val c = owner()
        val leche = product(c, "Leche")
        purchase(c, "2026-01-10", "Super Mock", leche, 1000)
        purchase(c, "2026-02-10", "Super Mock", leche, 1100)
        jdbc.update(
            "UPDATE expense SET deleted_at = now() WHERE id = (SELECT expense_id FROM purchase WHERE purchase_date = '2026-02-10')",
        )
        assertEquals(200, call(HttpMethod.POST, "products/$leche/archive", bearer = c.token).response.status)

        val b = body(call(HttpMethod.GET, "products/$leche/price-history", bearer = c.token))
        assertEquals(listOf("2026-01-10"), b.map { it["date"].asText() })
    }
}
