package ar.hogar.devseed

import ar.hogar.IntegrationTestBase
import ar.hogar.catalog.CategoryRepository
import ar.hogar.catalog.ProductRepository
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.context.ApplicationContext
import org.springframework.transaction.PlatformTransactionManager
import java.time.Clock
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DevSeederIntegrationTest : IntegrationTestBase() {
    @Autowired lateinit var categories: CategoryRepository

    @Autowired lateinit var products: ProductRepository

    @Autowired lateinit var txManager: PlatformTransactionManager

    @Autowired lateinit var clock: Clock

    @Autowired lateinit var context: ApplicationContext

    private fun seeder() = DevSeeder(categories, products, clock, txManager)

    private fun household(): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO household (id, name, created_at, updated_at) VALUES (?, 'Hogar Mock', ?, ?)",
            id,
            java.sql.Timestamp.from(Instant.now()),
            java.sql.Timestamp.from(Instant.now()),
        )
        return id
    }

    @Test
    fun `seed loads categories and products once`() {
        val hh = household()
        val first = seeder().seed(hh)
        assertEquals(DevSeedData.categories.size to DevSeedData.products.size, first)
        assertTrue(DevSeedData.products.size >= 30)

        val second = seeder().seed(hh)
        assertEquals(0 to 0, second)
        assertEquals(DevSeedData.categories.size, categories.findAllByHousehold(hh).size)
        assertEquals(DevSeedData.products.size.toLong(), products.count())
    }

    @Test
    fun `seed respects existing data case-insensitively and does not overwrite`() {
        val hh = household()
        jdbc.update(
            "INSERT INTO category (id, household_id, name, created_at, updated_at) " +
                "VALUES (?, ?, 'LÁCTEOS', now(), now())",
            UUID.randomUUID(),
            hh,
        )
        jdbc.update(
            "INSERT INTO product (id, household_id, name, default_unit, default_shelf_life_days, " +
                "created_at, updated_at) VALUES (?, ?, 'LECHE', 'ML', 99, now(), now())",
            UUID.randomUUID(),
            hh,
        )
        seeder().seed(hh)

        assertEquals(DevSeedData.categories.size, categories.findAllByHousehold(hh).size)
        val leche = products.findAll().single { it.name.equals("leche", ignoreCase = true) }
        assertEquals("LECHE", leche.name)
        assertEquals(99, leche.defaultShelfLifeDays)
        assertEquals(DevSeedData.products.size.toLong(), products.count())
    }

    @Test
    fun `seed beans are not registered outside the local profile`() {
        assertEquals(0, context.getBeansOfType(DevSeeder::class.java).size)
        assertEquals(0, context.getBeansOfType(DevSeedRunner::class.java).size)
        assertEquals(0, context.getBeansOfType(DevSeedOnRegister::class.java).size)
    }
}
