package ar.hogar.shopping

import ar.hogar.IntegrationTestBase
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ShoppingIntegrationTest : IntegrationTestBase() {
    private companion object {
        const val PASSWORD = "mock-password-123" // dato mock (docs/07-sensitive-data.md)
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

    private fun body(r: MvcResult): JsonNode = mapper.readTree(r.response.contentAsString)

    private fun registerOwner(
        email: String = "owner@example.test",
        household: String = "Hogar Mock",
    ): String =
        body(
            call(
                HttpMethod.POST,
                "auth/register-owner",
                mapOf("householdName" to household, "email" to email, "password" to PASSWORD, "displayName" to "Owner"),
            ),
        )["accessToken"].asText()

    private fun product(
        t: String,
        name: String,
    ): String =
        body(call(HttpMethod.POST, "products", mapOf("name" to name, "defaultUnit" to "UNIT"), t))["id"].asText()

    private fun newList(
        t: String,
        name: String = "Semanal",
    ): String = body(call(HttpMethod.POST, "shopping-lists", mapOf("name" to name), t))["id"].asText()

    private fun addItem(
        t: String,
        list: String,
        productId: String,
        qty: String = "1",
        unit: String = "UNIT",
        extra: Map<String, Any?> = emptyMap(),
    ) = call(
        HttpMethod.POST,
        "shopping-lists/$list/items",
        mapOf("productId" to productId, "quantity" to qty, "unit" to unit) + extra,
        t,
    )

    @Test
    fun `create and get list`() {
        val t = registerOwner()
        val created = call(HttpMethod.POST, "shopping-lists", mapOf("name" to "  Semanal "), t)
        assertEquals(201, created.response.status)
        val b = body(created)
        assertEquals("Semanal", b["name"].asText())
        assertEquals("OPEN", b["status"].asText())
        assertEquals(0, b["items"].size())
        val get = call(HttpMethod.GET, "shopping-lists/${b["id"].asText()}", bearer = t)
        assertEquals(200, get.response.status)
        assertEquals(b["createdBy"].asText(), body(get)["createdBy"].asText())
        assertEquals(400, call(HttpMethod.POST, "shopping-lists", mapOf("name" to " "), t).response.status)
        assertEquals(404, call(HttpMethod.GET, "shopping-lists/${UUID.randomUUID()}", bearer = t).response.status)
        assertEquals(401, call(HttpMethod.GET, "shopping-lists").response.status)
    }

    @Test
    fun `lists are scoped to household`() {
        val t = registerOwner()
        val id = newList(t)
        // un segundo token de otro hogar no puede existir (un solo hogar); un id ajeno inexistente es 404
        assertEquals(404, call(HttpMethod.GET, "shopping-lists/${UUID.randomUUID()}", bearer = t).response.status)
        assertEquals(200, call(HttpMethod.GET, "shopping-lists/$id", bearer = t).response.status)
    }

    @Test
    fun `adding the same product and unit sums quantity, different unit adds new item`() {
        val t = registerOwner()
        val list = newList(t)
        val leche = product(t, "Leche")
        val first = addItem(t, list, leche, "1.5", "L", mapOf("note" to "entera"))
        assertEquals(201, first.response.status)
        assertEquals("1.500", body(first)["quantity"].asText())
        val second = addItem(t, list, leche, "2", "L")
        assertEquals(201, second.response.status)
        assertEquals(body(first)["id"].asText(), body(second)["id"].asText())
        assertEquals("3.500", body(second)["quantity"].asText())
        assertEquals("entera", body(second)["note"].asText())
        addItem(t, list, leche, "1", "UNIT")
        val items = body(call(HttpMethod.GET, "shopping-lists/$list", bearer = t))["items"]
        assertEquals(2, items.size())
    }

    @Test
    fun `item validation`() {
        val t = registerOwner()
        val list = newList(t)
        val p = product(t, "Pan")
        assertEquals(400, addItem(t, list, p, "0").response.status)
        assertEquals(400, addItem(t, list, p, "-1").response.status)
        assertEquals(400, addItem(t, list, p, "1.2345").response.status)
        assertEquals(400, addItem(t, list, p, "1", "BOX").response.status)
        assertEquals(
            400,
            call(HttpMethod.POST, "shopping-lists/$list/items", mapOf("quantity" to "1"), t).response.status,
        )
        assertEquals(404, addItem(t, list, UUID.randomUUID().toString()).response.status)
        assertEquals(404, addItem(t, UUID.randomUUID().toString(), p).response.status)
        assertEquals(
            400,
            addItem(t, list, p, extra = mapOf("estimatedPrice" to mapOf("amountMinor" to -5, "currency" to "ARS")))
                .response.status,
        )
        assertEquals(
            422,
            addItem(t, list, p, extra = mapOf("estimatedPrice" to mapOf("amountMinor" to 500, "currency" to "USD")))
                .response.status,
        )
    }

    @Test
    fun `estimated price is stored as minor units plus currency`() {
        val t = registerOwner()
        val list = newList(t)
        val p = product(t, "Café")
        val r =
            addItem(
                t,
                list,
                p,
                extra =
                    mapOf(
                        "estimatedPrice" to mapOf("amountMinor" to 123450, "currency" to "ARS"),
                    ),
            )
        assertEquals(123450, body(r)["estimatedPrice"]["amountMinor"].asLong())
        assertEquals("ARS", body(r)["estimatedPrice"]["currency"].asText())
        val none = addItem(t, list, product(t, "Té"))
        assertNull(body(none)["estimatedPrice"].takeUnless { it.isNull })
    }

    @Test
    fun `patch item checks, edits and orders checked items last`() {
        val t = registerOwner()
        val list = newList(t)
        val a = body(addItem(t, list, product(t, "A")))["id"].asText()
        addItem(t, list, product(t, "B"))
        val checked = call(HttpMethod.PATCH, "shopping-lists/$list/items/$a", mapOf("checked" to true), t)
        assertEquals(200, checked.response.status)
        assertEquals(true, body(checked)["checked"].asBoolean())
        assertEquals(false, body(checked)["checkedAt"].isNull)

        val detail = body(call(HttpMethod.GET, "shopping-lists/$list", bearer = t))
        assertEquals(listOf("B", "A"), detail["items"].map { it["product"]["name"].asText() })

        val edited =
            call(
                HttpMethod.PATCH,
                "shopping-lists/$list/items/$a",
                mapOf("quantity" to "4.25", "unit" to "KG", "note" to "x", "checked" to false),
                t,
            )
        assertEquals("4.250", body(edited)["quantity"].asText())
        assertEquals("KG", body(edited)["unit"].asText())
        assertEquals(true, body(edited)["checkedAt"].isNull)

        assertEquals(
            400,
            call(HttpMethod.PATCH, "shopping-lists/$list/items/$a", mapOf("quantity" to "0"), t).response.status,
        )
        assertEquals(
            404,
            call(HttpMethod.PATCH, "shopping-lists/$list/items/${UUID.randomUUID()}", mapOf("checked" to true), t)
                .response.status,
        )
    }

    @Test
    fun `changing unit to a duplicate product and unit conflicts`() {
        val t = registerOwner()
        val list = newList(t)
        val p = product(t, "Arroz")
        addItem(t, list, p, "1", "KG")
        val other = body(addItem(t, list, p, "1", "PACK"))["id"].asText()
        assertEquals(
            409,
            call(HttpMethod.PATCH, "shopping-lists/$list/items/$other", mapOf("unit" to "KG"), t).response.status,
        )
    }

    @Test
    fun `delete item`() {
        val t = registerOwner()
        val list = newList(t)
        val item = body(addItem(t, list, product(t, "A")))["id"].asText()
        assertEquals(204, call(HttpMethod.DELETE, "shopping-lists/$list/items/$item", bearer = t).response.status)
        assertEquals(404, call(HttpMethod.DELETE, "shopping-lists/$list/items/$item", bearer = t).response.status)
        assertEquals(0, body(call(HttpMethod.GET, "shopping-lists/$list", bearer = t))["items"].size())
    }

    @Test
    fun `rename and archive`() {
        val t = registerOwner()
        val list = newList(t)
        val renamed = call(HttpMethod.PATCH, "shopping-lists/$list", mapOf("name" to "Mensual"), t)
        assertEquals("Mensual", body(renamed)["name"].asText())
        assertEquals(400, call(HttpMethod.PATCH, "shopping-lists/$list", mapOf("name" to ""), t).response.status)
        assertEquals(
            400,
            call(HttpMethod.PATCH, "shopping-lists/$list", mapOf("status" to "COMPLETED"), t).response.status,
        )
        assertEquals(400, call(HttpMethod.PATCH, "shopping-lists/$list", mapOf("status" to "OPEN"), t).response.status)
        val archived = call(HttpMethod.PATCH, "shopping-lists/$list", mapOf("status" to "ARCHIVED"), t)
        assertEquals("ARCHIVED", body(archived)["status"].asText())
    }

    @Test
    fun `non open list is read only with LIST_NOT_OPEN`() {
        val t = registerOwner()
        val list = newList(t)
        val p = product(t, "A")
        val item = body(addItem(t, list, p))["id"].asText()
        call(HttpMethod.PATCH, "shopping-lists/$list", mapOf("status" to "ARCHIVED"), t)

        fun assertNotOpen(r: MvcResult) {
            assertEquals(422, r.response.status)
            assertEquals("LIST_NOT_OPEN", body(r)["code"].asText())
        }
        assertNotOpen(addItem(t, list, p))
        assertNotOpen(call(HttpMethod.PATCH, "shopping-lists/$list/items/$item", mapOf("checked" to true), t))
        assertNotOpen(call(HttpMethod.DELETE, "shopping-lists/$list/items/$item", bearer = t))
        assertNotOpen(call(HttpMethod.PATCH, "shopping-lists/$list", mapOf("name" to "X"), t))
        assertNotOpen(call(HttpMethod.PATCH, "shopping-lists/$list", mapOf("status" to "ARCHIVED"), t))
        assertEquals(200, call(HttpMethod.GET, "shopping-lists/$list", bearer = t).response.status)

        // una lista COMPLETED (la completa BL-108) también es de solo lectura
        val done = newList(t, "Hecha")
        jdbc.update(
            "UPDATE shopping_list SET status = 'COMPLETED', completed_at = now() WHERE id = ?",
            UUID.fromString(done),
        )
        assertNotOpen(addItem(t, done, p))
    }

    @Test
    fun `duplicate copies only unchecked items into a new open list`() {
        val t = registerOwner()
        val list = newList(t, "Semanal")
        val a = body(addItem(t, list, product(t, "A"), "2", "KG", mapOf("note" to "n")))["id"].asText()
        addItem(t, list, product(t, "B"), "1.5", "L")
        call(HttpMethod.PATCH, "shopping-lists/$list/items/$a", mapOf("checked" to true), t)

        val dup = call(HttpMethod.POST, "shopping-lists/$list/duplicate", null, t)
        assertEquals(201, dup.response.status)
        val d = body(dup)
        assertEquals("Semanal (copia)", d["name"].asText())
        assertEquals("OPEN", d["status"].asText())
        assertEquals(1, d["items"].size())
        assertEquals("B", d["items"][0]["product"]["name"].asText())
        assertEquals("1.500", d["items"][0]["quantity"].asText())
        assertEquals(false, d["items"][0]["checked"].asBoolean())

        val named = body(call(HttpMethod.POST, "shopping-lists/$list/duplicate", mapOf("name" to "Plantilla"), t))
        assertEquals("Plantilla", named["name"].asText())
        // la original queda intacta
        assertEquals(2, body(call(HttpMethod.GET, "shopping-lists/$list", bearer = t))["items"].size())
        // se puede duplicar una lista archivada
        call(HttpMethod.PATCH, "shopping-lists/$list", mapOf("status" to "ARCHIVED"), t)
        val fromArchived = call(HttpMethod.POST, "shopping-lists/$list/duplicate", null, t)
        assertEquals(201, fromArchived.response.status)
        assertEquals("OPEN", body(fromArchived)["status"].asText())
        assertEquals(
            404,
            call(HttpMethod.POST, "shopping-lists/${UUID.randomUUID()}/duplicate", null, t).response.status,
        )
    }

    @Test
    fun `list summaries filter by status and paginate`() {
        val t = registerOwner()
        val l1 = newList(t, "Uno")
        newList(t, "Dos")
        newList(t, "Tres")
        val a = body(addItem(t, l1, product(t, "A")))["id"].asText()
        addItem(t, l1, product(t, "B"))
        call(HttpMethod.PATCH, "shopping-lists/$l1/items/$a", mapOf("checked" to true), t)

        val all = body(call(HttpMethod.GET, "shopping-lists", bearer = t))
        assertEquals(3, all["totalElements"].asInt())
        val uno = all["content"].first { it["id"].asText() == l1 }
        assertEquals(2, uno["itemCount"].asInt())
        assertEquals(1, uno["checkedCount"].asInt())

        call(HttpMethod.PATCH, "shopping-lists/$l1", mapOf("status" to "ARCHIVED"), t)
        val open = body(call(HttpMethod.GET, "shopping-lists?status=OPEN", bearer = t))
        assertEquals(2, open["totalElements"].asInt())
        val archived = body(call(HttpMethod.GET, "shopping-lists?status=ARCHIVED", bearer = t))
        assertEquals(listOf("Uno"), archived["content"].map { it["name"].asText() })

        val page = body(call(HttpMethod.GET, "shopping-lists?size=2&page=1&sort=name,asc", bearer = t))
        assertEquals(3, page["totalElements"].asInt())
        assertEquals(2, page["totalPages"].asInt())
        assertEquals(listOf("Uno"), page["content"].map { it["name"].asText() })
        assertEquals(400, call(HttpMethod.GET, "shopping-lists?sort=bogus", bearer = t).response.status)
        assertEquals(400, call(HttpMethod.GET, "shopping-lists?status=NOPE", bearer = t).response.status)
    }
}
