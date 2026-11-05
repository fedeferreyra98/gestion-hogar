package ar.hogar.auth

import org.springframework.security.oauth2.jose.jws.MacAlgorithm
import org.springframework.security.oauth2.jwt.JwsHeader
import org.springframework.security.oauth2.jwt.JwtClaimsSet
import org.springframework.security.oauth2.jwt.JwtEncoder
import org.springframework.security.oauth2.jwt.JwtEncoderParameters
import org.springframework.stereotype.Component
import java.time.Clock

/** Emite access tokens JWT HS256: `sub`=memberId, `hid`=householdId, `role`. */
@Component
class JwtService(
    private val encoder: JwtEncoder,
    private val props: AuthProperties,
    private val clock: Clock,
) {
    fun issueAccessToken(member: Member): String {
        val now = clock.instant()
        val claims =
            JwtClaimsSet
                .builder()
                .subject(member.id.toString())
                .issuedAt(now)
                .expiresAt(now.plus(props.accessTtl))
                .claim("hid", member.householdId.toString())
                .claim("role", member.role.name)
                .build()
        val header = JwsHeader.with(MacAlgorithm.HS256).build()
        return encoder.encode(JwtEncoderParameters.from(header, claims)).tokenValue
    }
}
