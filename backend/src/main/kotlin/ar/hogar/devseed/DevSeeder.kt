package ar.hogar.devseed

import ar.hogar.catalog.Category
import ar.hogar.catalog.CategoryRepository
import ar.hogar.catalog.Product
import ar.hogar.catalog.ProductRepository
import ar.hogar.catalog.Unit
import org.slf4j.LoggerFactory
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.util.UUID

/** Producto mock del seed: nombre, categoría, unidad por defecto y vida útil típica en días. */
data class SeedProduct(
    val name: String,
    val category: String,
    val unit: Unit,
    val shelfLifeDays: Int?,
)

object DevSeedData {
    val categories = listOf("Almacén", "Lácteos", "Limpieza", "Verdura", "Carne", "Bebidas", "Higiene")

    val products =
        listOf(
            SeedProduct("Arroz", "Almacén", Unit.KG, 365),
            SeedProduct("Fideos", "Almacén", Unit.PACK, 540),
            SeedProduct("Harina", "Almacén", Unit.KG, 270),
            SeedProduct("Azúcar", "Almacén", Unit.KG, 720),
            SeedProduct("Aceite de girasol", "Almacén", Unit.L, 540),
            SeedProduct("Yerba mate", "Almacén", Unit.KG, 365),
            SeedProduct("Galletitas", "Almacén", Unit.PACK, 120),
            SeedProduct("Leche", "Lácteos", Unit.L, 7),
            SeedProduct("Yogur", "Lácteos", Unit.UNIT, 15),
            SeedProduct("Queso cremoso", "Lácteos", Unit.KG, 20),
            SeedProduct("Manteca", "Lácteos", Unit.G, 60),
            SeedProduct("Huevos", "Lácteos", Unit.UNIT, 28),
            SeedProduct("Detergente", "Limpieza", Unit.ML, null),
            SeedProduct("Lavandina", "Limpieza", Unit.L, 180),
            SeedProduct("Limpiador multiuso", "Limpieza", Unit.ML, null),
            SeedProduct("Esponjas", "Limpieza", Unit.PACK, null),
            SeedProduct("Tomate", "Verdura", Unit.KG, 7),
            SeedProduct("Papa", "Verdura", Unit.KG, 30),
            SeedProduct("Cebolla", "Verdura", Unit.KG, 30),
            SeedProduct("Zanahoria", "Verdura", Unit.KG, 21),
            SeedProduct("Lechuga", "Verdura", Unit.UNIT, 5),
            SeedProduct("Carne picada", "Carne", Unit.KG, 2),
            SeedProduct("Pollo", "Carne", Unit.KG, 3),
            SeedProduct("Milanesas", "Carne", Unit.KG, 3),
            SeedProduct("Salchichas", "Carne", Unit.PACK, 10),
            SeedProduct("Agua mineral", "Bebidas", Unit.L, 365),
            SeedProduct("Gaseosa", "Bebidas", Unit.L, 180),
            SeedProduct("Jugo en polvo", "Bebidas", Unit.PACK, 365),
            SeedProduct("Papel higiénico", "Higiene", Unit.PACK, null),
            SeedProduct("Jabón de tocador", "Higiene", Unit.UNIT, null),
            SeedProduct("Shampoo", "Higiene", Unit.ML, 730),
            SeedProduct("Pasta dental", "Higiene", Unit.UNIT, 730),
        )
}

/**
 * Carga el catálogo demo (BL-111) en un hogar. Idempotente: salta lo que ya existe
 * (nombre case-insensitive, igual que el 409 de la API) y nunca modifica datos existentes.
 * Solo se registra como bean en el perfil `local` (ver [DevSeedConfig]).
 */
class DevSeeder(
    private val categories: CategoryRepository,
    private val products: ProductRepository,
    private val clock: Clock,
    txManager: PlatformTransactionManager,
) {
    private val log = LoggerFactory.getLogger(DevSeeder::class.java)

    // REQUIRES_NEW: también se invoca después del commit del registro del owner.
    private val tx =
        TransactionTemplate(txManager).apply { propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW }

    /** Devuelve la cantidad de (categorías, productos) creados. */
    fun seed(householdId: UUID): Pair<Int, Int> =
        tx.execute {
            val now = clock.instant()
            val byName =
                categories
                    .findAllByHousehold(householdId)
                    .associateBy { it.name.lowercase() }
                    .toMutableMap()
            var newCategories = 0
            DevSeedData.categories.forEach { name ->
                if (byName[name.lowercase()] == null) {
                    byName[name.lowercase()] = categories.save(Category(UUID.randomUUID(), householdId, name, now, now))
                    newCategories++
                }
            }
            var newProducts = 0
            DevSeedData.products.forEach { p ->
                if (!products.existsByHouseholdIdAndNameIgnoreCase(householdId, p.name)) {
                    products.save(
                        Product(
                            id = UUID.randomUUID(),
                            householdId = householdId,
                            name = p.name,
                            categoryId = byName.getValue(p.category.lowercase()).id,
                            defaultUnit = p.unit,
                            defaultShelfLifeDays = p.shelfLifeDays,
                            createdAt = now,
                            updatedAt = now,
                        ),
                    )
                    newProducts++
                }
            }
            log.info("Dev seed: {} categorías, {} productos nuevos (hogar {})", newCategories, newProducts, householdId)
            newCategories to newProducts
        }!!
}
