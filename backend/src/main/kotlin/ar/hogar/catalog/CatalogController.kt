package ar.hogar.catalog

import ar.hogar.common.PageResponse
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

/** Catálogo del hogar: lectura y escritura para cualquier miembro (OWNER o MEMBER). */
@RestController
@RequestMapping("/api/v1")
@PreAuthorize("hasAnyRole('OWNER','MEMBER')")
class CatalogController(
    private val service: CatalogService,
) {
    private fun Jwt.householdId() = UUID.fromString(getClaimAsString("hid"))

    @GetMapping("/categories")
    fun listCategories(
        @AuthenticationPrincipal jwt: Jwt,
    ): List<CategoryDto> = service.listCategories(jwt.householdId())

    @PostMapping("/categories")
    fun createCategory(
        @AuthenticationPrincipal jwt: Jwt,
        @Valid @RequestBody req: CategoryInput,
    ): ResponseEntity<CategoryDto> =
        ResponseEntity.status(HttpStatus.CREATED).body(service.createCategory(jwt.householdId(), req))

    @PutMapping("/categories/{id}")
    fun updateCategory(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
        @Valid @RequestBody req: CategoryInput,
    ): CategoryDto = service.updateCategory(jwt.householdId(), id, req)

    @DeleteMapping("/categories/{id}")
    fun deleteCategory(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
    ): ResponseEntity<Void> {
        service.deleteCategory(jwt.householdId(), id)
        return ResponseEntity.noContent().build()
    }

    @GetMapping("/products")
    fun listProducts(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestParam(required = false) q: String?,
        @RequestParam(required = false) categoryId: UUID?,
        @RequestParam(defaultValue = "false") includeArchived: Boolean,
        @RequestParam(required = false) page: Int?,
        @RequestParam(required = false) size: Int?,
        @RequestParam(required = false) sort: String?,
    ): PageResponse<ProductDto> =
        service.searchProducts(jwt.householdId(), q, categoryId, includeArchived, page, size, sort)

    @PostMapping("/products")
    fun createProduct(
        @AuthenticationPrincipal jwt: Jwt,
        @Valid @RequestBody req: ProductInput,
    ): ResponseEntity<ProductDto> =
        ResponseEntity.status(HttpStatus.CREATED).body(service.createProduct(jwt.householdId(), req))

    @PutMapping("/products/{id}")
    fun updateProduct(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
        @Valid @RequestBody req: ProductInput,
    ): ProductDto = service.updateProduct(jwt.householdId(), id, req)

    @PostMapping("/products/{id}/archive")
    fun archive(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
    ): ProductDto = service.setArchived(jwt.householdId(), id, true)

    @PostMapping("/products/{id}/unarchive")
    fun unarchive(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
    ): ProductDto = service.setArchived(jwt.householdId(), id, false)
}
