package `in`.mypetnew.application.web

import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.identity.infrastructure.MerchantPrincipalResolver
import `in`.mypetnew.merchantops.domain.MerchantDashboard
import `in`.mypetnew.merchantops.domain.MerchantOperationsService
import `in`.mypetnew.merchantops.domain.MerchantNotificationPage
import `in`.mypetnew.merchantops.domain.MerchantOrderWorkPage
import `in`.mypetnew.merchantops.domain.MerchantStaffGrant
import `in`.mypetnew.merchantops.domain.MerchantStaffPage
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

data class StaffGrantRequest(
    val outletId: UUID,
    val accountId: UUID,
    val permission: MerchantPermission,
)

data class StaffRevokeRequest(val outletId: UUID)

@RestController
@RequestMapping("/api/v1/merchant")
class MerchantOperationsController(
    private val operations: MerchantOperationsService,
    private val merchantPrincipals: MerchantPrincipalResolver,
) {
    @GetMapping("/dashboard")
    fun dashboard(
        authentication: Authentication,
        @RequestParam(required = false) outletId: UUID?,
    ): MerchantDashboard = operations.dashboard(current(authentication), outletId)

    @GetMapping("/staff")
    fun listStaff(
        authentication: Authentication,
        @RequestParam outletId: UUID,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "50") pageSize: Int,
    ): MerchantStaffPage = operations.listStaff(current(authentication), outletId, page, pageSize)

    @GetMapping("/order-work")
    fun orderWork(
        authentication: Authentication,
        @RequestParam(required = false) outletId: UUID?,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "25") pageSize: Int,
    ): MerchantOrderWorkPage = operations.orderWork(current(authentication), outletId, page, pageSize)

    @GetMapping("/notifications")
    fun notifications(
        authentication: Authentication,
        @RequestParam(required = false) outletId: UUID?,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "50") pageSize: Int,
    ): MerchantNotificationPage = operations.notifications(current(authentication), outletId, page, pageSize)

    @PostMapping("/staff/grants")
    fun grantStaff(
        authentication: Authentication,
        @RequestBody request: StaffGrantRequest,
    ): MerchantStaffGrant = operations.grantStaff(
        current(authentication),
        request.outletId,
        request.accountId,
        request.permission,
    )

    @DeleteMapping("/staff/{accountId}/permissions/{permission}")
    fun revokeStaff(
        authentication: Authentication,
        @PathVariable accountId: UUID,
        @PathVariable permission: MerchantPermission,
        @RequestBody request: StaffRevokeRequest,
    ): MerchantStaffGrant = operations.revokeStaff(
        current(authentication),
        request.outletId,
        accountId,
        permission,
    )

    private fun current(authentication: Authentication) =
        merchantPrincipals.reauthorize(authentication.domainPrincipal())
}
