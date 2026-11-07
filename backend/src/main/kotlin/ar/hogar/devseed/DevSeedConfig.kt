package ar.hogar.devseed

import ar.hogar.auth.HouseholdRegisteredEvent
import ar.hogar.auth.HouseholdRepository
import ar.hogar.catalog.CategoryRepository
import ar.hogar.catalog.ProductRepository
import org.slf4j.LoggerFactory
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.event.TransactionPhase
import org.springframework.transaction.event.TransactionalEventListener
import java.time.Clock

/** Seed de desarrollo: SOLO perfil `local` (nunca test ni prod). */
@Configuration
@Profile("local")
class DevSeedConfig {
    @Bean
    fun devSeeder(
        categories: CategoryRepository,
        products: ProductRepository,
        clock: Clock,
        txManager: PlatformTransactionManager,
    ) = DevSeeder(categories, products, clock, txManager)
}

/** En cada arranque: si el hogar ya existe, completa lo que falte del seed. */
@Component
@Profile("local")
class DevSeedRunner(
    private val households: HouseholdRepository,
    private val seeder: DevSeeder,
) : ApplicationRunner {
    override fun run(args: ApplicationArguments) {
        households.findAll().firstOrNull()?.let { seeder.seed(it.id) }
    }
}

/** Primer arranque: el hogar nace con el registro del owner; el seed se carga apenas se confirma. */
@Component
@Profile("local")
class DevSeedOnRegister(
    private val seeder: DevSeeder,
) {
    private val log = LoggerFactory.getLogger(DevSeedOnRegister::class.java)

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun onHouseholdRegistered(event: HouseholdRegisteredEvent) {
        try {
            seeder.seed(event.householdId)
        } catch (e: Exception) {
            log.warn("Dev seed falló (no afecta al registro): {}", e.message)
        }
    }
}
