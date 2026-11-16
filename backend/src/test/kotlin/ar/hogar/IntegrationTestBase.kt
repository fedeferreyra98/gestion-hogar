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
import java.io.File
import java.security.MessageDigest

/**
 * Base de los tests `*IntegrationTest` (docs/06-local-dev.md).
 *
 * - Un único contenedor Postgres por JVM (singleton), compartido por toda la suite.
 *   Con `testcontainers.reuse.enable=true` (el Makefile exporta `TESTCONTAINERS_REUSE_ENABLE`)
 *   el contenedor sobrevive entre corridas.
 * - El reuse es por worktree: el contenedor lleva una etiqueta con el hash de la ruta del
 *   proyecto y del contenido de las migraciones. Testcontainers calcula el hash de reuse sobre
 *   la configuración (etiquetas incluidas), así que dos worktrees (o una migración cambiada)
 *   nunca comparten contenedor. En CI (`CI` definida) no se usa reuse (BL-016).
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
            PostgreSQLContainer("postgres:16-alpine")
                .withLabel("hogar.test-scope", scopeHash())
                .withReuse(System.getenv("CI").isNullOrBlank())
                .also { it.start() }

        /** Hash corto de la ruta del proyecto + migraciones: identifica el contenedor reutilizable. */
        private fun scopeHash(): String {
            val digest = MessageDigest.getInstance("SHA-256")
            val root = File(System.getProperty("user.dir")).canonicalFile
            digest.update(root.path.toByteArray())
            File(root, "src/main/resources/db/migration")
                .listFiles()
                ?.sortedBy { it.name }
                ?.forEach {
                    digest.update(it.name.toByteArray())
                    digest.update(it.readBytes())
                }
            return digest.digest().joinToString("") { "%02x".format(it) }.take(12)
        }
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
