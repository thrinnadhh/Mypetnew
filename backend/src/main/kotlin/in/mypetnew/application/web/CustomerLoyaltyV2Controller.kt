package `in`.mypetnew.application.web

import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.loyalty.domain.LoyaltyRewardStatus
import `in`.mypetnew.loyalty.domain.LoyaltyService
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.UUID

data class CustomerLoyaltyRewardResponse(
    val rewardId: UUID,
    val valuePaise: Long,
    val status: LoyaltyRewardStatus,
    val issuedAt: Instant,
    val expiresAt: Instant,
)

data class CustomerLoyaltyV2Response(
    val organizationId: UUID,
    val availableStars: Int,
    val rewards: List<CustomerLoyaltyRewardResponse>,
)

@RestController
@RequestMapping("/api/v2/customer/loyalty")
class CustomerLoyaltyV2Controller(
    private val loyalty: LoyaltyService,
) {
    @GetMapping("/{organizationId}")
    fun get(
        authentication: Authentication,
        @PathVariable organizationId: UUID,
    ): CustomerLoyaltyV2Response {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        return CustomerLoyaltyV2Response(
            organizationId = organizationId,
            availableStars = loyalty.balance(customer.actorId, organizationId),
            rewards = loyalty.rewards(customer.actorId, organizationId).map { reward ->
                CustomerLoyaltyRewardResponse(
                    rewardId = reward.id,
                    valuePaise = reward.amountPaise,
                    status = reward.status,
                    issuedAt = reward.issuedAt,
                    expiresAt = reward.expiresAt,
                )
            },
        )
    }
}
