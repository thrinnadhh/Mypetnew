package `in`.mypetnew.loyalty

import `in`.mypetnew.loyalty.domain.LoyaltyRewardStatus
import `in`.mypetnew.loyalty.domain.LoyaltyService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Duration
import java.util.UUID

class LoyaltyRewardProjectionTest {
    @Test
    fun `ten eligible merchant scoped stars issue one visible ninety day reward`() {
        val loyalty = LoyaltyService(minimumSpendPaise = 10_000, rewardAmountPaise = 5_000)
        val customerId = UUID.randomUUID()
        val organizationId = UUID.randomUUID()
        val otherOrganizationId = UUID.randomUUID()

        repeat(10) { index ->
            loyalty.award(customerId, organizationId, "ORDER:$index", 10_000)
        }

        val rewards = loyalty.rewards(customerId, organizationId)
        assertEquals(0, loyalty.balance(customerId, organizationId))
        assertEquals(1, rewards.size)
        assertEquals(5_000, rewards.single().amountPaise)
        assertEquals(LoyaltyRewardStatus.ISSUED, rewards.single().status)
        assertEquals(Duration.ofDays(90), Duration.between(rewards.single().issuedAt, rewards.single().expiresAt))
        assertTrue(loyalty.rewards(customerId, otherOrganizationId).isEmpty())
    }

    @Test
    fun `nineteen eligible stars preserve rollover and issue exactly one reward`() {
        val loyalty = LoyaltyService(minimumSpendPaise = 10_000, rewardAmountPaise = 7_500)
        val customerId = UUID.randomUUID()
        val organizationId = UUID.randomUUID()

        repeat(19) { index ->
            loyalty.award(customerId, organizationId, "POS:$index", 10_000)
        }

        assertEquals(9, loyalty.balance(customerId, organizationId))
        assertEquals(1, loyalty.rewards(customerId, organizationId).size)
    }
}
