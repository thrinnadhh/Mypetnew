package `in`.mypetnew.application.web

import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.delivery.domain.DispatchService
import `in`.mypetnew.delivery.domain.DispatchStatus
import `in`.mypetnew.provider.domain.ProviderService
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.UUID

data class MerchantDeliveryHandoffResponse(
    val orderId: UUID,
    val jobId: UUID,
    val status: String,
    val assignedCaptainId: UUID?,
    val assignedAt: Instant?,
    val pickupPin: String?,
)

/**
 * Merchant-side handoff projection for a Captain-delivery order.
 *
 * The pickup proof is disclosed only to an authorized Merchant for the owning outlet and only
 * while the assigned Captain is waiting to collect the parcel. It is redacted before assignment
 * and immediately after pickup so Customer/Captain/public projections never become a proof-secret
 * distribution channel.
 */
@RestController
@RequestMapping("/api/v1/merchant/orders")
class MerchantDeliveryHandoffApiController(
    private val providers: ProviderService,
    private val orders: OrderService,
    private val dispatch: DispatchService,
) {
    @GetMapping("/{orderId}/delivery-handoff")
    fun handoff(
        authentication: Authentication,
        @PathVariable orderId: UUID,
    ): MerchantDeliveryHandoffResponse {
        val principal = authentication.domainPrincipal()
        val order = orders.get(orderId)
        Authorizer.requireOutlet(principal, order.outletId)
        providers.requireActiveOutlet(principal, order.outletId, MerchantPermission.ORDER_FULFIL)
        if (order.fulfilmentMode != DispatchService.DELIVERY_MODE) handoffUnavailable()

        val job = dispatch.tracking(order.id) ?: handoffUnavailable()
        val mayRevealPickupProof =
            job.status == DispatchStatus.ASSIGNED && job.assignedCaptainId != null

        return MerchantDeliveryHandoffResponse(
            orderId = order.id,
            jobId = job.id,
            status = job.status.name,
            assignedCaptainId = job.assignedCaptainId,
            assignedAt = job.assignedAt,
            pickupPin = job.pickupPin.takeIf { mayRevealPickupProof },
        )
    }
}

private fun handoffUnavailable(): Nothing = throw DomainException(
    "RESOURCE_NOT_FOUND",
    "The requested resource is unavailable",
)
