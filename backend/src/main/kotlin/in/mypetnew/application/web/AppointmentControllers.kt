package `in`.mypetnew.application.web

import `in`.mypetnew.appointment.domain.AppointmentPaymentMethod
import `in`.mypetnew.appointment.domain.AppointmentPaymentStatus
import `in`.mypetnew.appointment.domain.AppointmentService
import `in`.mypetnew.appointment.domain.AppointmentStatus
import `in`.mypetnew.appointment.domain.CustomerAppointment
import `in`.mypetnew.appointment.domain.ServiceCapability
import `in`.mypetnew.appointment.domain.ServiceOffering
import `in`.mypetnew.appointment.domain.ServiceSlot
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.engagement.domain.NotificationService
import `in`.mypetnew.engagement.domain.SafeRoute
import `in`.mypetnew.merchantops.infrastructure.MerchantNotificationRecipientQuery
import `in`.mypetnew.provider.domain.ProviderService
import org.springframework.http.HttpStatus
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.UUID

data class PublicServiceResponse(
    val serviceId: UUID,
    val outletId: UUID,
    val capability: ServiceCapability,
    val name: String,
    val description: String?,
    val durationMinutes: Int,
    val pricePaise: Long,
    val currency: String = "INR",
)

data class PublicServiceSlotResponse(
    val slotId: UUID,
    val serviceId: UUID,
    val startsAt: Instant,
    val endsAt: Instant,
)

data class MerchantServiceRequest(
    val outletId: UUID,
    val capability: ServiceCapability,
    val name: String,
    val description: String? = null,
    val durationMinutes: Int,
    val pricePaise: Long,
)

data class MerchantServiceSlotRequest(val startsAt: Instant)
data class MerchantAppointmentStatusRequest(val outletId: UUID, val status: AppointmentStatus)

data class CustomerAppointmentCreateRequest(
    val outletId: UUID,
    val serviceId: UUID,
    val petId: UUID,
    val slotId: UUID,
    val slotStartsAt: Instant,
    val slotEndsAt: Instant,
    val pincode: String,
    val paymentMethod: AppointmentPaymentMethod? = null,
    val notes: String? = null,
)

data class CustomerAppointmentCancelRequest(val reason: String? = null)

data class CustomerAppointmentResponse(
    val appointmentId: UUID,
    val outletId: UUID,
    val providerId: UUID,
    val serviceId: UUID,
    val offeringId: UUID,
    val slotId: UUID,
    val petId: UUID,
    val providerName: String,
    val serviceName: String,
    val petName: String,
    val startsAt: Instant,
    val endsAt: Instant,
    val status: AppointmentStatus,
    val paymentMethod: AppointmentPaymentMethod,
    val paymentStatus: AppointmentPaymentStatus,
    val pricePaise: Long,
    val currency: String = "INR",
    val notes: String?,
    val holdExpiresAt: Instant?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

@RestController
@RequestMapping("/api/v1/public/services")
class PublicServiceApiController(private val appointments: AppointmentService) {
    @GetMapping
    fun list(
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") pageSize: Int,
        @RequestParam(required = false) capability: ServiceCapability?,
        @RequestParam(required = false) outletId: UUID?,
    ): PageResponse<PublicServiceResponse> = PaginationHelper.paginate(
        appointments.listServices(capability, outletId).map(::publicService),
        page,
        pageSize,
    )

    @GetMapping("/{serviceId}/availability")
    fun availability(
        @PathVariable serviceId: UUID,
        @RequestParam from: Instant,
        @RequestParam to: Instant,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "50") pageSize: Int,
    ): PageResponse<PublicServiceSlotResponse> = PaginationHelper.paginate(
        appointments.availability(serviceId, from, to).map(::publicSlot),
        page,
        pageSize,
    )
}

@RestController
@RequestMapping("/api/v1/merchant/services")
class MerchantServiceApiController(private val appointments: AppointmentService) {
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(authentication: Authentication, @RequestBody request: MerchantServiceRequest): PublicServiceResponse {
        val principal = merchant(authentication)
        return publicService(
            appointments.createOffering(
                principal,
                request.outletId,
                request.capability,
                request.name,
                request.description,
                request.durationMinutes,
                request.pricePaise,
            ),
        )
    }

    @PostMapping("/{serviceId}/slots")
    @ResponseStatus(HttpStatus.CREATED)
    fun createSlot(
        authentication: Authentication,
        @PathVariable serviceId: UUID,
        @RequestBody request: MerchantServiceSlotRequest,
    ): PublicServiceSlotResponse = publicSlot(
        appointments.createSlot(merchant(authentication), serviceId, request.startsAt),
    )
}

@RestController
@RequestMapping("/api/v1/merchant/appointments")
class MerchantAppointmentApiController(
    private val providers: ProviderService,
    private val appointments: AppointmentService,
    private val notifications: NotificationService,
) {
    @PostMapping("/{appointmentId}/status")
    fun transition(
        authentication: Authentication,
        @PathVariable appointmentId: UUID,
        @RequestBody request: MerchantAppointmentStatusRequest,
    ): CustomerAppointmentResponse {
        val principal = merchant(authentication)
        // Defense in depth: request-supplied outlet IDs are targets only. The
        // authenticated merchant must still hold fulfilment authority for an
        // ACTIVE outlet in the same server-owned organization.
        providers.requireActiveOutlet(principal, request.outletId, MerchantPermission.ORDER_FULFIL)
        val appointment = appointments.merchantTransition(principal, request.outletId, appointmentId, request.status)
        notifyCustomer(appointment)
        return appointmentResponse(appointment)
    }

    private fun notifyCustomer(appointment: CustomerAppointment) {
        val template = when (appointment.status) {
            AppointmentStatus.CONFIRMED ->
                Triple("customer-appointment-confirmed-v1", "Appointment confirmed", "The provider confirmed your booking request.")
            AppointmentStatus.REJECTED ->
                Triple("customer-appointment-declined-v1", "Appointment update", "The provider could not accept your booking request. Open MyPet for details.")
            else -> null
        } ?: return
        runCatching {
            notifications.enqueue(
                sourceEventId = appointment.id,
                recipientId = appointment.customerId,
                templateVersion = template.first,
                title = template.second,
                body = template.third,
                route = SafeRoute.CUSTOMER_APPOINTMENT,
                resourceId = appointment.id,
            )
        }
    }
}

@RestController
@RequestMapping("/api/v1/customer/appointments")
class CustomerAppointmentApiController(
    private val appointments: AppointmentService,
    private val notifications: NotificationService,
    private val merchantRecipients: MerchantNotificationRecipientQuery,
) {
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun hold(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody request: CustomerAppointmentCreateRequest,
    ): CustomerAppointmentResponse = appointmentResponse(
        appointments.hold(
            customer = customer(authentication),
            outletId = request.outletId,
            serviceId = request.serviceId,
            petId = request.petId,
            slotId = request.slotId,
            paymentMethod = request.paymentMethod ?: AppointmentPaymentMethod.PAY_AT_PROVIDER,
            notes = request.notes,
            idempotencyKey = idempotencyKey,
            servicePincode = request.pincode,
            expectedSlotStartsAt = request.slotStartsAt,
            expectedSlotEndsAt = request.slotEndsAt,
        ),
    )

    @PostMapping("/{appointmentId}/confirm")
    fun confirm(authentication: Authentication, @PathVariable appointmentId: UUID): CustomerAppointmentResponse {
        val appointment = appointments.confirm(customer(authentication), appointmentId)
        notifyMerchant(appointment, cancelled = false)
        return appointmentResponse(appointment)
    }

    @PostMapping("/{appointmentId}/cancel")
    fun cancel(
        authentication: Authentication,
        @PathVariable appointmentId: UUID,
        @RequestBody(required = false) request: CustomerAppointmentCancelRequest?,
    ): CustomerAppointmentResponse {
        val principal = customer(authentication)
        val before = appointments.get(principal, appointmentId)
        val appointment = appointments.cancel(principal, appointmentId, request?.reason)
        if (before.status in setOf(AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED)) {
            notifyMerchant(appointment, cancelled = true)
        }
        return appointmentResponse(appointment)
    }

    private fun notifyMerchant(appointment: CustomerAppointment, cancelled: Boolean) {
        val recipients = merchantRecipients.appointmentRecipients(appointment.organizationId, appointment.outletId)
        val template = if (cancelled) {
            Triple(
                "merchant-appointment-cancelled-v1",
                "Appointment cancelled",
                "A customer cancelled an appointment. Open MyPet Merchant for details.",
            )
        } else {
            Triple(
                "merchant-appointment-booked-v1",
                "New appointment request",
                "Open MyPet Merchant to review a new appointment request.",
            )
        }
        recipients.forEach { recipientId ->
            runCatching {
                notifications.enqueue(
                    sourceEventId = appointment.id,
                    recipientId = recipientId,
                    templateVersion = template.first,
                    title = template.second,
                    body = template.third,
                    route = SafeRoute.MERCHANT_APPOINTMENT,
                    resourceId = appointment.id,
                )
            }
        }
    }

    @GetMapping("/{appointmentId}")
    fun get(authentication: Authentication, @PathVariable appointmentId: UUID): CustomerAppointmentResponse =
        appointmentResponse(appointments.get(customer(authentication), appointmentId))

    @GetMapping
    fun list(
        authentication: Authentication,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") pageSize: Int,
    ): PageResponse<CustomerAppointmentResponse> {
        val result = appointments.list(customer(authentication), page, pageSize)
        return PageResponse(result.items.map(::appointmentResponse), page, pageSize, result.hasNext)
    }
}

private fun publicService(offering: ServiceOffering) = PublicServiceResponse(
    serviceId = offering.id,
    outletId = offering.outletId,
    capability = offering.capability,
    name = offering.name,
    description = offering.description,
    durationMinutes = offering.durationMinutes,
    pricePaise = offering.pricePaise,
)

private fun publicSlot(slot: ServiceSlot) = PublicServiceSlotResponse(
    slotId = slot.id,
    serviceId = slot.serviceId,
    startsAt = slot.startsAt,
    endsAt = slot.endsAt,
)

private fun appointmentResponse(appointment: CustomerAppointment) = CustomerAppointmentResponse(
    appointmentId = appointment.id,
    outletId = appointment.outletId,
    providerId = appointment.outletId,
    serviceId = appointment.serviceId,
    offeringId = appointment.serviceId,
    slotId = appointment.slotId,
    petId = appointment.petId,
    providerName = appointment.outletName,
    serviceName = appointment.serviceName,
    petName = appointment.petName,
    startsAt = appointment.startsAt,
    endsAt = appointment.endsAt,
    status = appointment.status,
    paymentMethod = appointment.paymentMethod,
    paymentStatus = appointment.paymentStatus,
    pricePaise = appointment.pricePaise,
    notes = appointment.notes,
    holdExpiresAt = appointment.holdExpiresAt,
    createdAt = appointment.createdAt,
    updatedAt = appointment.updatedAt,
)

private fun customer(authentication: Authentication): Principal = authentication.domainPrincipal().also {
    Authorizer.requireRole(it, Role.CUSTOMER)
}

private fun merchant(authentication: Authentication): Principal = authentication.domainPrincipal().also {
    Authorizer.requireRole(it, Role.MERCHANT)
}
