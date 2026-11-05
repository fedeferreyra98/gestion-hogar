package ar.hogar.auth

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.Instant
import java.util.UUID

interface HouseholdRepository : JpaRepository<Household, UUID>

interface MemberRepository : JpaRepository<Member, UUID> {
    @Query("select m from Member m where lower(m.email) = lower(:email)")
    fun findByEmailIgnoreCase(
        @Param("email") email: String,
    ): Member?
}

interface RefreshTokenRepository : JpaRepository<RefreshToken, UUID> { // allow-secret: tipo, no un valor
    fun findByTokenHash(tokenHash: String): RefreshToken?

    /** Revocación atómica: devuelve 1 solo para quien gana la carrera (rotación sin doble uso). */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(
        "update RefreshToken t set t.revokedAt = :now, t.updatedAt = :now " +
            "where t.id = :id and t.revokedAt is null",
    )
    fun revoke(
        @Param("id") id: UUID,
        @Param("now") now: Instant,
    ): Int
}
