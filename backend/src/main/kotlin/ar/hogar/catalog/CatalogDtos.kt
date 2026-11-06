package ar.hogar.catalog

import jakarta.validation.constraints.Min
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotNull
import jakarta.validation.constraints.Size
import java.util.UUID

data class CategoryDto(
    val id: UUID,
    val name: String,
)

data class CategoryInput(
    @field:NotBlank @field:Size(max = 120) val name: String,
)

data class ProductDto(
    val id: UUID,
    val name: String,
    val categoryId: UUID?,
    val defaultUnit: Unit,
    val defaultShelfLifeDays: Int?,
    val archived: Boolean,
)

data class ProductInput(
    @field:NotBlank @field:Size(max = 160) val name: String,
    val categoryId: UUID? = null,
    @field:NotNull val defaultUnit: Unit?,
    @field:Min(0) val defaultShelfLifeDays: Int? = null,
)
