package ar.hogar.stock

import ar.hogar.IntegrationTestBase
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
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.assertEquals

@Import(StockIntegrationTest.FixedClockConfig::class)
class StockIntegrationTest : IntegrationTestBase() {
    private companion object {
        const val PASSWORD = "mock-password-123" // Datos mock (docs/07-sensitive-data.md)
        const val ZONE = "Pacific/Auckland" // lejos de UTC para que "hoy" dependa de la zona del hogar

        // Instante fijo (futuro, para que los JWT firmados con este reloj sigan vigentes):
        // 2040-06-15 12:00 UTC = 2040-06-16 00:00 en Auckland (UTC+12).
        val NOW: Instant = Instant.parse("2040-06-15T12:00:00Z")
        val TODAY_AUCKLAND: LocalDate = LocalDate.parse("2040-06-16")
        val TODAY_UTC: LocalDate = LocalDate.parse("2040-06-15")
    }

    @TestConfiguration
    class FixedClockConfig {
        @Bean
        @Primary
        fun fixedClock(): Clock = Clock.fixed(NOW, ZoneOffset.UTC)
    }

    @Autowired lateinit var mapper: ObjectMapper

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

    private fun json(r: MvcResult): JsonNode = mapper.readTree(r.response.contentAsString)

    private fun register(
        email: String = "owner@example.test",
        household: String = "Hogar Mock",
    ): String =
        json(
            call(
                HttpMethod.POST,
                "auth/register-owner",
                mapOf("householdName" to household, "email" to email, "password" to PASSWORD, "displayName" to "Owner"),
            ),
        )["accessToken"].asText()

    private fun product(
        t: String,
        name: String,
        categoryId: String? = null,
    ) = json(
        call(
            HttpMethod.POST,
            "products",
            mapOf("name" to name, "categoryId" to categoryId, "defaultUnit" to "UNIT"),
            t,
        ),
    )["id"].asText()

    private fun add(
        t: String,
        productId: String,
        qty: String,
        expiry: LocalDate? = null,
        location: String? = null,
        unit: String = "UNIT",
    ) = call(
        HttpMethod.POST,
        "stock",
        mapOf(
            "productId" to productId,
            "quantity" to qty,
            "unit" to unit,
            "expiryDate" to expiry?.toString(),
            "location" to location,
        ),
        t,
    )

    private fun consume(
        t: String,
        productId: String,
        qty: String,
        unit: String = "UNIT",
    ) = call(HttpMethod.POST, "stock/consume", mapOf("productId" to productId, "quantity" to qty, "unit" to unit), t)

    /** Hogar en zona Auckland; devuelve "hoy" en esa zona según el reloj fijo inyectado. */
    private fun setZone(): LocalDate {
        jdbc.update("UPDATE household SET timezone = ?", ZONE)
        return TODAY_AUCKLAND
    }

    @Test
    fun `today follows the household timezone for the same instant`() {
        val t = register()
        val p = product(t, "Pan")
        val lot = json(add(t, p, "1", TODAY_UTC))["id"].asText() // vence el 15/06

        fun status() =
            json(call(HttpMethod.GET, "stock", bearer = t))["content"]
                .single { it["id"].asText() == lot }["expiryStatus"]
                .asText()

        jdbc.update("UPDATE household SET timezone = 'UTC'")
        assertEquals("EXPIRING_SOON", status()) // hoy UTC = 15/06
        assertEquals(1, json(call(HttpMethod.GET, "stock/alerts", bearer = t))["expiringSoon"].size())

        setZone() // hoy Auckland = 16/06 -> ya venció
        assertEquals("EXPIRED", status())
        assertEquals(1, json(call(HttpMethod.GET, "stock/alerts", bearer = t))["expired"].size())
        assertEquals(1, json(call(HttpMethod.GET, "stock?expiry=EXPIRED", bearer = t))["content"].size())
    }

    @Test
    fun `patch rejects blank location and out of range expiry date`() {
        val t = register()
        val p = product(t, "Sal")
        val id = json(add(t, p, "1", location = "Despensa"))["id"].asText()
        assertEquals(400, call(HttpMethod.PATCH, "stock/$id", mapOf("location" to "   "), t).response.status)
        assertEquals(400, call(HttpMethod.PATCH, "stock/$id", mapOf("location" to ""), t).response.status)
        assertEquals(400, call(HttpMethod.PATCH, "stock/$id", mapOf("expiryDate" to "0001-01-01"), t).response.status)
        assertEquals(400, add(t, p, "1", LocalDate.parse("3000-01-01")).response.status)
        assertEquals(400, add(t, p, "1", LocalDate.parse("1899-12-31")).response.status)
        // sin cambios por los intentos fallidos
        val item = json(call(HttpMethod.GET, "stock", bearer = t))["content"][0]
        assertEquals("Despensa", item["location"].asText())
        assertEquals(1, json(call(HttpMethod.GET, "stock", bearer = t))["content"].size())
        assertEquals(201, add(t, p, "1", LocalDate.parse("2999-12-31")).response.status)
    }

    @Test
    fun `manual add returns item with 3-decimal quantities and IN movement`() {
        val t = register()
        val today = setZone()
        val leche = product(t, "Leche")
        val r = add(t, leche, "1.5", today.plusDays(10), "  Heladera ")
        assertEquals(201, r.response.status)
        val body = json(r)
        assertEquals("1.500", body["quantity"].asText())
        assertEquals("1.500", body["initialQuantity"].asText())
        assertEquals("ACTIVE", body["status"].asText())
        assertEquals("OK", body["expiryStatus"].asText())
        assertEquals("Heladera", body["location"].asText())
        assertEquals("Leche", body["product"]["name"].asText())
        assertEquals(
            listOf("IN"),
            jdbc.queryForList(
                "SELECT type FROM stock_movement WHERE stock_item_id = ?",
                String::class.java,
                UUID.fromString(body["id"].asText()),
            ),
        )
    }

    @Test
    fun `create validates quantity product and unit`() {
        val t = register()
        val leche = product(t, "Leche")
        assertEquals(400, add(t, leche, "0").response.status)
        assertEquals(400, add(t, leche, "-1").response.status)
        assertEquals(400, add(t, leche, "1.2345").response.status)
        assertEquals(400, add(t, leche, "abc").response.status)
        assertEquals(400, add(t, leche, "1", unit = "BOX").response.status)
        assertEquals(400, call(HttpMethod.POST, "stock", mapOf("productId" to leche), t).response.status)
        assertEquals(404, add(t, UUID.randomUUID().toString(), "1").response.status)
        assertEquals(401, call(HttpMethod.GET, "stock").response.status)
    }

    @Test
    fun `fefo consume crosses lots, depletes them and records movements`() {
        val t = register()
        val today = setZone()
        val p = product(t, "Yogur")
        val late = json(add(t, p, "3", today.plusDays(20)))["id"].asText()
        val none = json(add(t, p, "10"))["id"].asText()
        val soon = json(add(t, p, "2", today.plusDays(2)))["id"].asText()

        val r = consume(t, p, "4")
        assertEquals(200, r.response.status)
        val consumed = json(r)["consumed"]
        assertEquals(listOf(soon, late), consumed.map { it["stockItemId"].asText() })
        assertEquals(listOf("2.000", "2.000"), consumed.map { it["quantity"].asText() })

        val items = json(call(HttpMethod.GET, "stock?status=ACTIVE", bearer = t))["content"]
        // el agotado ya no figura como ACTIVE; orden FEFO con el sin vencimiento al final
        assertEquals(listOf(late, none), items.map { it["id"].asText() })
        assertEquals(listOf("1.000", "10.000"), items.map { it["quantity"].asText() })
        val consumedItems = json(call(HttpMethod.GET, "stock?status=CONSUMED", bearer = t))["content"]
        assertEquals(listOf(soon), consumedItems.map { it["id"].asText() })
        assertEquals("0.000", consumedItems[0]["quantity"].asText())
        assertEquals(
            2,
            jdbc.queryForObject("SELECT count(*) FROM stock_movement WHERE type = 'CONSUME'", Int::class.java),
        )
    }

    @Test
    fun `insufficient stock returns 422 and changes nothing`() {
        val t = register()
        val p = product(t, "Arroz")
        add(t, p, "1")
        add(t, p, "1.5")
        add(t, p, "100", unit = "G") // otra unidad: no suma
        val r = consume(t, p, "2.501")
        assertEquals(422, r.response.status)
        assertEquals("INSUFFICIENT_STOCK", json(r)["code"].asText())
        assertEquals(
            listOf("1.000", "1.500", "100.000"),
            json(call(HttpMethod.GET, "stock", bearer = t))["content"].map { it["quantity"].asText() }.sorted(),
        )
        assertEquals(
            0,
            jdbc.queryForObject("SELECT count(*) FROM stock_movement WHERE type = 'CONSUME'", Int::class.java),
        )
        assertEquals(200, consume(t, p, "2.500").response.status)
        assertEquals(400, consume(t, p, "0").response.status)
        assertEquals(404, consume(t, UUID.randomUUID().toString(), "1").response.status)
    }

    @Test
    fun `consume a specific lot`() {
        val t = register()
        val p = product(t, "Pan")
        val id = json(add(t, p, "3"))["id"].asText()
        val partial = call(HttpMethod.POST, "stock/$id/consume", mapOf("quantity" to "1"), t)
        assertEquals(200, partial.response.status)
        assertEquals("2.000", json(partial)["quantity"].asText())
        assertEquals("ACTIVE", json(partial)["status"].asText())

        val tooMuch = call(HttpMethod.POST, "stock/$id/consume", mapOf("quantity" to "2.001"), t)
        assertEquals(422, tooMuch.response.status)
        assertEquals("INSUFFICIENT_STOCK", json(tooMuch)["code"].asText())

        val rest = call(HttpMethod.POST, "stock/$id/consume", mapOf("quantity" to "2"), t)
        assertEquals("CONSUMED", json(rest)["status"].asText())
        assertEquals("0.000", json(rest)["quantity"].asText())
        // un lote ya consumido no se puede volver a tocar
        assertEquals(409, call(HttpMethod.POST, "stock/$id/consume", mapOf("quantity" to "1"), t).response.status)
        assertEquals(
            404,
            call(HttpMethod.POST, "stock/${UUID.randomUUID()}/consume", mapOf("quantity" to "1"), t).response.status,
        )
    }

    @Test
    fun `discard keeps remaining quantity and reason, and only once`() {
        val t = register()
        val p = product(t, "Queso")
        val id = json(add(t, p, "2"))["id"].asText()
        val r = call(HttpMethod.POST, "stock/$id/discard", mapOf("reason" to "  Con moho "), t)
        assertEquals(200, r.response.status)
        assertEquals("DISCARDED", json(r)["status"].asText())
        assertEquals("2.000", json(r)["quantity"].asText())
        assertEquals("Con moho", jdbc.queryForObject("SELECT discard_reason FROM stock_item", String::class.java))
        assertEquals(409, call(HttpMethod.POST, "stock/$id/discard", null, t).response.status)
        assertEquals(0, json(call(HttpMethod.GET, "stock", bearer = t))["content"].size())
        assertEquals(1, json(call(HttpMethod.GET, "stock?status=DISCARDED", bearer = t))["content"].size())
        // sin body también es válido
        val id2 = json(add(t, p, "1"))["id"].asText()
        assertEquals(200, call(HttpMethod.POST, "stock/$id2/discard", null, t).response.status)
    }

    @Test
    fun `patch edits metadata and adjusts quantity with signed ADJUST movement`() {
        val t = register()
        val today = setZone()
        val p = product(t, "Jugo")
        val id = json(add(t, p, "5"))["id"].asText()
        val r =
            call(
                HttpMethod.PATCH,
                "stock/$id",
                mapOf("expiryDate" to today.minusDays(1).toString(), "location" to "Despensa", "quantity" to "3.5"),
                t,
            )
        assertEquals(200, r.response.status)
        assertEquals("3.500", json(r)["quantity"].asText())
        assertEquals("5.000", json(r)["initialQuantity"].asText())
        assertEquals("EXPIRED", json(r)["expiryStatus"].asText())
        assertEquals("Despensa", json(r)["location"].asText())
        assertEquals(
            "-1.500",
            jdbc.queryForObject("SELECT quantity::text FROM stock_movement WHERE type = 'ADJUST'", String::class.java),
        )
        // ajustar a 0 lo deja CONSUMED
        assertEquals(
            "CONSUMED",
            json(call(HttpMethod.PATCH, "stock/$id", mapOf("quantity" to "0"), t))["status"].asText(),
        )
        assertEquals(409, call(HttpMethod.PATCH, "stock/$id", mapOf("location" to "x"), t).response.status)
        assertEquals(
            404,
            call(HttpMethod.PATCH, "stock/${UUID.randomUUID()}", mapOf("location" to "x"), t).response.status,
        )
        val id2 = json(add(t, p, "1"))["id"].asText()
        assertEquals(400, call(HttpMethod.PATCH, "stock/$id2", mapOf("quantity" to "-1"), t).response.status)
    }

    @Test
    fun `expiry status and filters use the household timezone`() {
        val t = register()
        val today = setZone()
        val p = product(t, "Fiambre")
        val expired = json(add(t, p, "1", today.minusDays(1)))["id"].asText()
        val dueToday = json(add(t, p, "1", today))["id"].asText()
        val edge = json(add(t, p, "1", today.plusDays(3)))["id"].asText() // default 3 días
        val ok = json(add(t, p, "1", today.plusDays(4)))["id"].asText()
        val none = json(add(t, p, "1"))["id"].asText()

        val all = json(call(HttpMethod.GET, "stock", bearer = t))["content"]
        assertEquals(listOf(expired, dueToday, edge, ok, none), all.map { it["id"].asText() })
        assertEquals(
            listOf("EXPIRED", "EXPIRING_SOON", "EXPIRING_SOON", "OK", "NO_EXPIRY"),
            all.map { it["expiryStatus"].asText() },
        )

        fun ids(q: String) =
            json(call(HttpMethod.GET, "stock?expiry=$q", bearer = t))["content"].map { it["id"].asText() }
        assertEquals(listOf(expired), ids("EXPIRED"))
        assertEquals(listOf(dueToday, edge), ids("EXPIRING_SOON"))
        assertEquals(listOf(ok), ids("OK"))

        val alerts = json(call(HttpMethod.GET, "stock/alerts", bearer = t))
        assertEquals(listOf(expired), alerts["expired"].map { it["id"].asText() })
        assertEquals(listOf(dueToday, edge), alerts["expiringSoon"].map { it["id"].asText() })

        // la ventana de aviso es configurable por hogar
        jdbc.update("UPDATE household SET expiry_warning_days = 0")
        assertEquals(listOf(dueToday), ids("EXPIRING_SOON"))
    }

    @Test
    fun `list filters by product category location and paginates`() {
        val t = register()
        val cat = json(call(HttpMethod.POST, "categories", mapOf("name" to "Lácteos"), t))["id"].asText()
        val leche = product(t, "Leche", cat)
        val pan = product(t, "Pan")
        add(t, leche, "1", location = "Heladera")
        add(t, pan, "1", location = "Despensa")
        add(t, pan, "2", location = "despensa")

        fun count(q: String) = json(call(HttpMethod.GET, "stock?$q", bearer = t))["content"].size()
        assertEquals(1, count("productId=$leche"))
        assertEquals(1, count("categoryId=$cat"))
        assertEquals(2, count("location=DESPENSA"))
        assertEquals(0, count("location=Freezer"))

        val page = json(call(HttpMethod.GET, "stock?size=2&page=1", bearer = t))
        assertEquals(1, page["content"].size())
        assertEquals(3, page["totalElements"].asInt())
        assertEquals(2, page["totalPages"].asInt())
        assertEquals(400, call(HttpMethod.GET, "stock?size=0", bearer = t).response.status)
        assertEquals(400, call(HttpMethod.GET, "stock?expiry=SOON", bearer = t).response.status)
    }

    @Test
    fun `summary groups active lots by product and unit`() {
        val t = register()
        val today = setZone()
        val leche = product(t, "Leche")
        val arroz = product(t, "Arroz")
        add(t, leche, "1.5", today.plusDays(9))
        add(t, leche, "2", today.plusDays(5))
        add(t, leche, "1")
        add(t, leche, "500", unit = "ML")
        add(t, arroz, "1", unit = "KG")
        val discarded = json(add(t, arroz, "9", unit = "KG"))["id"].asText()
        call(HttpMethod.POST, "stock/$discarded/discard", null, t)

        val rows = json(call(HttpMethod.GET, "stock/summary", bearer = t))
        assertEquals(
            listOf("Arroz/KG/1.000/null", "Leche/ML/500.000/null", "Leche/UNIT/4.500/${today.plusDays(5)}"),
            rows.map {
                "${it["product"]["name"].asText()}/${it["unit"].asText()}/${it["totalQuantity"].asText()}/" +
                    (it["nearestExpiry"]?.takeUnless { n -> n.isNull }?.asText() ?: "null")
            },
        )
    }

    @Test
    fun `stock is isolated per household`() {
        val t = register()
        // otro hogar insertado directo (register-owner solo admite uno)
        val otherHousehold = UUID.randomUUID()
        val otherProduct = UUID.randomUUID()
        val otherItem = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO household (id, name, created_at, updated_at) VALUES (?, 'Otra casa', now(), now())",
            otherHousehold,
        )
        jdbc.update(
            "INSERT INTO product (id, household_id, name, default_unit, created_at, updated_at) VALUES (?, ?, 'Ajeno', 'UNIT', now(), now())",
            otherProduct,
            otherHousehold,
        )
        jdbc.update(
            "INSERT INTO stock_item " +
                "(id, household_id, product_id, quantity, initial_quantity, unit, added_at, updated_at) " +
                "VALUES (?, ?, ?, 1, 1, 'UNIT', now(), now())",
            otherItem,
            otherHousehold,
            otherProduct,
        )
        assertEquals(0, json(call(HttpMethod.GET, "stock", bearer = t))["content"].size())
        assertEquals(0, json(call(HttpMethod.GET, "stock/summary", bearer = t)).size())
        assertEquals(404, call(HttpMethod.POST, "stock/$otherItem/discard", null, t).response.status)
        assertEquals(
            404,
            call(HttpMethod.POST, "stock/$otherItem/consume", mapOf("quantity" to "1"), t).response.status,
        )
        assertEquals(404, call(HttpMethod.PATCH, "stock/$otherItem", mapOf("location" to "x"), t).response.status)
        assertEquals(404, add(t, otherProduct.toString(), "1").response.status)
        assertEquals(404, consume(t, otherProduct.toString(), "1").response.status)
    }
}
