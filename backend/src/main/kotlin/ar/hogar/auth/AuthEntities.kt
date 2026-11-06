package ar.hogar.auth

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "household")
class Household(
    @Id val id: UUID,
    var name: String,
    @JdbcTypeCode(SqlTypes.CHAR) @Column(length = 3) @Suppress("unused") var baseCurrency: String = "ARS",
    @Suppress("unused") var timezone: String = "America/Argentina/Buenos_Aires",
    @Suppress("unused") var expiryWarningDays: Int = 3,
    @Suppress("unused") var sharePurchasesByDefault: Boolean = true,
    val createdAt: Instant,
    var updatedAt: Instant,
)

enum class Role { OWNER, MEMBER }

@Entity
@Table(name = "member")
class Member(
    @Id val id: UUID,
    val householdId: UUID,
    var email: String,
    var passwordHash: String,
    var displayName: String,
    @jakarta.persistence.Enumerated(jakarta.persistence.EnumType.STRING) var role: Role,
    var active: Boolean = true,
    val createdAt: Instant,
    var updatedAt: Instant,
)

@Entity
@Table(name = "refresh_token")
class RefreshToken(
    @Id val id: UUID,
    val memberId: UUID,
    val tokenHash: String,
    val expiresAt: Instant,
    var revokedAt: Instant? = null,
    val createdAt: Instant,
    var updatedAt: Instant,
)
