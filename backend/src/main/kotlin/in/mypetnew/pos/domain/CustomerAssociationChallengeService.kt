package `in`.mypetnew.pos.domain

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.idempotency.IdempotencyStore
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

data class CustomerAssociationChallenge(
    val id: UUID,
    val customerId: UUID,
    val organizationId: UUID,
    val outletId: UUID,
    val expiresAt: Instant,
    val consumedAt: Instant? = null,
)

interface CustomerAssociationPersistence {
    fun create(
        challenge: CustomerAssociationChallenge,
        idempotencyKey: String,
        requestFingerprint: String,
    ): CustomerAssociationChallenge

    fun consume(challengeId: UUID, organizationId: UUID, outletId: UUID, at: Instant): UUID
    fun resolveCustomerForReplay(challengeId: UUID, organizationId: UUID, outletId: UUID): UUID?
}

class CustomerAssociationChallengeService(
    private val clock: Clock = Clock.systemUTC(),
    private val lifetime: Duration = Duration.ofMinutes(3),
    private val persistence: CustomerAssociationPersistence = InMemoryCustomerAssociationPersistence(),
) {
    fun create(
        customerId: UUID,
        organizationId: UUID,
        outletId: UUID,
        idempotencyKey: String,
    ): CustomerAssociationChallenge {
        validateIdempotencyKey(idempotencyKey)
        val fingerprint = sha256("$customerId:$organizationId:$outletId")
        return persistence.create(
            CustomerAssociationChallenge(
                id = UUID.randomUUID(),
                customerId = customerId,
                organizationId = organizationId,
                outletId = outletId,
                expiresAt = clock.instant().plus(lifetime),
            ),
            idempotencyKey,
            fingerprint,
        )
    }

    fun consume(challengeId: UUID, organizationId: UUID, outletId: UUID): UUID =
        persistence.consume(challengeId, organizationId, outletId, clock.instant())

    fun resolveCustomerForReplay(challengeId: UUID, organizationId: UUID, outletId: UUID): UUID? =
        persistence.resolveCustomerForReplay(challengeId, organizationId, outletId)

    private fun validateIdempotencyKey(key: String) {
        if (!key.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) {
            throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
        }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}

private class InMemoryCustomerAssociationPersistence : CustomerAssociationPersistence {
    private val challenges = mutableMapOf<UUID, CustomerAssociationChallenge>()
    private val keys = IdempotencyStore<CustomerAssociationChallenge>()

    @Synchronized
    override fun create(
        challenge: CustomerAssociationChallenge,
        idempotencyKey: String,
        requestFingerprint: String,
    ): CustomerAssociationChallenge = keys.execute(
        "pos-association:${challenge.customerId}",
        idempotencyKey,
        requestFingerprint,
    ) {
        challenge.also { challenges[it.id] = it }
    }

    @Synchronized
    override fun resolveCustomerForReplay(challengeId: UUID, organizationId: UUID, outletId: UUID): UUID? {
        val challenge = challenges[challengeId] ?: return null
        if (challenge.organizationId != organizationId || challenge.outletId != outletId) return null
        return challenge.customerId
    }

    @Synchronized
    override fun consume(challengeId: UUID, organizationId: UUID, outletId: UUID, at: Instant): UUID {
        val challenge = challenges[challengeId] ?: invalid()
        if (
            challenge.organizationId != organizationId ||
            challenge.outletId != outletId ||
            challenge.consumedAt != null ||
            !at.isBefore(challenge.expiresAt)
        ) invalid()
        challenges[challengeId] = challenge.copy(consumedAt = at)
        return challenge.customerId
    }

    private fun invalid(): Nothing = throw DomainException(
        "CUSTOMER_ASSOCIATION_INVALID",
        "The customer association challenge is invalid or expired",
    )
}
