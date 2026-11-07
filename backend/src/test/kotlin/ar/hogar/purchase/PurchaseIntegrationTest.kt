package ar.hogar.purchase

import ar.hogar.IntegrationTestBase
import ar.hogar.auth.JwtService
import ar.hogar.auth.Member
import ar.hogar.auth.Role
import ar.hogar.stock.StockService
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.doThrow
import org.mockito.Mockito.reset
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PurchaseIntegrationTest : IntegrationTestBase() {
    private companion object {
        const val PASSWORD = "mock-password-123" // Datos mock (docs/07-sensitive-data.md)
        val ZERO = UUID(0, 0)

        // Matchers de Mockito con valor de relleno no nulo (los parámetros de Kotlin no aceptan null).
        fun <T : Any> anyOf(
            type: Class<T>,
            filler: T,
        ): T {
            ArgumentMatchers.any(type)
            return filler
        }

        fun <T : Any> eqOf(value: T): T {
            ArgumentMatchers.eq(value)
            return value
        }
    }

    @Autowired lateinit var mapper: ObjectMapper

    @Autowired lateinit var jwt: JwtService

    @MockitoSpyBean lateinit var stockService: StockService

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
        return Ctx(token, body(call(HttpMethod.GET, "me", bearer = token))["member"]["id"].asText())
    }

    /** Hay un solo hogar vía API; el segundo se crea directo en la base. */
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
        val now = java.time.Instant.now()
        return Ctx(jwt.issueAccessToken(Member(m, h, "b@example.test", "x", "B", Role.OWNER, true, now, now)), "$m")
    }

    private fun product(
        c: Ctx,
        name: String,
        shelfLifeDays: Int? = null,
    ) = body(
        call(
            HttpMethod.POST,
            "products",
            mapOf("name" to name, "defaultUnit" to "UNIT", "defaultShelfLifeDays" to shelfLifeDays),
            c.token,
        ),
    )["id"].asText()

    private fun newList(
        c: Ctx,
        name: String = "Compra semanal",
    ) = body(call(HttpMethod.POST, "shopping-lists", mapOf("name" to name), c.token))["id"].asText()

    /** Alta de ítem; devuelve el id del ítem. Si [checked], lo tilda. */
    private fun listItem(
        c: Ctx,
        listId: String,
        productId: String,
        qty: String = "2",
        checked: Boolean = false,
    ): String {
        val id =
            body(
                call(
                    HttpMethod.POST,
                    "shopping-lists/$listId/items",
                    mapOf("productId" to productId, "quantity" to qty, "unit" to "UNIT"),
                    c.token,
                ),
            )["id"].asText()
        if (checked) call(HttpMethod.PATCH, "shopping-lists/$listId/items/$id", mapOf("checked" to true), c.token)
        return id
    }

    private fun money(
        minor: Long,
        currency: String = "ARS",
    ) = mapOf("amountMinor" to minor, "currency" to currency)

    private fun line(
        productId: String,
        qty: String,
        priceMinor: Long,
        listItemId: String? = null,
        expiry: String? = null,
        currency: String = "ARS",
    ) = mapOf(
        "listItemId" to listItemId,
        "productId" to productId,
        "quantity" to qty,
        "unit" to "UNIT",
        "unitPrice" to money(priceMinor, currency),
        "expiryDate" to expiry,
    )

    private fun completeBody(
        c: Ctx,
        items: List<Map<String, Any?>>,
        total: Long = 5000,
        leftover: String = "NEW_LIST",
        store: String? = "Super Mock",
        date: String = "2026-03-10",
        currency: String = "ARS",
        paidBy: String = c.memberId,
    ) = mapOf(
        "purchaseDate" to date,
        "store" to store,
        "paidBy" to paidBy,
        "total" to money(total, currency),
        "items" to items,
        "leftoverAction" to leftover,
    )

    private fun count(table: String) = jdbc.queryForObject("SELECT count(*) FROM $table", Long::class.java)!!

    private fun listStatus(id: String) =
        jdbc.queryForObject("SELECT status FROM shopping_list WHERE id = ?::uuid", String::class.java, id)

    @Test
    fun `completing a list creates purchase, expense, stock and leaves the list COMPLETED`() {
        val c = owner()
        val leche = product(c, "Leche", shelfLifeDays = 7)
        val sal = product(c, "Sal") // sin vida útil por defecto
        val jabon = product(c, "Jabón")
        val list = newList(c)
        val iLeche = listItem(c, list, leche, "2", checked = true)
        val iSal = listItem(c, list, sal, "1", checked = true)
        listItem(c, list, jabon, "3") // sin tildar → queda para la lista nueva

        val r =
            call(
                HttpMethod.POST,
                "shopping-lists/$list/complete",
                completeBody(
                    c,
                    listOf(
                        line(leche, "2", 1250, iLeche), // 2 × 1250 = 2500
                        line(sal, "1.500", 333, iSal, expiry = "2027-01-01"), // 1,5 × 333 = 499,5 → 500
                        line(product(c, "Extra"), "1", 1000), // extra no listado
                    ),
                    total = 3900, // ≠ Σ ítems (4000): descuento permitido
                ),
                c.token,
            )
        assertEquals(201, r.response.status, r.response.contentAsString)
        val p = body(r)
        assertEquals(list, p["shoppingListId"].asText())
        assertEquals(3900, p["total"]["amountMinor"].asLong())
        assertEquals("Owner", p["paidBy"]["displayName"].asText())
        assertEquals(listOf(2500L, 500L, 1000L), p["items"].map { it["total"]["amountMinor"].asLong() })

        // gasto PURCHASE por el total, visible en el histórico
        val expense = body(call(HttpMethod.GET, "expenses/${p["expenseId"].asText()}", bearer = c.token))
        assertEquals("PURCHASE", expense["source"].asText())
        assertEquals(3900, expense["amount"]["amountMinor"].asLong())
        assertEquals("2026-03-10", expense["expenseDate"].asText())
        assertEquals("Compra Super Mock", jdbc.queryForObject("SELECT description FROM expense", String::class.java))

        // stock: un lote por ítem, vinculado al ítem de compra, con vencimiento
        assertEquals(3L, count("stock_item"))
        assertEquals(3L, count("stock_movement WHERE type = 'IN'"))
        val expiryOf = { pid: String ->
            jdbc.queryForObject(
                "SELECT expiry_date::text FROM stock_item WHERE product_id = ?::uuid",
                String::class.java,
                pid,
            )
        }
        assertEquals("2026-03-17", expiryOf(leche)) // 2026-03-10 + 7 días (defaultShelfLifeDays)
        assertEquals("2027-01-01", expiryOf(sal)) // el informado manda
        assertEquals(
            3L,
            count("stock_item s JOIN purchase_item pi ON pi.id = s.purchase_item_id"),
        )
        assertEquals(
            "1.500",
            jdbc.queryForObject(
                "SELECT quantity::text FROM stock_item WHERE product_id = ?::uuid",
                String::class.java,
                sal,
            ),
        )

        // lista COMPLETED + lista nueva con el ítem sin tildar
        assertEquals("COMPLETED", listStatus(list))
        val open = body(call(HttpMethod.GET, "shopping-lists?status=OPEN", bearer = c.token))["content"]
        assertEquals(1, open.size())
        val fresh = body(call(HttpMethod.GET, "shopping-lists/${open[0]["id"].asText()}", bearer = c.token))
        assertEquals(1, fresh["items"].size())
        assertEquals(jabon, fresh["items"][0]["product"]["id"].asText())
        assertEquals("3.000", fresh["items"][0]["quantity"].asText())
        assertEquals(false, fresh["items"][0]["checked"].asBoolean())
    }

    @Test
    fun `retrying a completed list answers 422 LIST_NOT_OPEN and creates nothing more`() {
        val c = owner()
        val p = product(c, "Pan")
        val list = newList(c)
        val item = listItem(c, list, p, checked = true)
        val req = completeBody(c, listOf(line(p, "2", 500, item)), total = 1000)
        assertEquals(201, call(HttpMethod.POST, "shopping-lists/$list/complete", req, c.token).response.status)

        val retry = call(HttpMethod.POST, "shopping-lists/$list/complete", req, c.token)
        assertEquals(422, retry.response.status)
        assertEquals("LIST_NOT_OPEN", body(retry)["code"].asText())
        assertEquals(1L, count("purchase"))
        assertEquals(1L, count("expense"))
        assertEquals(1L, count("stock_item"))
    }

    @Test
    fun `leftoverAction DISCARD does not create a new list and NEW_LIST skips empty leftovers`() {
        val c = owner()
        val a = product(c, "A")
        val b = product(c, "B")
        val l1 = newList(c, "L1")
        val i1 = listItem(c, l1, a, checked = true)
        listItem(c, l1, b)
        assertEquals(
            201,
            call(
                HttpMethod.POST,
                "shopping-lists/$l1/complete",
                completeBody(c, listOf(line(a, "1", 100, i1)), 100, leftover = "DISCARD"),
                c.token,
            ).response.status,
        )
        assertEquals(0, body(call(HttpMethod.GET, "shopping-lists?status=OPEN", bearer = c.token))["content"].size())

        val l2 = newList(c, "L2")
        val i2 = listItem(c, l2, a, checked = true)
        assertEquals(
            201,
            call(
                HttpMethod.POST,
                "shopping-lists/$l2/complete",
                completeBody(c, listOf(line(a, "1", 100, i2)), 100),
                c.token,
            ).response.status,
        )
        assertEquals(0, body(call(HttpMethod.GET, "shopping-lists?status=OPEN", bearer = c.token))["content"].size())
    }

    @Test
    fun `a failure creating stock rolls everything back`() {
        val c = owner()
        val a = product(c, "A")
        val b = product(c, "B")
        val list = newList(c)
        val ia = listItem(c, list, a, checked = true)
        val ib = listItem(c, list, b, checked = true)
        try {
            // El alta del 2º lote falla: ya existen en la transacción gasto, compra, ítems y el 1º lote.
            doThrow(IllegalStateException("boom"))
                .`when`(stockService)
                .addPurchased(
                    anyOf(UUID::class.java, ZERO),
                    anyOf(UUID::class.java, ZERO),
                    eqOf(UUID.fromString(b)),
                    anyOf(java.math.BigDecimal::class.java, java.math.BigDecimal.ONE),
                    anyOf(ar.hogar.catalog.Unit::class.java, ar.hogar.catalog.Unit.UNIT),
                    ArgumentMatchers.any(),
                    anyOf(UUID::class.java, ZERO),
                )
            // Sin handler genérico MockMvc relanza la excepción: en producción sería un 500.
            val failure =
                runCatching {
                    call(
                        HttpMethod.POST,
                        "shopping-lists/$list/complete",
                        completeBody(c, listOf(line(a, "1", 100, ia), line(b, "1", 100, ib)), 200),
                        c.token,
                    )
                }.exceptionOrNull()
            assertTrue(failure?.cause is IllegalStateException, "expected the forced failure, got $failure")
        } finally {
            reset(stockService)
        }
        assertEquals(0L, count("purchase"))
        assertEquals(0L, count("purchase_item"))
        assertEquals(0L, count("expense"))
        assertEquals(0L, count("stock_item"))
        assertEquals(0L, count("stock_movement"))
        assertEquals("OPEN", listStatus(list))
        assertEquals(1L, count("shopping_list"))
    }

    @Test
    fun `two simultaneous completions of the same list produce one purchase and one 422`() {
        val c = owner()
        val p = product(c, "Pan")
        val list = newList(c)
        val item = listItem(c, list, p, checked = true)
        val req = completeBody(c, listOf(line(p, "1", 500, item)), 500, leftover = "DISCARD")
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val futures =
                (1..2).map {
                    pool.submit<Int> {
                        start.await()
                        call(HttpMethod.POST, "shopping-lists/$list/complete", req, c.token).response.status
                    }
                }
            start.countDown()
            val statuses = futures.map { it.get() }.sorted()
            assertEquals(listOf(201, 422), statuses)
        } finally {
            pool.shutdownNow()
        }
        assertEquals(1L, count("purchase"))
        assertEquals(1L, count("expense"))
        assertEquals(1L, count("stock_item"))
    }

    @Test
    fun `completing validates the request and isolates households`() {
        val c = owner()
        val p = product(c, "Pan")
        val list = newList(c)
        val item = listItem(c, list, p, checked = true)
        val ok = line(p, "1", 500, item)
        val path = "shopping-lists/$list/complete"

        fun status(b: Map<String, Any?>) = call(HttpMethod.POST, path, b, c.token).response.status

        assertEquals(400, status(completeBody(c, listOf(ok), total = 0)))
        assertEquals(400, status(completeBody(c, emptyList())))
        assertEquals(400, status(completeBody(c, listOf(line(p, "1", 500, UUID.randomUUID().toString())))))
        assertEquals(400, status(completeBody(c, listOf(ok, ok)))) // mismo listItemId dos veces
        assertEquals(400, status(completeBody(c, listOf(ok), paidBy = UUID.randomUUID().toString())))
        assertEquals(404, status(completeBody(c, listOf(line(UUID.randomUUID().toString(), "1", 5)))))
        val usd = call(HttpMethod.POST, path, completeBody(c, listOf(ok), currency = "USD"), c.token)
        assertEquals(422, usd.response.status)
        assertEquals("UNSUPPORTED_CURRENCY", body(usd)["code"].asText())
        assertEquals("OPEN", listStatus(list))
        assertEquals(0L, count("purchase"))

        val b = otherHousehold()
        assertEquals(404, call(HttpMethod.POST, path, completeBody(b, listOf(ok)), b.token).response.status)
        val created = call(HttpMethod.POST, path, completeBody(c, listOf(ok), 500), c.token)
        assertEquals(201, created.response.status)
        val id = body(created)["id"].asText()
        assertEquals(404, call(HttpMethod.GET, "purchases/$id", bearer = b.token).response.status)
        assertEquals(404, call(HttpMethod.PUT, "purchases/$id", mapOf("items" to listOf(ok)), b.token).response.status)
        assertEquals(0, body(call(HttpMethod.GET, "purchases", bearer = b.token))["content"].size())
    }

    @Test
    fun `purchase without a list has the same effects and can be listed`() {
        val c = owner()
        val leche = product(c, "Leche", shelfLifeDays = 5)
        val mk = { store: String, date: String, total: Long ->
            call(
                HttpMethod.POST,
                "purchases",
                mapOf(
                    "purchaseDate" to date,
                    "store" to store,
                    "paidBy" to c.memberId,
                    "total" to money(total),
                    "items" to listOf(line(leche, "1", total)),
                ),
                c.token,
            )
        }
        val first = mk("Almacén 100%", "2026-03-01", 700)
        assertEquals(201, first.response.status, first.response.contentAsString)
        assertNull(body(first)["shoppingListId"]?.takeIf { !it.isNull })
        mk("Verdulería", "2026-04-01", 900)
        assertEquals(2L, count("expense WHERE source = 'PURCHASE'"))
        assertEquals(2L, count("stock_item"))

        fun list(q: String) = body(call(HttpMethod.GET, "purchases?$q", bearer = c.token))

        val all = list("")
        assertEquals(listOf("Verdulería", "Almacén 100%"), all["content"].map { it["store"].asText() })
        assertEquals(1, all["content"][0]["itemCount"].asInt())
        assertEquals(2, all["totalElements"].asInt())
        assertEquals(1, list("from=2026-03-15")["content"].size())
        assertEquals(1, list("to=2026-03-15")["content"].size())
        assertEquals(1, list("store=100%")["content"].size())
        assertEquals(1, list("store=verdu")["content"].size())
        assertEquals(
            400,
            call(HttpMethod.GET, "purchases?from=2026-05-01&to=2026-01-01", bearer = c.token).response.status,
        )

        val detail = body(call(HttpMethod.GET, "purchases/${body(first)["id"].asText()}", bearer = c.token))
        assertEquals("Leche", detail["items"][0]["product"]["name"].asText())
    }

    @Test
    fun `editing a purchase recalculates its expense and replaces items`() {
        val c = owner()
        val leche = product(c, "Leche", shelfLifeDays = 5)
        val pan = product(c, "Pan")
        val list = newList(c)
        val item = listItem(c, list, leche, checked = true)
        val created =
            body(
                call(
                    HttpMethod.POST,
                    "shopping-lists/$list/complete",
                    completeBody(c, listOf(line(leche, "2", 500, item)), 1000, store = null),
                    c.token,
                ),
            )
        val id = created["id"].asText()
        val expenseId = created["expenseId"].asText()
        assertEquals(
            "Compra Compra semanal",
            jdbc.queryForObject("SELECT description FROM expense", String::class.java),
        )

        val put =
            call(
                HttpMethod.PUT,
                "purchases/$id",
                mapOf(
                    "store" to "Otro Super",
                    "purchaseDate" to "2026-03-12",
                    "total" to money(1800),
                    "items" to listOf(line(leche, "2", 600), line(pan, "1", 400)),
                ),
                c.token,
            )
        assertEquals(200, put.response.status, put.response.contentAsString)
        val updated = body(put)
        assertEquals(1800, updated["total"]["amountMinor"].asLong())
        assertEquals("Otro Super", updated["store"].asText())
        assertEquals(
            listOf(1200L, 400L),
            updated["items"].map { it["total"]["amountMinor"].asLong() }.sorted().reversed(),
        )
        assertEquals(expenseId, updated["expenseId"].asText())

        val expense = body(call(HttpMethod.GET, "expenses/$expenseId", bearer = c.token))
        assertEquals(1800, expense["amount"]["amountMinor"].asLong())
        assertEquals("2026-03-12", expense["expenseDate"].asText())
        assertEquals("Compra Otro Super", jdbc.queryForObject("SELECT description FROM expense", String::class.java))
        assertEquals("PURCHASE", expense["source"].asText())
        assertEquals(1L, count("expense"))
        assertEquals(2L, count("purchase_item"))
        // el stock ya creado se conserva, desvinculado del ítem reemplazado
        assertEquals(1L, count("stock_item"))
        assertEquals(1L, count("stock_item WHERE purchase_item_id IS NULL"))

        // omitir campos los deja como estaban; el gasto de una compra sigue sin editarse directo
        val keep = body(call(HttpMethod.PUT, "purchases/$id", mapOf("items" to listOf(line(pan, "1", 400))), c.token))
        assertEquals(1800, keep["total"]["amountMinor"].asLong())
        assertEquals("Otro Super", keep["store"].asText())
        assertEquals(
            409,
            call(
                HttpMethod.PUT,
                "expenses/$expenseId",
                mapOf(
                    "description" to "x",
                    "amount" to money(1),
                    "expenseDate" to "2026-03-01",
                    "paidBy" to c.memberId,
                ),
                c.token,
            ).response.status,
        )
        assertEquals(
            400,
            call(
                HttpMethod.PUT,
                "purchases/$id",
                mapOf(
                    "total" to money(0),
                    "items" to listOf(line(pan, "1", 1)),
                ),
                c.token,
            ).response.status,
        )
        assertEquals(
            400,
            call(HttpMethod.PUT, "purchases/$id", mapOf("items" to emptyList<Any>()), c.token).response.status,
        )
    }
}
