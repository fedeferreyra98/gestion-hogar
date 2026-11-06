package ar.hogar.shopping

import ar.hogar.common.PageResponse
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

/** Listas de compra: lectura y escritura para cualquier miembro. */
@RestController
@RequestMapping("/api/v1/shopping-lists")
@PreAuthorize("hasAnyRole('OWNER','MEMBER')")
class ShoppingController(
    private val service: ShoppingService,
) {
    private fun Jwt.householdId() = UUID.fromString(getClaimAsString("hid"))

    private fun Jwt.memberId() = UUID.fromString(subject)

    @GetMapping
    fun list(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestParam(required = false) status: ShoppingListStatus?,
        @RequestParam(required = false) page: Int?,
        @RequestParam(required = false) size: Int?,
        @RequestParam(required = false) sort: String?,
    ): PageResponse<ShoppingListSummaryDto> = service.list(jwt.householdId(), status, page, size, sort)

    @PostMapping
    fun create(
        @AuthenticationPrincipal jwt: Jwt,
        @Valid @RequestBody req: ShoppingListInput,
    ): ResponseEntity<ShoppingListDto> =
        ResponseEntity.status(HttpStatus.CREATED).body(service.create(jwt.householdId(), jwt.memberId(), req))

    @GetMapping("/{id}")
    fun get(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
    ): ShoppingListDto = service.get(jwt.householdId(), id)

    @PatchMapping("/{id}")
    fun update(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
        @Valid @RequestBody req: UpdateShoppingListRequest,
    ): ShoppingListDto = service.update(jwt.householdId(), id, req)

    @PostMapping("/{id}/duplicate")
    fun duplicate(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
        @Valid @RequestBody(required = false) req: DuplicateListRequest?,
    ): ResponseEntity<ShoppingListDto> =
        ResponseEntity
            .status(HttpStatus.CREATED)
            .body(service.duplicate(jwt.householdId(), jwt.memberId(), id, req))

    @PostMapping("/{id}/items")
    fun addItem(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
        @Valid @RequestBody req: ShoppingListItemInput,
    ): ResponseEntity<ShoppingListItemDto> =
        ResponseEntity.status(HttpStatus.CREATED).body(service.addItem(jwt.householdId(), id, req))

    @PatchMapping("/{id}/items/{itemId}")
    fun updateItem(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
        @PathVariable itemId: UUID,
        @Valid @RequestBody req: UpdateShoppingListItemRequest,
    ): ShoppingListItemDto = service.updateItem(jwt.householdId(), id, itemId, req)

    @DeleteMapping("/{id}/items/{itemId}")
    fun deleteItem(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
        @PathVariable itemId: UUID,
    ): ResponseEntity<Void> {
        service.deleteItem(jwt.householdId(), id, itemId)
        return ResponseEntity.noContent().build()
    }
}
