package `in`.mypetnew.provider.domain

import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.idempotency.IdempotencyStore
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID

data class ProviderOutlet(
    val id: UUID,
    val organizationId: UUID,
    val ownerActorId: UUID,
    val name: String,
    val capabilities: Set<ProviderCapability>,
    val servicePinCodes: Set<String>,
    val status: ProviderStatus,
    val pickupEnabled: Boolean = ProviderCapability.PRODUCT_STORE in capabilities,
    val latitude: Double? = null,
    val longitude: Double? = null,
)

interface ProviderPersistence {
    fun submit(
        merchant: Principal,
        name: String,
        capabilities: Set<ProviderCapability>,
        servicePinCodes: Set<String>,
        latitude: Double?,
        longitude: Double?,
        idempotencyKey: String,
        requestFingerprint: String,
    ): ProviderOutlet

    fun approve(
        adminActorId: UUID,
        outletId: UUID,
        idempotencyKey: String,
        requestFingerprint: String,
    ): ProviderOutlet

    fun updateDispatchOrigin(outletId: UUID, latitude: Double, longitude: Double): ProviderOutlet
    fun all(): List<ProviderOutlet>
    fun get(outletId: UUID): ProviderOutlet?
}

class ProviderService(
    private val persistence: ProviderPersistence = InMemoryProviderPersistence(),
) {
    fun submitOutlet(
        merchant: Principal,
        name: String,
        capabilities: Set<ProviderCapability>,
        servicePinCodes: Set<String>,
        idempotencyKey: String,
        latitude: Double? = null,
        longitude: Double? = null,
    ): ProviderOutlet {
        Authorizer.requireRole(merchant, Role.MERCHANT)
        validateSubmission(name, capabilities, servicePinCodes, latitude, longitude)
        validateIdempotencyKey(idempotencyKey)
        if (merchant.organizationId != null) requireOrganizationOwner(merchant)

        val normalizedName = name.trim()
        // Organization scope is deliberately excluded from the canonical fingerprint. A first-time
        // onboarding request starts scope-less and materializes organization authority as its effect;
        // the identical retry must therefore keep the same fingerprint after reauthorization.
        val stableFingerprint = submissionFingerprint(
            merchant.actorId,
            null,
            normalizedName,
            capabilities,
            servicePinCodes,
            latitude,
            longitude,
        )

        return try {
            persistence.submit(
                merchant,
                normalizedName,
                capabilities.toSet(),
                servicePinCodes.toSet(),
                latitude,
                longitude,
                idempotencyKey,
                stableFingerprint,
            )
        } catch (failure: DomainException) {
            // M1 briefly persisted fingerprints that included the derived organization scope. Keep
            // those already-accepted commands replayable while all new commands use the stable form.
            val organizationId = merchant.organizationId
            if (failure.code != "IDEMPOTENCY_FINGERPRINT_MISMATCH" || organizationId == null) throw failure
            val legacyFingerprint = submissionFingerprint(
                merchant.actorId,
                organizationId,
                normalizedName,
                capabilities,
                servicePinCodes,
                latitude,
                longitude,
            )
            if (legacyFingerprint == stableFingerprint) throw failure
            persistence.submit(
                merchant,
                normalizedName,
                capabilities.toSet(),
                servicePinCodes.toSet(),
                latitude,
                longitude,
                idempotencyKey,
                legacyFingerprint,
            )
        }
    }

    fun approveOutlet(admin: Principal, outletId: UUID, idempotencyKey: String): ProviderOutlet {
        Authorizer.requireAdminPermission(admin, AdminPermission.PROVIDER_REVIEW)
        validateIdempotencyKey(idempotencyKey)
        return persistence.approve(
            admin.actorId,
            outletId,
            idempotencyKey,
            fingerprint("${admin.actorId}:$outletId:APPROVE"),
        )
    }

    fun configureDispatchOrigin(
        merchant: Principal,
        outletId: UUID,
        latitude: Double,
        longitude: Double,
    ): ProviderOutlet {
        Authorizer.requireMerchantPermission(merchant, outletId, MerchantPermission.OUTLET_MANAGE)
        val outlet = getOutlet(outletId)
        if (
            merchant.organizationId == null ||
            outlet.organizationId != merchant.organizationId ||
            outlet.status == ProviderStatus.SUSPENDED ||
            outlet.status == ProviderStatus.REJECTED
        ) resourceUnavailable()
        validateCoordinates(latitude, longitude)
        return persistence.updateDispatchOrigin(outletId, latitude, longitude)
    }

    /**
     * Canonical gate for Merchant commands that require an ACTIVE outlet.
     * Membership, permission and organization are all derived from the reauthorized principal;
     * request-supplied outlet IDs are only targets to validate.
     */
    fun requireActiveOutlet(
        merchant: Principal,
        outletId: UUID,
        permission: MerchantPermission,
    ): ProviderOutlet {
        Authorizer.requireMerchantPermission(merchant, outletId, permission)
        val outlet = getOutlet(outletId)
        if (
            outlet.status != ProviderStatus.ACTIVE ||
            merchant.organizationId == null ||
            outlet.organizationId != merchant.organizationId
        ) resourceUnavailable()
        return outlet
    }

    fun allOutlets(): List<ProviderOutlet> = persistence.all()

    fun getOutlet(outletId: UUID): ProviderOutlet = persistence.get(outletId)
        ?: resourceUnavailable()

    private fun requireOrganizationOwner(merchant: Principal) {
        val isCurrentOwner = merchant.merchantPermissionsByOutlet.values.any { permissions ->
            MerchantPermission.OWNER in permissions
        }
        if (!isCurrentOwner) {
            throw DomainException(
                "MERCHANT_PERMISSION_REQUIRED",
                "The required merchant permission is missing",
            )
        }
    }

    private fun validateSubmission(
        name: String,
        capabilities: Set<ProviderCapability>,
        servicePinCodes: Set<String>,
        latitude: Double?,
        longitude: Double?,
    ) {
        if (name.isBlank() || name.length > 160 || capabilities.isEmpty()) {
            throw DomainException("PROVIDER_SUBMISSION_INVALID", "Provider details are invalid")
        }
        if (servicePinCodes.any { !it.matches(Regex("[1-9][0-9]{5}")) }) {
            throw DomainException("PIN_CODE_INVALID", "Service PIN codes must contain exactly six digits")
        }
        if ((latitude == null) != (longitude == null)) invalidCoordinates()
        if (latitude != null) validateCoordinates(latitude, requireNotNull(longitude))
    }

    private fun validateCoordinates(latitude: Double, longitude: Double) {
        if (latitude !in -90.0..90.0 || longitude !in -180.0..180.0) invalidCoordinates()
    }

    private fun validateIdempotencyKey(key: String) {
        if (!key.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) {
            throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
        }
    }

    private fun invalidCoordinates(): Nothing = throw DomainException(
        "OUTLET_COORDINATES_INVALID",
        "Outlet coordinates must be a valid latitude/longitude pair",
    )

    private fun resourceUnavailable(): Nothing = throw DomainException(
        "RESOURCE_NOT_FOUND",
        "The requested resource is unavailable",
    )

    private fun submissionFingerprint(
        actorId: UUID,
        organizationId: UUID?,
        name: String,
        capabilities: Set<ProviderCapability>,
        servicePinCodes: Set<String>,
        latitude: Double?,
        longitude: Double?,
    ): String = fingerprint(
        listOf(
            actorId,
            organizationId,
            name,
            capabilities.sorted(),
            servicePinCodes.sorted(),
            latitude,
            longitude,
        ).joinToString(":"),
    )

    private fun fingerprint(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}

private class InMemoryProviderPersistence : ProviderPersistence {
    private val outlets = mutableMapOf<UUID, ProviderOutlet>()
    private val merchantOrganizations = mutableMapOf<UUID, UUID>()
    private val submissionKeys = IdempotencyStore<ProviderOutlet>()
    private val approvalKeys = IdempotencyStore<ProviderOutlet>()

    @Synchronized
    override fun submit(
        merchant: Principal,
        name: String,
        capabilities: Set<ProviderCapability>,
        servicePinCodes: Set<String>,
        latitude: Double?,
        longitude: Double?,
        idempotencyKey: String,
        requestFingerprint: String,
    ): ProviderOutlet = submissionKeys.execute(
        "provider-submit:${merchant.actorId}",
        idempotencyKey,
        requestFingerprint,
    ) {
        if (merchant.organizationId == null && merchant.actorId in merchantOrganizations) {
            throw DomainException(
                "MERCHANT_PERMISSION_REQUIRED",
                "The required merchant permission is missing",
            )
        }
        val organizationId = merchant.organizationId
            ?: UUID.randomUUID().also { merchantOrganizations[merchant.actorId] = it }
        ProviderOutlet(
            id = UUID.randomUUID(),
            organizationId = organizationId,
            ownerActorId = merchant.actorId,
            name = name,
            capabilities = capabilities,
            servicePinCodes = servicePinCodes,
            status = ProviderStatus.UNDER_REVIEW,
            pickupEnabled = ProviderCapability.PRODUCT_STORE in capabilities,
            latitude = latitude,
            longitude = longitude,
        ).also { outlets[it.id] = it }
    }

    @Synchronized
    override fun approve(
        adminActorId: UUID,
        outletId: UUID,
        idempotencyKey: String,
        requestFingerprint: String,
    ): ProviderOutlet = approvalKeys.execute("provider-approve:$outletId", idempotencyKey, requestFingerprint) {
        val outlet = outlets[outletId]
            ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        if (outlet.status != ProviderStatus.UNDER_REVIEW) {
            throw DomainException("PROVIDER_STATE_INVALID", "The provider cannot be approved from its current state")
        }
        outlet.copy(status = ProviderStatus.ACTIVE).also { outlets[outletId] = it }
    }

    @Synchronized
    override fun updateDispatchOrigin(outletId: UUID, latitude: Double, longitude: Double): ProviderOutlet {
        val outlet = outlets[outletId]
            ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        return outlet.copy(latitude = latitude, longitude = longitude).also { outlets[outletId] = it }
    }

    @Synchronized
    override fun all(): List<ProviderOutlet> = outlets.values.toList()

    @Synchronized
    override fun get(outletId: UUID): ProviderOutlet? = outlets[outletId]
}
