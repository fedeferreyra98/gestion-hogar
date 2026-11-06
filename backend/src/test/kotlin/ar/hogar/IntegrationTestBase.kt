package ar.hogar

import org.junit.jupiter.api.BeforeEach
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.testcontainers.service.connection.ServiceConnection
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.testcontainers.containers.PostgreSQLContainer

/**
 * Base de los tests `*IntegrationTest` (docs/06-local-dev.md).
 *
 * - Un único contenedor Postgres por JVM (singleton), compartido por toda la suite.
 *   Con `testcontainers.reuse.enable=true` (el Makefile exporta `TESTCONTAINERS_REUSE_ENABLE`)
 *   el contenedor sobrevive entre corridas.
 * - Todos los tests comparten la misma configuración de contexto, así Spring lo cachea.
 * - Antes de cada test se vacían las tablas de negocio (Flyway no se toca).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
abstract class IntegrationTestBase {
    companion object {
        @JvmStatic
        @ServiceConnection
        val postgres: PostgreSQLContainer<*> =
            PostgreSQLContainer("postgres:16-alpine").withReuse(true).also { it.start() }
    }

    @Autowired
    protected lateinit var jdbc: JdbcTemplate

    @Autowired
    protected lateinit var mockMvc: MockMvc

    @BeforeEach
    fun cleanDatabase() {
        val tables =
            jdbc.queryForList(
                "SELECT quote_ident(table_name) FROM information_schema.tables " +
                    "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' " +
                    "AND table_name <> 'flyway_schema_history'",
                String::class.java,
            )
        if (tables.isNotEmpty()) {
            jdbc.execute("TRUNCATE TABLE ${tables.joinToString(", ")} RESTART IDENTITY CASCADE")
        }
    }
}
