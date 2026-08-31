package `in`.mypetnew.application.web

import `in`.mypetnew.adminops.domain.AdminOperationPurpose
import `in`.mypetnew.adminops.domain.AdminOperationsService
import org.slf4j.MDC
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
@RequestMapping("/api/v1/admin/organizations/{organizationId}/outlets/{outletId}")
class AdminOperationsController(
    private val operations: AdminOperationsService,
) {
    @GetMapping("/inventory")
    fun inventory(
        authentication: Authentication,
        @PathVariable organizationId: UUID,
        @PathVariable outletId: UUID,
        @RequestHeader("X-Admin-Purpose") purpose: AdminOperationPurpose,
        @RequestHeader("X-Admin-Reason") reason: String,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "50") pageSize: Int,
    ) = operations.inventory(
        admin = authentication.domainPrincipal(),
        organizationId = organizationId,
        outletId = outletId,
        purpose = purpose,
        reason = reason,
        page = page,
        pageSize = pageSize,
        traceId = currentAdminTraceId(),
    )

    @GetMapping("/audit")
    fun auditTrail(
        authentication: Authentication,
        @PathVariable organizationId: UUID,
        @PathVariable outletId: UUID,
        @RequestHeader("X-Admin-Purpose") purpose: AdminOperationPurpose,
        @RequestHeader("X-Admin-Reason") reason: String,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "50") pageSize: Int,
    ) = operations.auditTrail(
        admin = authentication.domainPrincipal(),
        organizationId = organizationId,
        outletId = outletId,
        purpose = purpose,
        reason = reason,
        page = page,
        pageSize = pageSize,
        traceId = currentAdminTraceId(),
    )
}

internal fun currentAdminTraceId(): String =
    (MDC.get("traceId") ?: MDC.get("trace_id") ?: "admin-control-plane").take(64)
