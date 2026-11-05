package ar.hogar

import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.testcontainers.service.connection.ServiceConnection
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.ActiveProfiles
import org.testcontainers.containers.PostgreSQLContainer
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

@SpringBootTest
@ActiveProfiles("test")
class FlywayMigrationV1IntegrationTest {
    companion object {
        @JvmStatic
        @ServiceConnection
        val postgres: PostgreSQLContainer<*> =
            PostgreSQLContainer("postgres:16-alpine").withReuse(true).also { it.start() }
    }

    @Autowired
    lateinit var jdbc: JdbcTemplate

    private fun insertHousehold(): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO household (id, name, created_at, updated_at) VALUES (?, 'Casa mock', now(), now())",
            id,
        )
        return id
    }

    private fun insertMember(
        householdId: UUID,
        email: String,
        role: String = "OWNER",
    ): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO member (id, household_id, email, password_hash, display_name, role, created_at, updated_at) " +
                "VALUES (?, ?, ?, 'hash-mock', 'Mock', ?, now(), now())",
            id,
            householdId,
            email,
            role,
        )
        return id
    }

    private fun insertToken(
        memberId: UUID,
        hash: String,
    ) = jdbc.update(
        "INSERT INTO refresh_token (id, member_id, token_hash, expires_at, created_at, updated_at) " +
            "VALUES (?, ?, ?, now() + interval '1 day', now(), now())",
        UUID.randomUUID(),
        memberId,
        hash,
    )

    @Test
    fun `flyway applies V1 successfully`() {
        val ok =
            jdbc.queryForObject(
                "SELECT success FROM flyway_schema_history WHERE version = '1'",
                Boolean::class.java,
            )
        assertEquals(true, ok)
        val tables =
            jdbc.queryForList(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
                String::class.java,
            )
        assertTrue(tables.containsAll(listOf("household", "member", "refresh_token")))
    }

    @Test
    fun `household has documented defaults`() {
        val id = insertHousehold()
        val row =
            jdbc.queryForMap(
                "SELECT base_currency, timezone, expiry_warning_days, share_purchases_by_default FROM household WHERE id = ?",
                id,
            )
        assertEquals("ARS", row["base_currency"])
        assertEquals("America/Argentina/Buenos_Aires", row["timezone"])
        assertEquals(3, row["expiry_warning_days"])
        assertEquals(true, row["share_purchases_by_default"])
    }

    @Test
    fun `member email is unique case-insensitively`() {
        val h = insertHousehold()
        insertMember(h, "Ana.Mock@example.test")
        assertFailsWith<DataIntegrityViolationException> { insertMember(h, "ana.mock@EXAMPLE.test") }
    }

    @Test
    fun `member role only accepts OWNER or MEMBER`() {
        val h = insertHousehold()
        insertMember(h, "owner-role@example.test", "MEMBER")
        assertFailsWith<DataIntegrityViolationException> { insertMember(h, "bad-role@example.test", "ADMIN") }
    }

    @Test
    fun `member requires an existing household`() {
        assertFailsWith<DataIntegrityViolationException> { insertMember(UUID.randomUUID(), "orphan@example.test") }
    }

    @Test
    fun `refresh token hash is unique and requires an existing member`() {
        val m = insertMember(insertHousehold(), "token-owner@example.test")
        insertToken(m, "hash-1")
        assertFailsWith<DataIntegrityViolationException> { insertToken(m, "hash-1") }
        assertFailsWith<DataIntegrityViolationException> { insertToken(UUID.randomUUID(), "hash-2") }
    }
}
