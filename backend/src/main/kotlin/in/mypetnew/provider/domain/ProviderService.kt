package `in`.mypetnew.provider.domain

import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.idempotency.IdempotencyStore
import java.util.UUID

data class ProviderOutlet(
    val id: UUID,
    val organizationId: UUID,
    val ownerActorId: UUID,
    val name: String,
    val capabilities: Set<ProviderCapability>,
    val servicePinCodes: Set<String>,
    val status: ProviderStatus,
)

class ProviderService {
    private val outlets = mutableMapOf<UUID, ProviderOutlet>()
    private val merchantOrganizations = mutableMapOf<UUID, UUID>()
    private val submissionKeys = IdempotencyStore<ProviderOutlet>()
    private val approvalKeys = IdempotencyStore<ProviderOutlet>()

    @Synchronized
    fun submitOutlet(
        merchant: Principal,
        name: String,
        capabilities: Set<ProviderCapability>,
        servicePinCodes: Set<String>,
        idempotencyKey: String,
    ): ProviderOutlet {
        Authorizer.requireRole(merchant, Role.MERCHANT)
        val fingerprint = listOf(merchant.actorId, name, capabilities.sorted(), servicePinCodes.sorted()).joinToString(":")
        return submissionKeys.execute("provider-submit:${merchant.actorId}", idempotencyKey, fingerprint) {
            if (name.isBlank() || name.length > 160 || capabilities.isEmpty()) {
                throw DomainException("PROVIDER_SUBMISSION_INVALID", "Provider details are invalid")
            }
            if (servicePinCodes.any { !it.matches(Regex("[1-9][0-9]{5}")) }) {
                throw DomainException("PIN_CODE_INVALID", "Service PIN codes must contain exactly six digits")
            }
            val organizationId = merchant.organizationId
                ?: merchantOrganizations.getOrPut(merchant.actorId) { UUID.randomUUID() }
            ProviderOutlet(
                id = UUID.randomUUID(),
                organizationId = organizationId,
                ownerActorId = merchant.actorId,
                name = name.trim(),
                capabilities = capabilities.toSet(),
                servicePinCodes = servicePinCodes.toSet(),
                status = ProviderStatus.UNDER_REVIEW,
            ).also { outlets[it.id] = it }
        }
    }

    @Synchronized
    fun approveOutlet(admin: Principal, outletId: UUID, idempotencyKey: String): ProviderOutlet {
        Authorizer.requireAdminPermission(admin, AdminPermission.PROVIDER_REVIEW)
        return approvalKeys.execute("provider-approve:$outletId", idempotencyKey, outletId.toString()) {
            val outlet = outlets[outletId]
                ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
            if (outlet.status != ProviderStatus.UNDER_REVIEW) {
                throw DomainException("PROVIDER_STATE_INVALID", "The provider cannot be approved from its current state")
            }
            outlet.copy(status = ProviderStatus.ACTIVE).also { outlets[outletId] = it }
        }
    }

    @Synchronized
    fun allOutlets(): List<ProviderOutlet> = outlets.values.toList()
}

