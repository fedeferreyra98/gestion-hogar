package ar.hogar.expense

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
import org.springframework.orm.ObjectOptimisticLockingFailureException
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class ExpenseIntegrationTest : IntegrationTestBase() {
    private companion object {
        // Datos mock (docs/07-sensitive-data.md)
        const val PASSWORD = "mock-password-123"
    }

    @Autowired lateinit var mapper: ObjectMapper

    @Autowired lateinit var jwt: JwtService

    @Autowired lateinit var expenseRepository: ExpenseRepository

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

    private class Ctx(
        val token: String,
        val memberId: String,
        val householdId: UUID,
    )

    private fun registerOwner(
        email: String = "owner@example.test",
        household: String = "Hogar Mock",
    ): Ctx {
        val b =
            body(
                call(
                    HttpMethod.POST,
                    "auth/register-owner",
                    mapOf(
                        "householdName" to household,
                        "email" to email,
                        "password" to PASSWORD,
                        "displayName" to "Owner",
                    ),
                ),
            )
        val token = b["accessToken"].asText()
        val me = body(call(HttpMethod.GET, "me", bearer = token))
        return Ctx(token, me["member"]["id"].asText(), UUID.fromString(me["household"]["id"].asText()))
    }

    /** Hay un solo hogar por instalación vía API; el segundo se crea directo en la base. */
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
        val token = jwt.issueAccessToken(Member(m, h, "b@example.test", "x", "B", Role.OWNER, true, now, now))
        return Ctx(token, m.toString(), h)
    }

    private fun input(
        description: String = "Luz",
        amount: Long = 1000,
        currency: String = "ARS",
        date: String = "2026-03-10",
        categoryId: String? = null,
        paidBy: String,
    ) = mapOf(
        "description" to description,
        "amount" to mapOf("amountMinor" to amount, "currency" to currency),
        "expenseDate" to date,
        "categoryId" to categoryId,
        "paidBy" to paidBy,
    )

    private fun create(
        c: Ctx,
        description: String = "Luz",
        amount: Long = 1000,
        date: String = "2026-03-10",
        categoryId: String? = null,
        paidBy: String = c.memberId,
    ) = call(
        HttpMethod.POST,
        "expenses",
        input(description, amount, "ARS", date, categoryId, paidBy),
        c.token,
    )

    private fun category(
        c: Ctx,
        name: String,
    ) = body(call(HttpMethod.POST, "categories", mapOf("name" to name), c.token))["id"].asText()

    private fun purchaseExpense(c: Ctx): UUID =
        UUID.randomUUID().also {
            jdbc.update(
                "INSERT INTO expense (id, household_id, description, amount_minor, currency, expense_date, paid_by, " +
                    "source, created_by, created_at, updated_at) " +
                    "VALUES (?, ?, 'Compra', 5000, 'ARS', '2026-03-12', ?, 'PURCHASE', ?, now(), now())",
                it,
                c.householdId,
                UUID.fromString(c.memberId),
                UUID.fromString(c.memberId),
            )
        }

    @Test
    fun `create get update and soft delete a manual expense`() {
        val c = registerOwner()
        val created = create(c, "  Alquiler ", 150000)
        assertEquals(201, created.response.status)
        val e = body(created)
        assertEquals("Alquiler", e["description"].asText())
        assertEquals(150000, e["amount"]["amountMinor"].asLong())
        assertEquals("ARS", e["amount"]["currency"].asText())
        assertEquals("MANUAL", e["source"].asText())
        assertFalse(e["shared"].asBoolean())
        val id = e["id"].asText()

        assertEquals(200, call(HttpMethod.GET, "expenses/$id", bearer = c.token).response.status)

        val edit = input("Alquiler marzo", 160000, paidBy = c.memberId)
        val updated = call(HttpMethod.PUT, "expenses/$id", edit, c.token)
        assertEquals(200, updated.response.status)
        assertEquals(160000, body(updated)["amount"]["amountMinor"].asLong())

        assertEquals(204, call(HttpMethod.DELETE, "expenses/$id", bearer = c.token).response.status)
        assertEquals(404, call(HttpMethod.GET, "expenses/$id", bearer = c.token).response.status)
        assertEquals(404, call(HttpMethod.DELETE, "expenses/$id", bearer = c.token).response.status)
        assertEquals(0, body(call(HttpMethod.GET, "expenses", bearer = c.token))["totalElements"].asInt())
        // soft delete: la fila sigue en la base
        val softDeleted = "SELECT count(*) FROM expense WHERE deleted_at IS NOT NULL"
        assertEquals(1, jdbc.queryForObject(softDeleted, Int::class.java))
    }

    @Test
    fun `currency other than the household base is rejected with 422 UNSUPPORTED_CURRENCY`() {
        val c = registerOwner()
        val r = call(HttpMethod.POST, "expenses", input(currency = "USD", paidBy = c.memberId), c.token)
        assertEquals(422, r.response.status)
        assertEquals("UNSUPPORTED_CURRENCY", body(r)["code"].asText())
        val id = body(create(c))["id"].asText()
        val u = call(HttpMethod.PUT, "expenses/$id", input(currency = "USD", paidBy = c.memberId), c.token)
        assertEquals(422, u.response.status)
        assertEquals("UNSUPPORTED_CURRENCY", body(u)["code"].asText())
    }

    @Test
    fun `validation errors return 400`() {
        val c = registerOwner()
        assertEquals(400, create(c, amount = 0).response.status)
        assertEquals(400, create(c, amount = -5).response.status)
        assertEquals(400, create(c, description = " ").response.status)
        assertEquals(400, create(c, paidBy = UUID.randomUUID().toString()).response.status)
        assertEquals(400, create(c, categoryId = UUID.randomUUID().toString()).response.status)
        assertEquals(
            400,
            call(HttpMethod.POST, "expenses", input(currency = "XYZ1", paidBy = c.memberId), c.token).response.status,
        )
        val inverted = call(HttpMethod.GET, "expenses?from=2026-05-01&to=2026-04-01", bearer = c.token)
        assertEquals(400, inverted.response.status)
    }

    @Test
    fun `purchase expenses cannot be edited or deleted directly`() {
        val c = registerOwner()
        val id = purchaseExpense(c)
        assertEquals(200, call(HttpMethod.GET, "expenses/$id", bearer = c.token).response.status)
        assertEquals(409, call(HttpMethod.PUT, "expenses/$id", input(paidBy = c.memberId), c.token).response.status)
        assertEquals(409, call(HttpMethod.DELETE, "expenses/$id", bearer = c.token).response.status)
    }

    @Test
    fun `combined filters, ordering, pagination and totalFiltered`() {
        val c = registerOwner()
        val food = category(c, "Comida")
        val home = category(c, "Hogar")
        val other =
            body(
                call(
                    HttpMethod.POST,
                    "members",
                    mapOf("email" to "otro@example.test", "displayName" to "Otro", "password" to PASSWORD),
                    c.token,
                ),
            )["id"].asText()
        create(c, "Luz de marzo", 1000, "2026-03-01", home)
        create(c, "Super semanal", 2500, "2026-03-05", food)
        create(c, "Verdulería", 700, "2026-03-20", food, other)
        create(c, "Internet", 3000, "2026-04-02", home, other)
        create(c, "100% descuento_x", 50, "2026-04-03")
        purchaseExpense(c) // PURCHASE 5000, 2026-03-12, sin categoría

        fun list(query: String) = body(call(HttpMethod.GET, "expenses?$query", bearer = c.token))

        fun total(r: JsonNode) = r["totalFiltered"].sumOf { it["amountMinor"].asLong() }

        // sin filtros: orden por fecha desc, total de todo
        val all = list("")
        assertEquals(6, all["totalElements"].asInt())
        assertEquals("100% descuento_x", all["content"][0]["description"].asText())
        assertEquals(1000 + 2500 + 700 + 3000 + 50 + 5000L, total(all))
        assertEquals("ARS", all["totalFiltered"][0]["currency"].asText())

        // rango de fechas inclusivo
        assertEquals(3L, list("from=2026-03-05&to=2026-03-20")["totalElements"].asLong())
        // categoría + pagador
        val f = list("categoryId=$food&paidBy=$other")
        assertEquals(1, f["totalElements"].asInt())
        assertEquals(700L, total(f))
        // fuente
        val p = list("source=PURCHASE")
        assertEquals(1, p["totalElements"].asInt())
        assertEquals(5000L, total(p))
        assertEquals(5, list("source=MANUAL")["totalElements"].asInt())
        // texto (sin distinguir mayúsculas) + categoría + rango
        assertEquals(1, list("q=SUPER&categoryId=$food&from=2026-03-01&to=2026-03-31")["totalElements"].asInt())
        // los comodines LIKE se escapan
        assertEquals(1, list("q=100%")["totalElements"].asInt())
        assertEquals(1, list("q=descuento_x")["totalElements"].asInt())
        assertEquals(0, list("q=%x")["totalElements"].asInt())
        // combinación sin resultados → total vacío
        val none = list("categoryId=$food&source=PURCHASE")
        assertEquals(0, none["totalElements"].asInt())
        assertEquals(0, none["totalFiltered"].size())
        // shared=false devuelve todo; shared=true nada (Fase 2)
        assertEquals(6, list("shared=false")["totalElements"].asInt())
        assertEquals(0, list("shared=true")["totalElements"].asInt())

        // paginación: el total filtrado cubre todas las páginas, no solo la actual
        val page1 = list("size=2&page=1")
        assertEquals(2, page1["content"].size())
        assertEquals(6, page1["totalElements"].asInt())
        assertEquals(3, page1["totalPages"].asInt())
        assertEquals(1, page1["page"].asInt())
        assertEquals(1000 + 2500 + 700 + 3000 + 50 + 5000L, total(page1))
        assertEquals("Verdulería", page1["content"][0]["description"].asText())
        assertEquals(400, call(HttpMethod.GET, "expenses?size=0", bearer = c.token).response.status)
        assertEquals(400, call(HttpMethod.GET, "expenses?sort=bogus", bearer = c.token).response.status)
    }

    @Test
    fun `expenses are scoped to the household and require auth`() {
        val a = registerOwner("a@example.test", "Hogar A")
        val b = otherHousehold()
        val id = body(create(a))["id"].asText()
        assertEquals(404, call(HttpMethod.GET, "expenses/$id", bearer = b.token).response.status)
        assertEquals(404, call(HttpMethod.DELETE, "expenses/$id", bearer = b.token).response.status)
        assertEquals(0, body(call(HttpMethod.GET, "expenses", bearer = b.token))["totalElements"].asInt())
        // pagador de otro hogar
        assertEquals(400, create(b, paidBy = a.memberId).response.status)
        assertEquals(401, call(HttpMethod.GET, "expenses").response.status)
    }

    private fun addMember(
        owner: Ctx,
        email: String,
    ): Ctx {
        val m =
            body(
                call(
                    HttpMethod.POST,
                    "members",
                    mapOf("email" to email, "displayName" to "Miembro", "password" to PASSWORD),
                    owner.token,
                ),
            )["id"].asText()
        val token =
            body(call(HttpMethod.POST, "auth/login", mapOf("email" to email, "password" to PASSWORD)))["accessToken"]
                .asText()
        return Ctx(token, m, owner.householdId)
    }

    @Test
    fun `a MEMBER can create list edit and delete expenses`() {
        val owner = registerOwner()
        val member = addMember(owner, "miembro@example.test")
        val id = body(create(member))["id"].asText()
        assertEquals(1, body(call(HttpMethod.GET, "expenses", bearer = member.token))["totalElements"].asInt())
        val edit = input("Editado", 2000, paidBy = owner.memberId)
        assertEquals(200, call(HttpMethod.PUT, "expenses/$id", edit, member.token).response.status)
        assertEquals(204, call(HttpMethod.DELETE, "expenses/$id", bearer = member.token).response.status)
    }

    @Test
    fun `inactive payer is rejected on create but historic expense stays editable if payer is unchanged`() {
        val owner = registerOwner()
        val member = addMember(owner, "miembro@example.test")
        val id = body(create(owner, paidBy = member.memberId))["id"].asText()
        val off = call(HttpMethod.PATCH, "members/${member.memberId}", mapOf("active" to false), owner.token)
        assertEquals(200, off.response.status)

        assertEquals(400, create(owner, paidBy = member.memberId).response.status)
        // mismo pagador (inactivo): se puede editar
        val same = call(HttpMethod.PUT, "expenses/$id", input("Corregido", 1234, paidBy = member.memberId), owner.token)
        assertEquals(200, same.response.status)
        assertEquals(1234, body(same)["amount"]["amountMinor"].asLong())
        // cambiar a otro pagador inactivo no
        val other = addMember(owner, "otro@example.test")
        call(HttpMethod.PATCH, "members/${other.memberId}", mapOf("active" to false), owner.token)
        val change = call(HttpMethod.PUT, "expenses/$id", input(paidBy = other.memberId), owner.token)
        assertEquals(400, change.response.status)
        // cambiar a un miembro activo sí
        assertEquals(
            200,
            call(HttpMethod.PUT, "expenses/$id", input(paidBy = owner.memberId), owner.token).response.status,
        )
    }

    @Test
    fun `category from another household is rejected`() {
        val a = registerOwner()
        val b = otherHousehold()
        val foreign = category(b, "Ajena")
        assertEquals(400, create(a, categoryId = foreign).response.status)
        val id = body(create(a))["id"].asText()
        val r = call(HttpMethod.PUT, "expenses/$id", input(categoryId = foreign, paidBy = a.memberId), a.token)
        assertEquals(400, r.response.status)
    }

    @Test
    fun `update on a soft-deleted expense returns 404`() {
        val c = registerOwner()
        val id = body(create(c))["id"].asText()
        call(HttpMethod.DELETE, "expenses/$id", bearer = c.token)
        assertEquals(404, call(HttpMethod.PUT, "expenses/$id", input(paidBy = c.memberId), c.token).response.status)
    }

    @Test
    fun `sort by amountMinor and invalid sorts`() {
        val c = registerOwner()
        create(c, "B", 300)
        create(c, "A", 100)
        create(c, "C", 200)

        fun amounts(sort: String) =
            body(call(HttpMethod.GET, "expenses?sort=$sort", bearer = c.token))["content"]
                .map { it["amount"]["amountMinor"].asLong() }

        assertEquals(listOf(100L, 200L, 300L), amounts("amountMinor,asc"))
        assertEquals(listOf(300L, 200L, 100L), amounts("amountMinor,desc"))
        listOf("description", "amountMinor,sideways", "amountMinor,asc,x").forEach {
            assertEquals(400, call(HttpMethod.GET, "expenses?sort=$it", bearer = c.token).response.status, it)
        }
        assertEquals(400, call(HttpMethod.GET, "expenses?size=101", bearer = c.token).response.status)
        assertEquals(400, call(HttpMethod.GET, "expenses?page=-1", bearer = c.token).response.status)
    }

    @Test
    fun `description longer than 255 is rejected`() {
        val c = registerOwner()
        assertEquals(201, create(c, description = "x".repeat(255)).response.status)
        assertEquals(400, create(c, description = "x".repeat(256)).response.status)
    }

    @Test
    fun `stale write after a concurrent delete cannot resurrect the expense`() {
        val c = registerOwner()
        val id = UUID.fromString(body(create(c))["id"].asText())
        val stale = expenseRepository.findById(id).get() // detached: la lectura concurrente previa al DELETE
        assertEquals(204, call(HttpMethod.DELETE, "expenses/$id", bearer = c.token).response.status)

        stale.description = "Zombi"
        assertFailsWith<ObjectOptimisticLockingFailureException> { expenseRepository.saveAndFlush(stale) }
        val deletedAt = "SELECT deleted_at IS NOT NULL FROM expense WHERE id = ?"
        assertEquals(true, jdbc.queryForObject(deletedAt, Boolean::class.java, id))
    }

    @Test
    fun `two stale updates do not lose each other`() {
        val c = registerOwner()
        val id = UUID.fromString(body(create(c))["id"].asText())
        val first = expenseRepository.findById(id).get()
        val second = expenseRepository.findById(id).get()
        first.description = "Primero"
        expenseRepository.saveAndFlush(first)
        second.amountMinor = 999
        assertFailsWith<ObjectOptimisticLockingFailureException> { expenseRepository.saveAndFlush(second) }
        assertEquals("Primero", body(call(HttpMethod.GET, "expenses/$id", bearer = c.token))["description"].asText())
    }

    @Test
    fun `category with expenses (even deleted) cannot be deleted - domain 409`() {
        val c = registerOwner()
        val cat = category(c, "Servicios")
        val id = body(create(c, categoryId = cat))["id"].asText()
        val r = call(HttpMethod.DELETE, "categories/$cat", bearer = c.token)
        assertEquals(409, r.response.status)
        assertEquals("Category has expenses", body(r)["detail"].asText())
        call(HttpMethod.DELETE, "expenses/$id", bearer = c.token)
        assertEquals(409, call(HttpMethod.DELETE, "categories/$cat", bearer = c.token).response.status)
        // sin gastos, se puede
        val empty = category(c, "Vacía")
        assertEquals(204, call(HttpMethod.DELETE, "categories/$empty", bearer = c.token).response.status)
    }
}
