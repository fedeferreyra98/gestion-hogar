package ar.hogar.catalog

import ar.hogar.common.ConflictException
import ar.hogar.common.NotFoundException
import ar.hogar.common.PageRequests
import ar.hogar.common.PageResponse
import ar.hogar.common.toPageResponse
import ar.hogar.expense.ExpenseRepository
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.domain.Sort
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.util.UUID

/** UC-04: categorías y productos. Todo está acotado al hogar del token. */
@Service
class CatalogService(
    private val categories: CategoryRepository,
    private val products: ProductRepository,
    private val expenses: ExpenseRepository,
    private val clock: Clock,
) {
    // ---- Categorías ----

    @Transactional(readOnly = true)
    fun listCategories(householdId: UUID): List<CategoryDto> =
        categories.findAllByHousehold(householdId).map { it.toDto() }

    @Transactional
    fun createCategory(
        householdId: UUID,
        req: CategoryInput,
    ): CategoryDto {
        val name = req.name.trim()
        if (categories.existsByHouseholdIdAndNameIgnoreCase(householdId, name)) throw duplicate("Category")
        val now = clock.instant()
        val saved =
            flush("Category") { categories.saveAndFlush(Category(UUID.randomUUID(), householdId, name, now, now)) }
        return saved.toDto()
    }

    @Transactional
    fun updateCategory(
        householdId: UUID,
        id: UUID,
        req: CategoryInput,
    ): CategoryDto {
        val category = category(householdId, id)
        val name = req.name.trim()
        if (categories.existsByHouseholdIdAndNameIgnoreCaseAndIdNot(householdId, name, id)) throw duplicate("Category")
        category.name = name
        category.updatedAt = clock.instant()
        return flush("Category") { categories.saveAndFlush(category) }.toDto()
    }

    @Transactional
    fun deleteCategory(
        householdId: UUID,
        id: UUID,
    ) {
        val category = category(householdId, id)
        if (products.existsByCategoryId(id)) throw ConflictException("Category has products")
        if (expenses.existsByCategoryId(id)) throw ConflictException("Category has expenses")
        categories.delete(category)
    }

    // ---- Productos ----

    @Transactional(readOnly = true)
    fun searchProducts(
        householdId: UUID,
        q: String?,
        categoryId: UUID?,
        includeArchived: Boolean,
        page: Int?,
        size: Int?,
        sort: String?,
    ): PageResponse<ProductDto> {
        val pageable =
            PageRequests.of(page, size, sort, setOf("name"), Sort.by(Sort.Direction.ASC, "name"))
        val pattern = q?.trim()?.takeIf { it.isNotEmpty() }?.let { "%" + escapeLike(it.lowercase()) + "%" }
        return products
            .search(
                householdId,
                pattern,
                categoryId,
                includeArchived,
                pageable,
            ).toPageResponse { it.toDto() }
    }

    @Transactional
    fun createProduct(
        householdId: UUID,
        req: ProductInput,
    ): ProductDto {
        val name = req.name.trim()
        req.categoryId?.let { category(householdId, it) }
        if (products.existsByHouseholdIdAndNameIgnoreCase(householdId, name)) throw duplicate("Product")
        val now = clock.instant()
        val product =
            Product(
                id = UUID.randomUUID(),
                householdId = householdId,
                name = name,
                categoryId = req.categoryId,
                defaultUnit = req.defaultUnit!!,
                defaultShelfLifeDays = req.defaultShelfLifeDays,
                createdAt = now,
                updatedAt = now,
            )
        return flush("Product") { products.saveAndFlush(product) }.toDto()
    }

    @Transactional
    fun updateProduct(
        householdId: UUID,
        id: UUID,
        req: ProductInput,
    ): ProductDto {
        val product = product(householdId, id)
        val name = req.name.trim()
        req.categoryId?.let { category(householdId, it) }
        if (products.existsByHouseholdIdAndNameIgnoreCaseAndIdNot(householdId, name, id)) throw duplicate("Product")
        product.name = name
        product.categoryId = req.categoryId
        product.defaultUnit = req.defaultUnit!!
        product.defaultShelfLifeDays = req.defaultShelfLifeDays
        product.updatedAt = clock.instant()
        return flush("Product") { products.saveAndFlush(product) }.toDto()
    }

    @Transactional
    fun setArchived(
        householdId: UUID,
        id: UUID,
        archived: Boolean,
    ): ProductDto {
        val product = product(householdId, id)
        if (product.archived != archived) {
            product.archived = archived
            product.updatedAt = clock.instant()
        }
        return products.save(product).toDto()
    }

    // ---- API para otros módulos (stock, ...) ----

    /** 404 si el producto no existe o es de otro hogar. */
    @Transactional(readOnly = true)
    fun requireProduct(
        householdId: UUID,
        id: UUID,
    ): ProductDto = product(householdId, id).toDto()

    /** Nombres por id, limitado al hogar. */
    @Transactional(readOnly = true)
    fun productNames(
        householdId: UUID,
        ids: Collection<UUID>,
    ): Map<UUID, String> =
        if (ids.isEmpty()) {
            emptyMap()
        } else {
            products.findAllById(ids).filter { it.householdId == householdId }.associate { it.id to it.name }
        }

    // ---- helpers ----

    private fun category(
        householdId: UUID,
        id: UUID,
    ) = categories.findById(id).orElse(null)?.takeIf { it.householdId == householdId }
        ?: throw NotFoundException("Category not found")

    private fun product(
        householdId: UUID,
        id: UUID,
    ) = products.findById(id).orElse(null)?.takeIf { it.householdId == householdId }
        ?: throw NotFoundException("Product not found")

    private fun duplicate(what: String) = ConflictException("$what name already exists")

    /** Carrera entre dos altas con el mismo nombre: el índice único responde 409 en vez de 500. */
    private fun <T> flush(
        what: String,
        block: () -> T,
    ): T =
        try {
            block()
        } catch (_: DataIntegrityViolationException) {
            throw duplicate(what)
        }

    private fun escapeLike(s: String) = s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    private fun Category.toDto() = CategoryDto(id, name)

    private fun Product.toDto() = ProductDto(id, name, categoryId, defaultUnit, defaultShelfLifeDays, archived)
}
