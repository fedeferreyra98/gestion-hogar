package ar.hogar.member

import ar.hogar.auth.Household
import ar.hogar.auth.HouseholdRepository
import ar.hogar.auth.Member
import ar.hogar.auth.MemberRepository
import ar.hogar.auth.RefreshTokenRepository
import ar.hogar.auth.Role
import ar.hogar.common.ConflictException
import ar.hogar.common.NotFoundException
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.util.UUID

/** UC-03: gestión de miembros y configuración del hogar. Autorización por rol en el controller. */
@Service
class MemberService(
    private val households: HouseholdRepository,
    private val members: MemberRepository,
    private val refreshTokens: RefreshTokenRepository, // allow-secret: tipo, no un valor
    private val passwordEncoder: PasswordEncoder, // allow-secret: tipo, no un valor
    private val clock: Clock,
) {
    @Transactional(readOnly = true)
    fun me(memberId: UUID): MeDto {
        val member = find(memberId)
        return MeDto(member.toDto(), household(member.householdId).toDto())
    }

    @Transactional(readOnly = true)
    fun list(householdId: UUID): List<MemberDto> =
        members.findByHouseholdIdOrderByCreatedAtAsc(householdId).map { it.toDto() }

    @Transactional
    fun create(
        householdId: UUID,
        req: CreateMemberRequest,
    ): MemberDto {
        val email = req.email.trim().lowercase()
        if (members.findByEmailIgnoreCase(email) != null) throw ConflictException("Email already registered")
        val now = clock.instant()
        val created =
            members.saveAndFlush(
                Member(
                    id = UUID.randomUUID(),
                    householdId = householdId,
                    email = email,
                    passwordHash = passwordEncoder.encode(req.password)!!,
                    displayName = req.displayName.trim(),
                    role = Role.MEMBER,
                    createdAt = now,
                    updatedAt = now,
                ),
            )
        return created.toDto()
    }

    @Transactional
    fun update(
        actorId: UUID,
        householdId: UUID,
        id: UUID,
        req: UpdateMemberRequest,
    ): MemberDto {
        val member =
            members.findById(id).orElse(null)?.takeIf { it.householdId == householdId }
                ?: throw NotFoundException("Member not found")
        if (req.active == false && member.id == actorId) {
            throw ConflictException("You cannot deactivate yourself")
        }
        val now = clock.instant()
        req.displayName?.let { member.displayName = it.trim() }
        if (req.active != null && req.active != member.active) {
            member.active = req.active
            if (!req.active) refreshTokens.revokeAllForMember(member.id, now)
        }
        member.updatedAt = now
        return members.save(member).toDto()
    }

    @Transactional
    fun updateHousehold(
        householdId: UUID,
        req: UpdateHouseholdRequest,
    ): HouseholdDto {
        val h = household(householdId)
        req.name?.let { h.name = it.trim() }
        req.expiryWarningDays?.let { h.expiryWarningDays = it }
        req.sharePurchasesByDefault?.let { h.sharePurchasesByDefault = it }
        h.updatedAt = clock.instant()
        return households.save(h).toDto()
    }

    private fun find(id: UUID) = members.findById(id).orElseThrow { NotFoundException("Member not found") }

    private fun household(id: UUID) = households.findById(id).orElseThrow { NotFoundException("Household not found") }

    private fun Member.toDto() = MemberDto(id, email, displayName, role, active)

    private fun Household.toDto() =
        HouseholdDto(id, name, baseCurrency, timezone, expiryWarningDays, sharePurchasesByDefault)
}
