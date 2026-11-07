package ar.hogar.auth

import ar.hogar.common.ConflictException
import ar.hogar.common.UnauthorizedException
import org.springframework.context.ApplicationEventPublisher
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.util.Base64
import java.util.HexFormat
import java.util.UUID

/** Se publica al crear el hogar (los listeners transaccionales corren tras el commit). */
data class HouseholdRegisteredEvent(
    val householdId: UUID,
)

/** UC-01/UC-02, ADR-008: access JWT + refresh opaco (hash SHA-256 en BD) con rotación. */
@Service
class AuthService(
    private val households: HouseholdRepository,
    private val members: MemberRepository,
    private val refreshTokens: RefreshTokenRepository, // allow-secret: tipo, no un valor
    private val passwordEncoder: PasswordEncoder, // allow-secret: tipo, no un valor
    private val jwt: JwtService,
    private val props: AuthProperties,
    private val clock: Clock,
    private val events: ApplicationEventPublisher,
) {
    private val random = SecureRandom()

    // Hash precalculado para igualar el tiempo de respuesta cuando el email no existe
    private val dummyHash: String by lazy { passwordEncoder.encode("dummy-password-for-timing") }

    @Transactional
    fun registerOwner(req: RegisterOwnerRequest): AuthTokens {
        if (households.count() > 0) throw ConflictException("A household already exists")
        val email = normalize(req.email)
        if (members.findByEmailIgnoreCase(email) != null) throw ConflictException("Email already registered")
        val now = clock.instant()
        val household =
            households.save(
                Household(UUID.randomUUID(), req.householdName.trim(), createdAt = now, updatedAt = now),
            )
        val owner =
            members.saveAndFlush(
                Member(
                    id = UUID.randomUUID(),
                    householdId = household.id,
                    email = email,
                    passwordHash = passwordEncoder.encode(req.password)!!,
                    displayName = req.displayName.trim(),
                    role = Role.OWNER,
                    createdAt = now,
                    updatedAt = now,
                ),
            )
        events.publishEvent(HouseholdRegisteredEvent(household.id))
        return issueTokens(owner)
    }

    @Transactional
    fun login(req: LoginRequest): AuthTokens {
        val member = members.findByEmailIgnoreCase(normalize(req.email))
        val matches = passwordEncoder.matches(req.password, member?.passwordHash ?: dummyHash)
        if (member == null || !matches || !member.active) throw UnauthorizedException()
        return issueTokens(member)
    }

    @Transactional
    fun refresh(rawToken: String): AuthTokens {
        val now = clock.instant()
        val stored =
            refreshTokens.findByTokenHash(hash(rawToken)) ?: throw UnauthorizedException("Invalid refresh token")
        if (stored.revokedAt != null ||
            !stored.expiresAt.isAfter(now)
        ) {
            throw UnauthorizedException("Invalid refresh token")
        }
        val member = members.findById(stored.memberId).orElse(null)
        if (member == null || !member.active) throw UnauthorizedException("Invalid refresh token")
        // Rotación: solo una petición concurrente puede consumir el token
        if (refreshTokens.revoke(stored.id, now) != 1) throw UnauthorizedException("Invalid refresh token")
        return issueTokens(member)
    }

    /** Idempotente: un token desconocido, ajeno o ya revocado no es error. */
    @Transactional
    fun logout(
        memberId: UUID,
        rawToken: String,
    ) {
        val stored = refreshTokens.findByTokenHash(hash(rawToken)) ?: return
        if (stored.memberId == memberId) refreshTokens.revoke(stored.id, clock.instant())
    }

    private fun issueTokens(member: Member): AuthTokens {
        val now = clock.instant()
        val raw =
            ByteArray(
                32,
            ).also(random::nextBytes).let { Base64.getUrlEncoder().withoutPadding().encodeToString(it) }
        refreshTokens.save(
            RefreshToken(
                id = UUID.randomUUID(),
                memberId = member.id,
                tokenHash = hash(raw),
                expiresAt = now.plus(props.refreshTtl),
                createdAt = now,
                updatedAt = now,
            ),
        )
        return AuthTokens(jwt.issueAccessToken(member), raw, props.accessTtl.seconds)
    }

    private fun normalize(email: String) = email.trim().lowercase()

    private fun hash(raw: String): String =
        HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(raw.toByteArray()))
}
