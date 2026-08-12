package `in`.mypetnew.pos.infrastructure

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.pos.domain.CustomerAssociationChallenge
import `in`.mypetnew.pos.domain.CustomerAssociationPersistence
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID

class JdbcCustomerAssociationPersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
) : CustomerAssociationPersistence {
    override fun create(
        challenge: CustomerAssociationChallenge,
        idempotencyKey: String,
        requestFingerprint: String,
    ): CustomerAssociationChallenge {
        replay(challenge.customerId, idempotencyKey, requestFingerprint)?.let { return it }
        try {
            jdbc.update(
                """
                INSERT INTO mypet.pos_customer_association_challenge (
                    id, customer_id, organization_id, outlet_id, expires_at,
                    consumed_at, idempotency_key, request_fingerprint
                ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
                """.trimIndent(),
                challenge.id,
                challenge.customerId,
                challenge.organizationId,
                challenge.outletId,
                challenge.expiresAt,
                idempotencyKey,
                requestFingerprint,
            )
            return challenge
        } catch (duplicate: DuplicateKeyException) {
            return replay(challenge.customerId, idempotencyKey, requestFingerprint)
                ?: throw DomainException(
                    "CUSTOMER_ASSOCIATION_CONFLICT",
                    "The customer association challenge changed concurrently",
                )
        }
    }

    override fun consume(challengeId: UUID, organizationId: UUID, outletId: UUID, at: Instant): UUID =
        transactions.execute {
            val challenge = jdbc.query(
                """
                SELECT customer_id, organization_id, outlet_id, expires_at, consumed_at
                FROM mypet.pos_customer_association_challenge
                WHERE id = ?
                FOR UPDATE
                """.trimIndent(),
                { result, _ ->
                    StoredChallenge(
                        customerId = result.getObject("customer_id", UUID::class.java),
                        organizationId = result.getObject("organization_id", UUID::class.java),
                        outletId = result.getObject("outlet_id", UUID::class.java),
                        expiresAt = result.getTimestamp("expires_at").toInstant(),
                        consumedAt = result.getTimestamp("consumed_at")?.toInstant(),
                    )
                },
                challengeId,
            ).singleOrNull() ?: invalid()
            if (
                challenge.organizationId != organizationId ||
                challenge.outletId != outletId ||
                challenge.consumedAt != null ||
                !at.isBefore(challenge.expiresAt)
            ) invalid()
            val updated = jdbc.update(
                """
                UPDATE mypet.pos_customer_association_challenge
                SET consumed_at = ?
                WHERE id = ? AND consumed_at IS NULL
                """.trimIndent(),
                at,
                challengeId,
            )
            if (updated != 1) invalid()
            challenge.customerId
        }

    private fun replay(customerId: UUID, idempotencyKey: String, requestFingerprint: String): CustomerAssociationChallenge? {
        val row = jdbc.query(
            """
            SELECT id, customer_id, organization_id, outlet_id, expires_at, consumed_at, request_fingerprint
            FROM mypet.pos_customer_association_challenge
            WHERE customer_id = ? AND idempotency_key = ?
            """.trimIndent(),
            { result, _ ->
                StoredReplay(
                    challenge = CustomerAssociationChallenge(
                        id = result.getObject("id", UUID::class.java),
                        customerId = result.getObject("customer_id", UUID::class.java),
                        organizationId = result.getObject("organization_id", UUID::class.java),
                        outletId = result.getObject("outlet_id", UUID::class.java),
                        expiresAt = result.getTimestamp("expires_at").toInstant(),
                        consumedAt = result.getTimestamp("consumed_at")?.toInstant(),
                    ),
                    fingerprint = result.getString("request_fingerprint"),
                )
            },
            customerId,
            idempotencyKey,
        ).singleOrNull() ?: return null
        if (row.fingerprint != requestFingerprint) {
            throw DomainException(
                "IDEMPOTENCY_FINGERPRINT_MISMATCH",
                "The idempotency key was already used for another request",
            )
        }
        return row.challenge
    }

    private fun invalid(): Nothing = throw DomainException(
        "CUSTOMER_ASSOCIATION_INVALID",
        "The customer association challenge is invalid or expired",
    )

    private data class StoredChallenge(
        val customerId: UUID,
        val organizationId: UUID,
        val outletId: UUID,
        val expiresAt: Instant,
        val consumedAt: Instant?,
    )

    private data class StoredReplay(
        val challenge: CustomerAssociationChallenge,
        val fingerprint: String,
    )
}
