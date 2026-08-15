package `in`.mypetnew.provider.domain

import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Authorizer
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
        val normalizedName = name.trim()
        val fingerprint = fingerprint(
            listOf(
                merchant.actorId,
                merchant.organizationId,
                normalizedName,
                capabilities.sorted(),
                servicePinCodes.sorted(),
                latitude,
                longitude,
            ).joinToString(":"),
        )
        return persistence.submit(
            merchant,
            normalizedName,
            capabilities.toSet(),
            servicePinCodes.toSet(),
            latitude,
            longitude,
            idempotencyKey,
            fingerprint,
        )
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

    fun allOutlets(): List<ProviderOutlet> = persistence.all()

    fun getOutlet(outletId: UUID): ProviderOutlet = persistence.get(outletId)
        ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")

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
        if (latitude != null && (latitude !in -90.0..90.0 || longitude!! !in -180.0..180.0)) {
            invalidCoordinates()
        }
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
        val organizationId = merchant.organizationId
            ?: merchantOrganizations.getOrPut(merchant.actorId) { UUID.randomUUID() }
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
    override fun all(): List<ProviderOutlet> = outlets.values.toList()

    @Synchronized
    override fun get(outletId: UUID): ProviderOutlet? = outlets[outletId]
}
