package `in`.mypetnew.application.web

import `in`.mypetnew.appointment.domain.AppointmentPaymentMethod
import `in`.mypetnew.appointment.domain.AppointmentPaymentStatus
import `in`.mypetnew.appointment.domain.AppointmentStatus
import `in`.mypetnew.appointment.infrastructure.MerchantAppointmentQuery
import `in`.mypetnew.appointment.infrastructure.MerchantAppointmentRequestView
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.UUID

data class MerchantAppointmentInboxResponse(
    val appointmentId: UUID,
    val outletId: UUID,
    val serviceId: UUID,
    val slotId: UUID,
    val petName: String,
    val serviceName: String,
    val startsAt: Instant,
    val endsAt: Instant,
    val status: AppointmentStatus,
    val paymentMethod: AppointmentPaymentMethod,
    val paymentStatus: AppointmentPaymentStatus,
    val pricePaise: Long,
    val currency: String = "INR",
    val notes: String?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

@RestController
class MerchantAppointmentInboxController(
    private val query: MerchantAppointmentQuery,
) {
    @GetMapping("/api/v1/merchant/appointments")
    fun list(
        authentication: Authentication,
        @RequestParam(required = false) status: AppointmentStatus?,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") pageSize: Int,
    ): PageResponse<MerchantAppointmentInboxResponse> {
        val result = query.list(merchantPrincipal(authentication), status, page, pageSize)
        return PageResponse(result.items.map(::response), page, pageSize, result.hasNext)
    }

    private fun merchantPrincipal(authentication: Authentication): Principal = authentication.domainPrincipal().also {
        Authorizer.requireRole(it, Role.MERCHANT)
    }

    private fun response(request: MerchantAppointmentRequestView) = MerchantAppointmentInboxResponse(
        appointmentId = request.appointmentId,
        outletId = request.outletId,
        serviceId = request.serviceId,
        slotId = request.slotId,
        petName = request.petName,
        serviceName = request.serviceName,
        startsAt = request.startsAt,
        endsAt = request.endsAt,
        status = request.status,
        paymentMethod = request.paymentMethod,
        paymentStatus = request.paymentStatus,
        pricePaise = request.pricePaise,
        notes = request.notes,
        createdAt = request.createdAt,
        updatedAt = request.updatedAt,
    )
}
