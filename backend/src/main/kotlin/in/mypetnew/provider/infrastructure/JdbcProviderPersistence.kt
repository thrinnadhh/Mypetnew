package `in`.mypetnew.provider.infrastructure

import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderOutlet
import `in`.mypetnew.provider.domain.ProviderPersistence
import `in`.mypetnew.provider.domain.ProviderStatus
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.sql.ResultSet
import java.util.UUID

class JdbcProviderPersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
) : ProviderPersistence {
    override fun submit(
        merchant: Principal,
        name: String,
        capabilities: Set<ProviderCapability>,
        servicePinCodes: Set<String>,
        latitude: Double?,
        longitude: Double?,
        idempotencyKey: String,
        requestFingerprint: String,
    ): ProviderOutlet {
        try {
            return transactions.execute {
                replaySubmission(merchant.actorId, idempotencyKey, requestFingerprint)?.let { replay ->
                    ensureOwnerMembership(merchant.actorId, replay.organizationId, replay.id)
                    return@execute replay
                }
                val organizationId = resolveOrganization(merchant, name)
                val outletId = UUID.randomUUID()
                jdbc.update(
                    """
                    INSERT INTO mypet.provider_outlet (
                        id, organization_id, name, status, pickup_enabled, version,
                        dispatch_latitude, dispatch_longitude,
                        submitted_by_actor_id, submission_idempotency_key,
                        submission_request_fingerprint
                    ) VALUES (?, ?, ?, 'UNDER_REVIEW', ?, 0, ?, ?, ?, ?, ?)
                    """.trimIndent(),
                    outletId,
                    organizationId,
                    name,
                    ProviderCapability.PRODUCT_STORE in capabilities,
                    latitude,
                    longitude,
                    merchant.actorId,
                    idempotencyKey,
                    requestFingerprint,
                )
                ensureOwnerMembership(merchant.actorId, organizationId, outletId)
                capabilities.forEach { capability ->
                    jdbc.update(
                        """
                        INSERT INTO mypet.outlet_capability (outlet_id, capability, verified)
                        VALUES (?, ?, FALSE)
                        """.trimIndent(),
                        outletId,
                        capability.name,
                    )
                }
                servicePinCodes.forEach { pinCode ->
                    jdbc.update(
                        """
                        INSERT INTO mypet.outlet_service_pincode (outlet_id, pincode, active)
                        VALUES (?, ?, TRUE)
                        """.trimIndent(),
                        outletId,
                        pinCode,
                    )
                }
                get(outletId) ?: throw IllegalStateException("Provider insert was not readable")
            }
        } catch (duplicate: DuplicateKeyException) {
            replaySubmission(merchant.actorId, idempotencyKey, requestFingerprint)?.let { replay ->
                ensureOwnerMembership(merchant.actorId, replay.organizationId, replay.id)
                return replay
            }
            throw DomainException("PROVIDER_CONFLICT", "Provider onboarding changed concurrently; refresh and retry")
        }
    }

    override fun approve(
        adminActorId: UUID,
        outletId: UUID,
        idempotencyKey: String,
        requestFingerprint: String,
    ): ProviderOutlet = transactions.execute {
        val locked = jdbc.query(
            """
            SELECT id, status, approval_idempotency_key, approval_request_fingerprint
            FROM mypet.provider_outlet
            WHERE id = ?
            FOR UPDATE
            """.trimIndent(),
            { result, _ ->
                ApprovalState(
                    status = ProviderStatus.valueOf(result.getString("status")),
                    idempotencyKey = result.getString("approval_idempotency_key"),
                    requestFingerprint = result.getString("approval_request_fingerprint"),
                )
            },
            outletId,
        ).singleOrNull() ?: notFound()

        if (locked.idempotencyKey == idempotencyKey) {
            if (locked.requestFingerprint != requestFingerprint) fingerprintMismatch()
            return@execute get(outletId) ?: notFound()
        }
        if (locked.status != ProviderStatus.UNDER_REVIEW) {
            throw DomainException("PROVIDER_STATE_INVALID", "The provider cannot be approved from its current state")
        }
        jdbc.update(
            """
            UPDATE mypet.provider_outlet
            SET status = 'ACTIVE', version = version + 1, updated_at = CURRENT_TIMESTAMP,
                approval_idempotency_key = ?, approval_request_fingerprint = ?, approved_by_actor_id = ?
            WHERE id = ?
            """.trimIndent(),
            idempotencyKey,
            requestFingerprint,
            adminActorId,
            outletId,
        )
        jdbc.update("UPDATE mypet.outlet_capability SET verified = TRUE WHERE outlet_id = ?", outletId)
        jdbc.update(
            """
            UPDATE mypet.merchant_organization
            SET status = 'ACTIVE'
            WHERE id = (SELECT organization_id FROM mypet.provider_outlet WHERE id = ?)
            """.trimIndent(),
            outletId,
        )
        get(outletId) ?: notFound()
    }

    override fun updateDispatchOrigin(outletId: UUID, latitude: Double, longitude: Double): ProviderOutlet =
        transactions.execute {
            val updated = jdbc.update(
                """
                UPDATE mypet.provider_outlet
                SET dispatch_latitude = ?, dispatch_longitude = ?,
                    version = version + 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """.trimIndent(),
                latitude,
                longitude,
                outletId,
            )
            if (updated != 1) notFound()
            get(outletId) ?: notFound()
        }

    override fun all(): List<ProviderOutlet> = jdbc.query(
        """
        SELECT o.id, o.organization_id, m.owner_actor_id, o.name, o.status, o.pickup_enabled,
               o.dispatch_latitude, o.dispatch_longitude
        FROM mypet.provider_outlet o
        JOIN mypet.merchant_organization m ON m.id = o.organization_id
        ORDER BY o.created_at, o.id
        """.trimIndent(),
        { result, _ -> outletHeader(result) },
    ).map(::hydrate)

    override fun get(outletId: UUID): ProviderOutlet? {
        val header = jdbc.query(
            """
            SELECT o.id, o.organization_id, m.owner_actor_id, o.name, o.status, o.pickup_enabled,
                   o.dispatch_latitude, o.dispatch_longitude
            FROM mypet.provider_outlet o
            JOIN mypet.merchant_organization m ON m.id = o.organization_id
            WHERE o.id = ?
            """.trimIndent(),
            { result, _ -> outletHeader(result) },
            outletId,
        ).singleOrNull() ?: return null
        return hydrate(header)
    }

    private fun resolveOrganization(merchant: Principal, name: String): UUID {
        merchant.organizationId?.let { requested ->
            val authorized = jdbc.queryForObject(
                """
                SELECT COUNT(*)
                FROM mypet.merchant_organization
                WHERE id = ? AND (owner_actor_id = ? OR owner_actor_id IS NULL)
                """.trimIndent(),
                Int::class.java,
                requested,
                merchant.actorId,
            ) ?: 0
            if (authorized != 1) notFound()
            jdbc.update(
                """
                UPDATE mypet.merchant_organization
                SET owner_actor_id = COALESCE(owner_actor_id, ?)
                WHERE id = ?
                """.trimIndent(),
                merchant.actorId,
                requested,
            )
            return requested
        }

        // A scope-less Merchant is valid only for first onboarding. Once an organization already
        // belongs to this actor, current OWNER membership must be re-established by authorization;
        // owner_actor_id alone is identity metadata and must never resurrect revoked authority.
        val existingOrganization = jdbc.query(
            "SELECT id FROM mypet.merchant_organization WHERE owner_actor_id = ?",
            { result, _ -> result.getObject("id", UUID::class.java) },
            merchant.actorId,
        ).singleOrNull()
        if (existingOrganization != null) {
            throw DomainException("MERCHANT_PERMISSION_REQUIRED", "The required merchant permission is missing")
        }

        val organizationId = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO mypet.merchant_organization (
                id, name, status, owner_actor_id
            ) VALUES (?, ?, 'UNDER_REVIEW', ?)
            """.trimIndent(),
            organizationId,
            name,
            merchant.actorId,
        )
        return organizationId
    }

    private fun ensureOwnerMembership(actorId: UUID, organizationId: UUID, outletId: UUID) {
        jdbc.update(
            """
            INSERT INTO mypet.merchant_staff (
                account_id, organization_id, outlet_id, permission, active
            ) VALUES (?, ?, ?, 'OWNER', TRUE)
            ON CONFLICT (account_id, outlet_id, permission) DO NOTHING
            """.trimIndent(),
            actorId,
            organizationId,
            outletId,
        )
    }

    private fun replaySubmission(
        actorId: UUID,
        idempotencyKey: String,
        requestFingerprint: String,
    ): ProviderOutlet? {
        val row = jdbc.query(
            """
            SELECT id, submission_request_fingerprint
            FROM mypet.provider_outlet
            WHERE submitted_by_actor_id = ? AND submission_idempotency_key = ?
            """.trimIndent(),
            { result, _ ->
                result.getObject("id", UUID::class.java) to result.getString("submission_request_fingerprint")
            },
            actorId,
            idempotencyKey,
        ).singleOrNull() ?: return null
        if (row.second != requestFingerprint) fingerprintMismatch()
        return get(row.first) ?: notFound()
    }

    private fun hydrate(header: OutletHeader): ProviderOutlet {
        val capabilities = jdbc.query(
            "SELECT capability FROM mypet.outlet_capability WHERE outlet_id = ? ORDER BY capability",
            { result, _ -> ProviderCapability.valueOf(result.getString("capability")) },
            header.id,
        ).toSet()
        val pinCodes = jdbc.query(
            """
            SELECT pincode FROM mypet.outlet_service_pincode
            WHERE outlet_id = ? AND active = TRUE
            ORDER BY pincode
            """.trimIndent(),
            { result, _ -> result.getString("pincode") },
            header.id,
        ).toSet()
        return ProviderOutlet(
            id = header.id,
            organizationId = header.organizationId,
            ownerActorId = header.ownerActorId,
            name = header.name,
            capabilities = capabilities,
            servicePinCodes = pinCodes,
            status = header.status,
            pickupEnabled = header.pickupEnabled,
            latitude = header.latitude,
            longitude = header.longitude,
        )
    }

    private fun outletHeader(result: ResultSet): OutletHeader {
        val owner = result.getObject("owner_actor_id", UUID::class.java)
            ?: throw DomainException("PROVIDER_OWNER_MISSING", "The provider owner is unavailable")
        return OutletHeader(
            id = result.getObject("id", UUID::class.java),
            organizationId = result.getObject("organization_id", UUID::class.java),
            ownerActorId = owner,
            name = result.getString("name"),
            status = ProviderStatus.valueOf(result.getString("status")),
            pickupEnabled = result.getBoolean("pickup_enabled"),
            latitude = result.getObject("dispatch_latitude", Double::class.javaObjectType),
            longitude = result.getObject("dispatch_longitude", Double::class.javaObjectType),
        )
    }

    private fun fingerprintMismatch(): Nothing = throw DomainException(
        "IDEMPOTENCY_FINGERPRINT_MISMATCH",
        "The idempotency key was already used for another request",
    )

    private fun notFound(): Nothing = throw DomainException(
        "RESOURCE_NOT_FOUND",
        "The requested resource is unavailable",
    )

    private data class ApprovalState(
        val status: ProviderStatus,
        val idempotencyKey: String?,
        val requestFingerprint: String?,
    )

    private data class OutletHeader(
        val id: UUID,
        val organizationId: UUID,
        val ownerActorId: UUID,
        val name: String,
        val status: ProviderStatus,
        val pickupEnabled: Boolean,
        val latitude: Double?,
        val longitude: Double?,
    )
}
