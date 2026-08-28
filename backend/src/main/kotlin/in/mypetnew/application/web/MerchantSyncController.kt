package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.MerchantSyncBootstrapResponse
import `in`.mypetnew.catalog.domain.MerchantSyncChangePage
import `in`.mypetnew.catalog.domain.MerchantSyncFeedService
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderOutlet
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
@RequestMapping("/api/v1/merchant/sync")
class MerchantSyncController(
    private val providers: ProviderService,
    private val feedService: MerchantSyncFeedService,
) {

    @GetMapping("/changes")
    fun changes(
        authentication: Authentication,
        @RequestParam outletId: UUID,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(defaultValue = "100") limit: Int,
    ): MerchantSyncChangePage {
        val principal = authentication.domainPrincipal()
        Authorizer.requireRole(principal, Role.MERCHANT)
        val outlet = requireOutletAccess(principal, outletId)
        return feedService.fetchChanges(outlet.organizationId, outlet.id, cursor, limit)
    }

    @GetMapping("/bootstrap")
    fun bootstrap(
        authentication: Authentication,
        @RequestParam outletId: UUID,
    ): MerchantSyncBootstrapResponse {
        val principal = authentication.domainPrincipal()
        Authorizer.requireRole(principal, Role.MERCHANT)
        val outlet = requireOutletAccess(principal, outletId)
        return feedService.fetchBootstrap(outlet.organizationId, outlet.id)
    }

    private fun requireOutletAccess(principal: Principal, outletId: UUID): ProviderOutlet {
        Authorizer.requireOutlet(principal, outletId)
        val outlet = providers.getOutlet(outletId)
        if (
            principal.organizationId == null ||
            outlet.organizationId != principal.organizationId ||
            outlet.status == ProviderStatus.SUSPENDED ||
            outlet.status == ProviderStatus.REJECTED
        ) {
            throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        }
        return outlet
    }
}
