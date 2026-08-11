package `in`.mypetnew.provider

import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.util.UUID

class ProviderContractTest {
    @Test
    fun `provider approval needs scoped admin and is idempotent`() {
        val service = ProviderService()
        val merchant = Principal(UUID.randomUUID(), Role.MERCHANT)
        val outlet = service.submitOutlet(
            merchant,
            "Happy Pets Tirupati",
            setOf(ProviderCapability.PRODUCT_STORE),
            setOf("517501", "517501"),
            "submit-1",
        )
        val weakAdmin = Principal(UUID.randomUUID(), Role.ADMIN)
        assertThrows(DomainException::class.java) { service.approveOutlet(weakAdmin, outlet.id, "approve-1") }

        val reviewer = weakAdmin.copy(permissions = setOf(AdminPermission.PROVIDER_REVIEW))
        val active = service.approveOutlet(reviewer, outlet.id, "approve-1")
        val replay = service.approveOutlet(reviewer, outlet.id, "approve-1")

        assertEquals(ProviderStatus.ACTIVE, active.status)
        assertEquals(active, replay)
        assertEquals(setOf("517501"), active.servicePinCodes)
    }

    @Test
    fun `invalid Indian PIN codes fail without partial outlet`() {
        val service = ProviderService()
        val merchant = Principal(UUID.randomUUID(), Role.MERCHANT)

        listOf("51750", "5175010", "ABC501", " 517501", "51;501").forEachIndexed { index, pin ->
            assertThrows(DomainException::class.java) {
                service.submitOutlet(
                    merchant,
                    "Outlet $index",
                    setOf(ProviderCapability.PRODUCT_STORE),
                    setOf(pin),
                    "submit-$index",
                )
            }
        }
        assertEquals(0, service.allOutlets().size)
    }
}

