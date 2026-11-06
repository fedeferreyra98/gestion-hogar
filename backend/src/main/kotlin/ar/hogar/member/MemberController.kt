package ar.hogar.member

import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

/** Lectura: cualquier miembro autenticado. Escritura: solo OWNER (`@PreAuthorize`). */
@RestController
@RequestMapping("/api/v1")
class MemberController(
    private val service: MemberService,
) {
    private fun Jwt.memberId() = UUID.fromString(subject)

    private fun Jwt.householdId() = UUID.fromString(getClaimAsString("hid"))

    @GetMapping("/me")
    fun me(
        @AuthenticationPrincipal jwt: Jwt,
    ): MeDto = service.me(jwt.memberId())

    @GetMapping("/members")
    fun list(
        @AuthenticationPrincipal jwt: Jwt,
    ): List<MemberDto> = service.list(jwt.householdId())

    @PostMapping("/members")
    @PreAuthorize("hasRole('OWNER')")
    fun create(
        @AuthenticationPrincipal jwt: Jwt,
        @Valid @RequestBody req: CreateMemberRequest,
    ): ResponseEntity<MemberDto> =
        ResponseEntity.status(HttpStatus.CREATED).body(service.create(jwt.householdId(), req))

    @PatchMapping("/members/{id}")
    @PreAuthorize("hasRole('OWNER')")
    fun update(
        @AuthenticationPrincipal jwt: Jwt,
        @PathVariable id: UUID,
        @Valid @RequestBody req: UpdateMemberRequest,
    ): MemberDto = service.update(jwt.memberId(), jwt.householdId(), id, req)

    @PutMapping("/household")
    @PreAuthorize("hasRole('OWNER')")
    fun updateHousehold(
        @AuthenticationPrincipal jwt: Jwt,
        @Valid @RequestBody req: UpdateHouseholdRequest,
    ): HouseholdDto = service.updateHousehold(jwt.householdId(), req)
}
