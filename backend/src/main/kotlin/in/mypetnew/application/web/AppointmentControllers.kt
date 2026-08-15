package `in`.mypetnew.application.web

import `in`.mypetnew.appointment.domain.Appointment
import `in`.mypetnew.appointment.domain.AppointmentService
import `in`.mypetnew.appointment.domain.ServiceOffering
import `in`.mypetnew.appointment.domain.ServiceSlot
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

data class ServiceOfferingResponse(
    val offeringId: UUID,
    val providerId: UUID,
    val name: String,
    val description: String?,
    val price: BigDecimal,
    val status: String,
    val durationMinutes: Int,
    val stockQuantity: Int? = null,
)

data class ServiceSlotResponse(
    val slotId: UUID,
    val offeringId: UUID,
    val slotStart: Instant,
    val slotEnd: Instant,
    val status: String = "AVAILABLE",
)

data class CreateServiceOfferingRequest(
    val outletId: UUID,
    val name: String,
    val description: String? = null,
    val pricePaise: Long,
    val durationMinutes: Int,
)

data class CreateServiceSlotRequest(
    val slotStart: Instant,
    val slotEnd: Instant,
)

@RestController
class ServiceCatalogApiController(
    private val appointments: AppointmentService,
    private val providers: ProviderService,
) {
    @GetMapping("/api/v1/catalog/offerings")
    fun offerings(@RequestParam providerId: UUID): List<ServiceOfferingResponse> {
        val outlet = providers.getOutlet(providerId)
        requireBookableOutlet(outlet.status, outlet.capabilities)
        return appointments.listOfferings(providerId).map(::offeringResponse)
    }

    @GetMapping("/api/v1/catalog/slots")
    fun slots(@RequestParam offeringId: UUID): List<ServiceSlotResponse> =
        appointments.listAvailableSlots(offeringId).map(::slotResponse)

    @PostMapping("/api/v1/merchant/service-offerings")
    fun createOffering(
        authentication: Authentication,
        @RequestBody request: CreateServiceOfferingRequest,
    ): ServiceOfferingResponse {
        val principal = authentication.domainPrincipal()
        Authorizer.requireOutlet(principal, request.outletId)
        val outlet = providers.getOutlet(request.outletId)
        requireBookableOutlet(outlet.status, outlet.capabilities)
        return offeringResponse(
            appointments.createOffering(
                outletId = outlet.id,
                name = request.name,
                description = request.description,
                pricePaise = request.pricePaise,
                durationMinutes = request.durationMinutes,
            ),
        )
    }

    @PostMapping("/api/v1/merchant/service-offerings/{offeringId}/slots")
    fun createSlot(
        authentication: Authentication,
        @PathVariable offeringId: UUID,
        @RequestBody request: CreateServiceSlotRequest,
    ): ServiceSlotResponse {
        val principal = authentication.domainPrincipal()
        Authorizer.requireRole(principal, Role.MERCHANT)
        val offering = appointments.getOffering(offeringId)
        Authorizer.requireOutlet(principal, offering.outletId)
        val outlet = providers.getOutlet(offering.outletId)
        requireBookableOutlet(outlet.status, outlet.capabilities)
        return slotResponse(appointments.createSlot(offeringId, request.slotStart, request.slotEnd))
    }

    private fun offeringResponse(offering: ServiceOffering) = ServiceOfferingResponse(
        offeringId = offering.id,
        providerId = offering.outletId,
        name = offering.name,
        description = offering.description,
        price = BigDecimal.valueOf(offering.pricePaise, 2),
        status = offering.status.name,
        durationMinutes = offering.durationMinutes,
    )

    private fun slotResponse(slot: ServiceSlot) = ServiceSlotResponse(
        slotId = slot.id,
        offeringId = slot.offeringId,
        slotStart = slot.slotStart,
        slotEnd = slot.slotEnd,
    )
}

data class HoldAppointmentRequest(
    val customerId: UUID? = null,
    val providerId: UUID,
    val offeringId: UUID,
    val slotId: UUID,
    val petId: UUID,
    val priceAmount: BigDecimal? = null,
    val payAtClinic: Boolean = true,
)

data class AppointmentResponse(
    val appointmentId: UUID,
    val providerId: UUID,
    val offeringId: UUID,
    val slotId: UUID,
    val petId: UUID,
    val pricePaise: Long,
    val status: String,
    val payAtClinic: Boolean,
    val holdExpiresAt: Instant?,
    val bookedAt: Instant?,
)

@RestController
@RequestMapping("/api/v1/appointments")
class AppointmentApiController(
    private val appointments: AppointmentService,
    private val providers: ProviderService,
    private val customerData: CustomerDataService,
) {
    @PostMapping("/hold")
    fun hold(
        authentication: Authentication,
        @RequestBody request: HoldAppointmentRequest,
    ): AppointmentResponse {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        customerData.getPet(customer.actorId, request.petId)
        val outlet = providers.getOutlet(request.providerId)
        requireBookableOutlet(outlet.status, outlet.capabilities)
        return appointments.hold(
            customerId = customer.actorId,
            providerId = request.providerId,
            offeringId = request.offeringId,
            slotId = request.slotId,
            petId = request.petId,
            payAtClinic = request.payAtClinic,
        ).toResponse()
    }

    @PostMapping("/{appointmentId}/confirm")
    fun confirm(
        authentication: Authentication,
        @PathVariable appointmentId: UUID,
        @RequestParam(required = false) paymentId: UUID?,
    ): AppointmentResponse {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        return appointments.confirm(customer.actorId, appointmentId, paymentId).toResponse()
    }

    @GetMapping
    fun list(authentication: Authentication): List<AppointmentResponse> {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        return appointments.list(customer.actorId).map { it.toResponse() }
    }

    @GetMapping("/{appointmentId}")
    fun get(
        authentication: Authentication,
        @PathVariable appointmentId: UUID,
    ): AppointmentResponse {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        return appointments.get(customer.actorId, appointmentId).toResponse()
    }
}

private fun Appointment.toResponse() = AppointmentResponse(
    appointmentId = id,
    providerId = providerId,
    offeringId = offeringId,
    slotId = slotId,
    petId = petId,
    pricePaise = pricePaise,
    status = status.name,
    payAtClinic = payAtClinic,
    holdExpiresAt = holdExpiresAt,
    bookedAt = bookedAt,
)

private fun requireBookableOutlet(status: ProviderStatus, capabilities: Set<ProviderCapability>) {
    if (
        status != ProviderStatus.ACTIVE ||
        capabilities.none {
            it == ProviderCapability.GROOMING ||
                it == ProviderCapability.VETERINARY_CLINIC ||
                it == ProviderCapability.VETERINARY_HOSPITAL
        }
    ) {
        throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
    }
}
