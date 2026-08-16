package `in`.mypetnew.application.web

import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.payment.domain.Payment
import `in`.mypetnew.payment.domain.PaymentService
import `in`.mypetnew.payment.infrastructure.JdbcAppointmentOnlinePaymentService
import org.springframework.beans.factory.ObjectProvider
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.UUID

data class CustomerPaymentInitiationRequest(
    val referenceType: String,
    val referenceId: UUID,
    val provider: String,
)

data class CustomerPaymentResponse(
    val paymentId: UUID,
    val referenceType: String,
    val referenceId: UUID,
    val provider: String,
    val providerOrderId: String,
    val status: String,
    val paymentSessionId: String?,
    val expiresAt: Instant,
    val amountPaise: Long,
    val currency: String,
    val refundStatus: String? = null,
)

@RestController
@RequestMapping("/api/v1/customer/payments")
class CustomerPaymentApiController(
    private val payments: PaymentService,
    private val appointmentPaymentProvider: ObjectProvider<JdbcAppointmentOnlinePaymentService>,
) {
    @PostMapping
    fun initiate(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody raw: Map<String, Any?>,
    ): CustomerPaymentResponse {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        val request = strictRequest(raw)
        val payment = if (request.referenceType == "APPOINTMENT") {
            val appointmentPayments = appointmentPaymentProvider.getIfAvailable()
                ?: throw DomainException("PAYMENT_PROVIDER_UNAVAILABLE", "Appointment online payment is unavailable in this environment")
            appointmentPayments.initiate(
                customer.actorId,
                request.referenceId,
                request.provider,
                idempotencyKey,
            )
        } else {
            payments.initiate(
                customer.actorId,
                request.referenceType,
                request.referenceId,
                request.provider,
                idempotencyKey,
            )
        }
        return payment.response()
    }

    @GetMapping("/{paymentId}")
    fun get(
        authentication: Authentication,
        @PathVariable paymentId: UUID,
    ): CustomerPaymentResponse {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        val appointmentPayment = appointmentPaymentProvider.getIfAvailable()?.getOwnedOrNull(paymentId, customer.actorId)
        return (appointmentPayment ?: payments.get(paymentId, customer.actorId)).response()
    }

    private fun strictRequest(raw: Map<String, Any?>): CustomerPaymentInitiationRequest {
        val required = setOf("referenceType", "referenceId", "provider")
        if (raw.keys != required) {
            throw DomainException("PAYMENT_REQUEST_INVALID", "The payment request contains unsupported fields")
        }
        val referenceType = raw["referenceType"] as? String ?: invalidRequest()
        val provider = raw["provider"] as? String ?: invalidRequest()
        val referenceId = (raw["referenceId"] as? String)?.let {
            runCatching { UUID.fromString(it) }.getOrNull()
        } ?: invalidRequest()
        return CustomerPaymentInitiationRequest(referenceType, referenceId, provider)
    }

    private fun invalidRequest(): Nothing =
        throw DomainException("PAYMENT_REQUEST_INVALID", "The payment request is invalid")

    private fun Payment.response(): CustomerPaymentResponse = CustomerPaymentResponse(
        paymentId = id,
        referenceType = referenceType.name,
        referenceId = referenceId,
        provider = provider.name,
        providerOrderId = providerOrderReference,
        status = status.name,
        paymentSessionId = providerSessionId,
        expiresAt = expiresAt,
        amountPaise = amountPaise,
        currency = currency,
        refundStatus = refundStatus?.name,
    )
}
