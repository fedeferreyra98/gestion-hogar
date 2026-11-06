package ar.hogar.member

import ar.hogar.auth.Role
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size

data class MemberDto(
    val id: java.util.UUID,
    val email: String,
    val displayName: String,
    val role: Role,
    val active: Boolean,
)

data class HouseholdDto(
    val id: java.util.UUID,
    val name: String,
    val baseCurrency: String,
    val timezone: String,
    val expiryWarningDays: Int,
    val sharePurchasesByDefault: Boolean,
)

data class MeDto(
    val member: MemberDto,
    val household: HouseholdDto,
)

data class CreateMemberRequest(
    @field:NotBlank @field:Email @field:Size(max = 254) val email: String,
    @field:NotBlank @field:Size(max = 120) val displayName: String,
    // 72: límite de BCrypt en bytes
    @field:Size(min = 8, max = 72) val password: String,
)

data class UpdateMemberRequest(
    @field:Pattern(
        regexp = ".*\\S.*",
        message = "must not be blank",
    ) @field:Size(max = 120) val displayName: String? = null,
    val active: Boolean? = null,
)

data class UpdateHouseholdRequest(
    @field:Pattern(regexp = ".*\\S.*", message = "must not be blank") @field:Size(max = 120) val name: String? = null,
    @field:Min(0) val expiryWarningDays: Int? = null,
    val sharePurchasesByDefault: Boolean? = null,
)
