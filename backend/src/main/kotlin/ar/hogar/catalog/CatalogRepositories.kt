package ar.hogar.catalog

import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.util.UUID

interface CategoryRepository : JpaRepository<Category, UUID> {
    @Query("select c from Category c where c.householdId = :householdId order by lower(c.name), c.id")
    fun findAllByHousehold(
        @Param("householdId") householdId: UUID,
    ): List<Category>

    fun existsByHouseholdIdAndNameIgnoreCaseAndIdNot(
        householdId: UUID,
        name: String,
        id: UUID,
    ): Boolean

    fun existsByHouseholdIdAndNameIgnoreCase(
        householdId: UUID,
        name: String,
    ): Boolean
}

interface ProductRepository : JpaRepository<Product, UUID> {
    fun existsByCategoryId(categoryId: UUID): Boolean

    fun existsByHouseholdIdAndNameIgnoreCase(
        householdId: UUID,
        name: String,
    ): Boolean

    fun existsByHouseholdIdAndNameIgnoreCaseAndIdNot(
        householdId: UUID,
        name: String,
        id: UUID,
    ): Boolean

    /** `q` es un patrón LIKE ya escapado (o null). */
    @Query(
        """
        select p from Product p
        where p.householdId = :householdId
          and (:includeArchived = true or p.archived = false)
          and (:categoryId is null or p.categoryId = :categoryId)
          and (:pattern is null or lower(p.name) like :pattern escape '\')
        """,
    )
    fun search(
        @Param("householdId") householdId: UUID,
        @Param("pattern") pattern: String?,
        @Param("categoryId") categoryId: UUID?,
        @Param("includeArchived") includeArchived: Boolean,
        pageable: Pageable,
    ): Page<Product>
}
