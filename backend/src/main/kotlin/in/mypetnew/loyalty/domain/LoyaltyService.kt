package `in`.mypetnew.loyalty.domain

import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

data class LoyaltyAward(
    val sourceReference: String,
    val awarded: Boolean,
    val availableBalance: Int,
)

data class LoyaltyReward(
    val id: UUID,
    val amountPaise: Long,
    val ruleVersion: String,
    val issuedAt: Instant,
    val expiresAt: Instant,
)

class LoyaltyService(
    private val minimumSpendPaise: Long = 10_000,
    private val rewardAmountPaise: Long = 5_000,
) {
    private data class Relationship(
        val sources: MutableSet<String> = mutableSetOf(),
        var availableStars: Int = 0,
        val rewards: MutableList<LoyaltyReward> = mutableListOf(),
    )

    private val relationships = mutableMapOf<Pair<UUID, UUID>, Relationship>()

    @Synchronized
    fun award(customerId: UUID, merchantId: UUID, sourceReference: String, eligibleSpendPaise: Long): LoyaltyAward {
        val relationship = relationships.getOrPut(customerId to merchantId) { Relationship() }
        if (sourceReference in relationship.sources) {
            return LoyaltyAward(sourceReference, false, relationship.availableStars)
        }
        relationship.sources += sourceReference
        if (eligibleSpendPaise < minimumSpendPaise) {
            return LoyaltyAward(sourceReference, false, relationship.availableStars)
        }
        relationship.availableStars += 1
        while (relationship.availableStars >= 10) {
            relationship.availableStars -= 10
            val issuedAt = Instant.now()
            relationship.rewards += LoyaltyReward(
                id = UUID.randomUUID(),
                amountPaise = rewardAmountPaise,
                ruleVersion = "s1-v1",
                issuedAt = issuedAt,
                expiresAt = issuedAt.plus(90, ChronoUnit.DAYS),
            )
        }
        return LoyaltyAward(sourceReference, true, relationship.availableStars)
    }

    @Synchronized
    fun balance(customerId: UUID, merchantId: UUID): Int =
        relationships[customerId to merchantId]?.availableStars ?: 0

    @Synchronized
    fun rewards(customerId: UUID, merchantId: UUID): List<LoyaltyReward> =
        relationships[customerId to merchantId]?.rewards?.toList().orEmpty()
}

