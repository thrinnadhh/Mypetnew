package `in`.mypetnew.loyalty.infrastructure

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.loyalty.domain.LoyaltyAward
import `in`.mypetnew.loyalty.domain.LoyaltyPersistence
import `in`.mypetnew.loyalty.domain.LoyaltyReward
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.temporal.ChronoUnit
import java.util.UUID

class JdbcLoyaltyPersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
    private val clock: Clock = Clock.systemUTC(),
) : LoyaltyPersistence {
    override fun award(
        customerId: UUID,
        merchantId: UUID,
        sourceReference: String,
        eligibleSpendPaise: Long,
    ): LoyaltyAward {
        validateSource(sourceReference, eligibleSpendPaise)
        return transactions.execute {
            jdbc.update(
                """
                INSERT INTO mypet.loyalty_relationship (
                    customer_id, organization_id, available_stars, star_debt, version
                ) VALUES (?, ?, 0, 0, 0)
                ON CONFLICT (customer_id, organization_id) DO NOTHING
                """.trimIndent(),
                customerId,
                merchantId,
            )
            val balance = lockRelationship(customerId, merchantId)
            val sourceType = sourceType(sourceReference)
            val existing = jdbc.queryForObject(
                """
                SELECT COUNT(*)
                FROM mypet.loyalty_source
                WHERE customer_id = ? AND organization_id = ?
                  AND source_type = ? AND source_reference = ?
                """.trimIndent(),
                Int::class.java,
                customerId,
                merchantId,
                sourceType,
                sourceReference,
            ) ?: 0
            if (existing > 0) {
                return@execute LoyaltyAward(sourceReference, false, balance.availableStars)
            }

            val config = merchantConfig(merchantId)
            val eligible = eligibleSpendPaise >= config.minimumSpendPaise
            val sourceId = UUID.randomUUID()
            jdbc.update(
                """
                INSERT INTO mypet.loyalty_source (
                    id, customer_id, organization_id, outlet_id, source_type, source_reference,
                    eligible_spend_paise, rule_version, awarded
                ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)
                """.trimIndent(),
                sourceId,
                customerId,
                merchantId,
                sourceType,
                sourceReference,
                eligibleSpendPaise,
                config.ruleVersion,
                eligible,
            )
            if (!eligible) {
                return@execute LoyaltyAward(sourceReference, false, balance.availableStars)
            }

            var availableStars = Math.addExact(balance.availableStars, 1)
            insertLedger(customerId, merchantId, sourceId, "AWARD", 1)
            if (availableStars >= 10) {
                availableStars -= 10
                insertLedger(customerId, merchantId, sourceId, "REWARD_ISSUE", -10)
                val issuedAt = clock.instant()
                jdbc.update(
                    """
                    INSERT INTO mypet.loyalty_reward (
                        id, customer_id, organization_id, amount_paise, status,
                        rule_version, issued_at, expires_at
                    ) VALUES (?, ?, ?, ?, 'ISSUED', ?, ?, ?)
                    """.trimIndent(),
                    UUID.randomUUID(),
                    customerId,
                    merchantId,
                    config.rewardAmountPaise,
                    config.ruleVersion,
                    issuedAt,
                    issuedAt.plus(90, ChronoUnit.DAYS),
                )
            }
            jdbc.update(
                """
                UPDATE mypet.loyalty_relationship
                SET available_stars = ?, version = version + 1
                WHERE customer_id = ? AND organization_id = ?
                """.trimIndent(),
                availableStars,
                customerId,
                merchantId,
            )
            LoyaltyAward(sourceReference, true, availableStars)
        }
    }

    override fun balance(customerId: UUID, merchantId: UUID): Int = jdbc.query(
        """
        SELECT available_stars
        FROM mypet.loyalty_relationship
        WHERE customer_id = ? AND organization_id = ?
        """.trimIndent(),
        { result, _ -> result.getInt("available_stars") },
        customerId,
        merchantId,
    ).singleOrNull() ?: 0

    override fun rewards(customerId: UUID, merchantId: UUID): List<LoyaltyReward> = jdbc.query(
        """
        SELECT id, amount_paise, rule_version, issued_at, expires_at
        FROM mypet.loyalty_reward
        WHERE customer_id = ? AND organization_id = ?
        ORDER BY issued_at, id
        """.trimIndent(),
        { result, _ ->
            LoyaltyReward(
                id = result.getObject("id", UUID::class.java),
                amountPaise = result.getLong("amount_paise"),
                ruleVersion = result.getString("rule_version"),
                issuedAt = result.getTimestamp("issued_at").toInstant(),
                expiresAt = result.getTimestamp("expires_at").toInstant(),
            )
        },
        customerId,
        merchantId,
    )

    private fun lockRelationship(customerId: UUID, merchantId: UUID): Relationship = jdbc.query(
        """
        SELECT available_stars, star_debt, version
        FROM mypet.loyalty_relationship
        WHERE customer_id = ? AND organization_id = ?
        FOR UPDATE
        """.trimIndent(),
        { result, _ ->
            Relationship(
                availableStars = result.getInt("available_stars"),
                starDebt = result.getInt("star_debt"),
                version = result.getLong("version"),
            )
        },
        customerId,
        merchantId,
    ).singleOrNull() ?: throw DomainException("LOYALTY_UNAVAILABLE", "The loyalty relationship is unavailable")

    private fun merchantConfig(merchantId: UUID): MerchantConfig = jdbc.query(
        """
        SELECT minimum_loyalty_spend_paise, reward_amount_paise, loyalty_rule_version
        FROM mypet.merchant_organization
        WHERE id = ?
        """.trimIndent(),
        { result, _ ->
            MerchantConfig(
                minimumSpendPaise = result.getLong("minimum_loyalty_spend_paise"),
                rewardAmountPaise = result.getLong("reward_amount_paise"),
                ruleVersion = result.getString("loyalty_rule_version"),
            )
        },
        merchantId,
    ).singleOrNull() ?: throw DomainException("LOYALTY_CONFIG_UNAVAILABLE", "Merchant loyalty configuration is unavailable")

    private fun insertLedger(
        customerId: UUID,
        merchantId: UUID,
        sourceId: UUID,
        entryType: String,
        starDelta: Int,
    ) {
        jdbc.update(
            """
            INSERT INTO mypet.loyalty_ledger (
                id, customer_id, organization_id, source_id, entry_type, star_delta
            ) VALUES (?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            UUID.randomUUID(),
            customerId,
            merchantId,
            sourceId,
            entryType,
            starDelta,
        )
    }

    private fun sourceType(sourceReference: String): String = sourceReference
        .substringBefore(':')
        .uppercase()
        .take(40)

    private fun validateSource(sourceReference: String, eligibleSpendPaise: Long) {
        if (sourceReference.isBlank() || sourceReference.length > 160 || eligibleSpendPaise < 0) {
            throw DomainException("LOYALTY_SOURCE_INVALID", "The loyalty source is invalid")
        }
    }

    private data class Relationship(
        val availableStars: Int,
        val starDebt: Int,
        val version: Long,
    )

    private data class MerchantConfig(
        val minimumSpendPaise: Long,
        val rewardAmountPaise: Long,
        val ruleVersion: String,
    )
}
