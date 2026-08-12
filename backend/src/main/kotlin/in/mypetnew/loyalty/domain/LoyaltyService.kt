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

interface LoyaltyPersistence {
    fun award(customerId: UUID, merchantId: UUID, sourceReference: String, eligibleSpendPaise: Long): LoyaltyAward
    fun balance(customerId: UUID, merchantId: UUID): Int
    fun rewards(customerId: UUID, merchantId: UUID): List<LoyaltyReward>
}

class LoyaltyService(
    private val persistence: LoyaltyPersistence = InMemoryLoyaltyPersistence(),
) {
    constructor(minimumSpendPaise: Long, rewardAmountPaise: Long) : this(
        InMemoryLoyaltyPersistence(minimumSpendPaise, rewardAmountPaise),
    )

    fun award(customerId: UUID, merchantId: UUID, sourceReference: String, eligibleSpendPaise: Long): LoyaltyAward =
        persistence.award(customerId, merchantId, sourceReference, eligibleSpendPaise)

    fun balance(customerId: UUID, merchantId: UUID): Int = persistence.balance(customerId, merchantId)

    fun rewards(customerId: UUID, merchantId: UUID): List<LoyaltyReward> = persistence.rewards(customerId, merchantId)
}

private class InMemoryLoyaltyPersistence(
    private val minimumSpendPaise: Long = 10_000,
    private val rewardAmountPaise: Long = 5_000,
) : LoyaltyPersistence {
    private data class Relationship(
        val sources: MutableSet<String> = mutableSetOf(),
        var availableStars: Int = 0,
        val rewards: MutableList<LoyaltyReward> = mutableListOf(),
    )

    private val relationships = mutableMapOf<Pair<UUID, UUID>, Relationship>()

    @Synchronized
    override fun award(
        customerId: UUID,
        merchantId: UUID,
        sourceReference: String,
        eligibleSpendPaise: Long,
    ): LoyaltyAward {
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
    override fun balance(customerId: UUID, merchantId: UUID): Int =
        relationships[customerId to merchantId]?.availableStars ?: 0

    @Synchronized
    override fun rewards(customerId: UUID, merchantId: UUID): List<LoyaltyReward> =
        relationships[customerId to merchantId]?.rewards?.toList().orEmpty()
}
