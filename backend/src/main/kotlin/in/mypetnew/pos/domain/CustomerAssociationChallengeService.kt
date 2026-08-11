package `in`.mypetnew.pos.domain

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.idempotency.IdempotencyStore
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

class CustomerAssociationChallengeService(
    private val clock: Clock = Clock.systemUTC(),
    private val lifetime: Duration = Duration.ofMinutes(3),
) {
    private val challenges = mutableMapOf<UUID, CustomerAssociationChallenge>()
    private val keys = IdempotencyStore<CustomerAssociationChallenge>()

    @Synchronized
    fun create(
        customerId: UUID,
        organizationId: UUID,
        outletId: UUID,
        idempotencyKey: String,
    ): CustomerAssociationChallenge = keys.execute(
        "pos-association:$customerId",
        idempotencyKey,
        "$organizationId:$outletId",
    ) {
        CustomerAssociationChallenge(
            UUID.randomUUID(),
            customerId,
            organizationId,
            outletId,
            clock.instant().plus(lifetime),
        ).also { challenges[it.id] = it }
    }

    @Synchronized
    fun consume(challengeId: UUID, organizationId: UUID, outletId: UUID): UUID {
        val challenge = challenges[challengeId] ?: invalid()
        if (
            challenge.organizationId != organizationId ||
            challenge.outletId != outletId ||
            challenge.consumedAt != null ||
            !clock.instant().isBefore(challenge.expiresAt)
        ) invalid()
        challenges[challengeId] = challenge.copy(consumedAt = clock.instant())
        return challenge.customerId
    }

    private fun invalid(): Nothing = throw DomainException(
        "CUSTOMER_ASSOCIATION_INVALID",
        "The customer association challenge is invalid or expired",
    )
}

