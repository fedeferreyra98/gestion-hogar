package ar.hogar.catalog

import ar.hogar.IntegrationTestBase
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CatalogIntegrationTest : IntegrationTestBase() {
    private companion object {
        // Datos mock (docs/07-sensitive-data.md)
        const val PASSWORD = "mock-password-123"
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

    private fun category(
        token: String,
        name: String,
    ) = call(HttpMethod.POST, "categories", mapOf("name" to name), token)

    private fun product(
        token: String,
        name: String,
        categoryId: String? = null,
        unit: String = "UNIT",
    ) = call(
        HttpMethod.POST,
        "products",
        mapOf("name" to name, "categoryId" to categoryId, "defaultUnit" to unit, "defaultShelfLifeDays" to 7),
        token,
    )

    @Test
    fun `category crud and case-insensitive unique name`() {
        val t = registerOwner()
        val created = category(t, "Lácteos")
        assertEquals(201, created.response.status)
        val id = body(created)["id"].asText()

        assertEquals(409, category(t, "  lácteos ").response.status)
        assertEquals(409, body(category(t, "LÁCTEOS"))["status"].asInt())
        category(t, "Limpieza")
        assertEquals(409, call(HttpMethod.PUT, "categories/$id", mapOf("name" to "limpieza"), t).response.status)
        // renombrarse a sí misma (otro case/acentos) está permitido; orden sin distinguir mayúsculas
        val renamed = call(HttpMethod.PUT, "categories/$id", mapOf("name" to "LACTEOS"), t)
        assertEquals(200, renamed.response.status)
        assertEquals("LACTEOS", body(renamed)["name"].asText())

        val list = body(call(HttpMethod.GET, "categories", bearer = t))
        assertEquals(listOf("LACTEOS", "Limpieza"), list.map { it["name"].asText() })
        assertEquals(400, category(t, "   ").response.status)
        assertEquals(
            404,
            call(HttpMethod.PUT, "categories/${java.util.UUID.randomUUID()}", mapOf("name" to "X"), t).response.status,
        )
    }

    @Test
    fun `category with products cannot be deleted but empty one can`() {
        val t = registerOwner()
        val cat = body(category(t, "Lácteos"))["id"].asText()
        val prod = body(product(t, "Leche", cat))["id"].asText()

        assertEquals(409, call(HttpMethod.DELETE, "categories/$cat", bearer = t).response.status)
        // un producto archivado también bloquea el borrado
        call(HttpMethod.POST, "products/$prod/archive", bearer = t)
        assertEquals(409, call(HttpMethod.DELETE, "categories/$cat", bearer = t).response.status)

        val empty = body(category(t, "Vacía"))["id"].asText()
        assertEquals(204, call(HttpMethod.DELETE, "categories/$empty", bearer = t).response.status)
        assertEquals(404, call(HttpMethod.DELETE, "categories/$empty", bearer = t).response.status)
    }

    @Test
    fun `product create validates and enforces unique name`() {
        val t = registerOwner()
        val cat = body(category(t, "Lácteos"))["id"].asText()
        val created = product(t, "Leche", cat, "L")
        assertEquals(201, created.response.status)
        assertEquals("L", body(created)["defaultUnit"].asText())
        assertEquals(false, body(created)["archived"].asBoolean())
        assertEquals(cat, body(created)["categoryId"].asText())

        assertEquals(409, product(t, "leche").response.status)
        assertEquals(
            404,
            product(
                t,
                "Pan",
                java.util.UUID
                    .randomUUID()
                    .toString(),
            ).response.status,
        )
        assertEquals(400, product(t, "Pan", unit = "BOX").response.status)
        assertEquals(400, call(HttpMethod.POST, "products", mapOf("name" to "Pan"), t).response.status)
        assertEquals(
            400,
            call(
                HttpMethod.POST,
                "products",
                mapOf("name" to "Pan", "defaultUnit" to "KG", "defaultShelfLifeDays" to -1),
                t,
            ).response.status,
        )
    }

    @Test
    fun `product update archive and unarchive`() {
        val t = registerOwner()
        val a = body(product(t, "Arroz"))["id"].asText()
        product(t, "Fideos")
        assertEquals(
            409,
            call(HttpMethod.PUT, "products/$a", mapOf("name" to "FIDEOS", "defaultUnit" to "KG"), t).response.status,
        )
        val updated = call(HttpMethod.PUT, "products/$a", mapOf("name" to "Arroz largo", "defaultUnit" to "KG"), t)
        assertEquals(200, updated.response.status)
        assertEquals("KG", body(updated)["defaultUnit"].asText())
        assertTrue(body(updated)["defaultShelfLifeDays"].isNull)

        assertEquals(true, body(call(HttpMethod.POST, "products/$a/archive", bearer = t))["archived"].asBoolean())
        // el nombre archivado sigue reservado
        assertEquals(409, product(t, "arroz largo").response.status)
        assertEquals(false, body(call(HttpMethod.POST, "products/$a/unarchive", bearer = t))["archived"].asBoolean())
        assertEquals(
            404,
            call(HttpMethod.POST, "products/${java.util.UUID.randomUUID()}/archive", bearer = t).response.status,
        )
    }

    @Test
    fun `search by q filters archived and category with pagination`() {
        val t = registerOwner()
        val cat = body(category(t, "Almacén"))["id"].asText()
        listOf("Arroz", "Harina", "Aceite de oliva", "Porcentaje%", "Under_score").forEach { product(t, it, cat) }
        product(t, "Sal")
        val arch = body(product(t, "Azúcar"))["id"].asText()
        call(HttpMethod.POST, "products/$arch/archive", bearer = t)

        fun names(query: String) =
            body(call(HttpMethod.GET, "products?$query", bearer = t))["content"].map {
                it["name"].asText()
            }

        assertEquals(
            setOf("Arroz", "Harina", "Aceite de oliva", "Porcentaje%", "Under_score", "Sal"),
            names("").toSet(),
        )
        assertEquals(
            listOf("Aceite de oliva", "Arroz", "Harina", "Porcentaje%", "Sal", "Under_score"),
            names("sort=name,asc"),
        )
        assertEquals(listOf("Arroz", "Harina").sorted(), names("q=AR").sorted()) // contiene, case-insensitive
        assertEquals(listOf("Porcentaje%"), names("q=%"))
        assertEquals(listOf("Under_score"), names("q=_"))
        assertEquals(listOf("Sal"), names("q=sal"))
        assertEquals(5, names("categoryId=$cat").size)
        assertTrue("Sal" !in names("categoryId=$cat"))
        assertTrue("Azúcar" in names("includeArchived=true"))
        assertTrue("Azúcar" !in names(""))

        val page = body(call(HttpMethod.GET, "products?size=2&page=1&sort=name,desc", bearer = t))
        assertEquals(2, page["content"].size())
        assertEquals(1, page["page"].asInt())
        assertEquals(2, page["size"].asInt())
        assertEquals(6, page["totalElements"].asInt())
        assertEquals(3, page["totalPages"].asInt())
        assertEquals(400, call(HttpMethod.GET, "products?size=101", bearer = t).response.status)
        assertEquals(400, call(HttpMethod.GET, "products?sort=password,asc", bearer = t).response.status)
    }

    @Test
    fun `catalog is isolated per household and requires auth`() {
        val t = registerOwner()
        val catId = body(category(t, "Lácteos"))["id"].asText()
        val prodId = body(product(t, "Leche", catId))["id"].asText()
        assertEquals(401, call(HttpMethod.GET, "categories").response.status)
        assertEquals(401, call(HttpMethod.GET, "products").response.status)

        // Segundo hogar insertado por SQL (register-owner solo permite un hogar)
        val hid2 = java.util.UUID.randomUUID()
        val otherCat = java.util.UUID.randomUUID()
        jdbc.update("INSERT INTO household (id, name, created_at, updated_at) VALUES (?, 'Otro', now(), now())", hid2)
        jdbc.update(
            "INSERT INTO category (id, household_id, name, created_at, updated_at) VALUES (?, ?, 'Ajena', now(), now())",
            otherCat,
            hid2,
        )
        jdbc.update(
            "INSERT INTO product (id, household_id, name, default_unit, created_at, updated_at) " +
                "VALUES (?, ?, 'Ajeno', 'UNIT', now(), now())",
            java.util.UUID.randomUUID(),
            hid2,
        )
        assertEquals(
            listOf("Lácteos"),
            body(call(HttpMethod.GET, "categories", bearer = t)).map { it["name"].asText() },
        )
        assertEquals(
            listOf("Leche"),
            body(call(HttpMethod.GET, "products", bearer = t))["content"].map { it["name"].asText() },
        )
        assertEquals(404, call(HttpMethod.PUT, "categories/$otherCat", mapOf("name" to "X"), t).response.status)
        assertEquals(404, call(HttpMethod.DELETE, "categories/$otherCat", bearer = t).response.status)
        assertEquals(404, product(t, "Pan", otherCat.toString()).response.status)
        assertTrue(prodId.isNotEmpty())
    }

    @Test
    fun `plain member can read and write the catalog`() {
        val owner = registerOwner()
        call(
            HttpMethod.POST,
            "members",
            mapOf("email" to "member@example.test", "displayName" to "M", "password" to PASSWORD),
            owner,
        )
        val member =
            body(
                call(HttpMethod.POST, "auth/login", mapOf("email" to "member@example.test", "password" to PASSWORD)),
            )["accessToken"]
                .asText()
        assertEquals(201, category(member, "Limpieza").response.status)
        assertEquals(201, product(member, "Lavandina").response.status)
        assertEquals(200, call(HttpMethod.GET, "products", bearer = member).response.status)
        // el catálogo es del hogar: el owner ve lo que creó el miembro
        assertEquals(1, body(call(HttpMethod.GET, "categories", bearer = owner)).size())
    }
}
