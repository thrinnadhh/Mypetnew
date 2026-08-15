package `in`.mypetnew.appointment.domain

import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.idempotency.IdempotencyStore
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

enum class ServiceCapability { GROOMING, VETERINARY }
enum class AppointmentStatus { HOLD, BOOKED, CONFIRMED, CHECKED_IN, IN_SERVICE, COMPLETED, HOLD_EXPIRED, REJECTED, CANCELLED, NO_SHOW }
enum class AppointmentPaymentMethod { PAY_AT_PROVIDER }
enum class AppointmentPaymentStatus { NOT_REQUIRED, PENDING }

data class ServiceOffering(
    val id: UUID,
    val organizationId: UUID,
    val outletId: UUID,
    val capability: ServiceCapability,
    val name: String,
    val description: String?,
    val durationMinutes: Int,
    val pricePaise: Long,
    val active: Boolean,
    val createdAt: Instant,
)

data class ServiceSlot(
    val id: UUID,
    val serviceId: UUID,
    val startsAt: Instant,
    val endsAt: Instant,
    val active: Boolean,
)

data class CustomerAppointment(
    val id: UUID,
    val customerId: UUID,
    val petId: UUID,
    val organizationId: UUID,
    val outletId: UUID,
    val serviceId: UUID,
    val slotId: UUID,
    val serviceName: String,
    val outletName: String,
    val petName: String,
    val startsAt: Instant,
    val endsAt: Instant,
    val status: AppointmentStatus,
    val paymentMethod: AppointmentPaymentMethod,
    val paymentStatus: AppointmentPaymentStatus,
    val pricePaise: Long,
    val notes: String?,
    val holdExpiresAt: Instant?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class AppointmentPage(val items: List<CustomerAppointment>, val hasNext: Boolean)

interface AppointmentPersistence {
    fun saveOffering(offering: ServiceOffering): ServiceOffering
    fun saveSlot(slot: ServiceSlot): ServiceSlot
    fun getOffering(serviceId: UUID): ServiceOffering?
    fun getSlot(slotId: UUID): ServiceSlot?
    fun listOfferings(capability: ServiceCapability?, outletId: UUID?): List<ServiceOffering>
    fun availableSlots(serviceId: UUID, from: Instant, to: Instant, now: Instant): List<ServiceSlot>
    fun hold(
        appointment: CustomerAppointment,
        idempotencyKey: String,
        requestFingerprint: String,
        now: Instant,
    ): CustomerAppointment
    fun confirm(customerId: UUID, appointmentId: UUID, now: Instant): CustomerAppointment?
    fun cancel(customerId: UUID, appointmentId: UUID, reason: String?, now: Instant): CustomerAppointment?
    fun get(customerId: UUID, appointmentId: UUID, now: Instant): CustomerAppointment?
    fun list(customerId: UUID, page: Int, pageSize: Int, now: Instant): AppointmentPage
}

class InMemoryAppointmentPersistence : AppointmentPersistence {
    private val offerings = mutableMapOf<UUID, ServiceOffering>()
    private val slots = mutableMapOf<UUID, ServiceSlot>()
    private val appointments = mutableMapOf<UUID, CustomerAppointment>()
    private val holds = IdempotencyStore<CustomerAppointment>()

    @Synchronized override fun saveOffering(offering: ServiceOffering) = offering.also { offerings[it.id] = it }
    @Synchronized override fun saveSlot(slot: ServiceSlot) = slot.also { slots[it.id] = it }
    @Synchronized override fun getOffering(serviceId: UUID) = offerings[serviceId]
    @Synchronized override fun getSlot(slotId: UUID) = slots[slotId]
    @Synchronized override fun listOfferings(capability: ServiceCapability?, outletId: UUID?) = offerings.values
        .filter { it.active && (capability == null || it.capability == capability) && (outletId == null || it.outletId == outletId) }
        .sortedWith(compareBy<ServiceOffering> { it.name.lowercase() }.thenBy { it.id.toString() })

    @Synchronized override fun availableSlots(serviceId: UUID, from: Instant, to: Instant, now: Instant): List<ServiceSlot> {
        expireHolds(now)
        val occupied = appointments.values.filter { it.status in OCCUPYING_STATUSES }.mapTo(mutableSetOf()) { it.slotId }
        return slots.values.filter { it.serviceId == serviceId && it.active && it.startsAt >= from && it.startsAt < to && it.startsAt > now && it.id !in occupied }
            .sortedBy { it.startsAt }
    }

    @Synchronized override fun hold(
        appointment: CustomerAppointment,
        idempotencyKey: String,
        requestFingerprint: String,
        now: Instant,
    ): CustomerAppointment = holds.execute("appointment:${appointment.customerId}", idempotencyKey, requestFingerprint) {
        expireHolds(now)
        if (appointments.values.any { it.slotId == appointment.slotId && it.status in OCCUPYING_STATUSES }) slotUnavailable()
        appointment.also { appointments[it.id] = it }
    }

    @Synchronized override fun confirm(customerId: UUID, appointmentId: UUID, now: Instant): CustomerAppointment? {
        expireHolds(now)
        val current = appointments[appointmentId]?.takeIf { it.customerId == customerId } ?: return null
        if (current.status == AppointmentStatus.BOOKED || current.status == AppointmentStatus.CONFIRMED) return current
        if (current.status != AppointmentStatus.HOLD) invalidState()
        if (current.holdExpiresAt == null || !current.holdExpiresAt.isAfter(now)) holdExpired()
        return current.copy(status = AppointmentStatus.BOOKED, holdExpiresAt = null, updatedAt = now)
            .also { appointments[appointmentId] = it }
    }

    @Synchronized override fun cancel(customerId: UUID, appointmentId: UUID, reason: String?, now: Instant): CustomerAppointment? {
        expireHolds(now)
        val current = appointments[appointmentId]?.takeIf { it.customerId == customerId } ?: return null
        if (current.status == AppointmentStatus.CANCELLED) return current
        if (current.status !in setOf(AppointmentStatus.HOLD, AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED)) invalidState()
        return current.copy(status = AppointmentStatus.CANCELLED, notes = reason?.trim()?.takeIf { it.isNotEmpty() } ?: current.notes, holdExpiresAt = null, updatedAt = now)
            .also { appointments[appointmentId] = it }
    }

    @Synchronized override fun get(customerId: UUID, appointmentId: UUID, now: Instant): CustomerAppointment? {
        expireHolds(now)
        return appointments[appointmentId]?.takeIf { it.customerId == customerId }
    }

    @Synchronized override fun list(customerId: UUID, page: Int, pageSize: Int, now: Instant): AppointmentPage {
        expireHolds(now)
        val values = appointments.values.filter { it.customerId == customerId }
            .sortedWith(compareByDescending<CustomerAppointment> { it.startsAt }.thenByDescending { it.id.toString() })
        val offset = page.toLong() * pageSize.toLong()
        if (offset >= values.size.toLong()) return AppointmentPage(emptyList(), false)
        val candidates = values.drop(offset.toInt()).take(pageSize + 1)
        return AppointmentPage(candidates.take(pageSize), candidates.size > pageSize)
    }

    private fun expireHolds(now: Instant) {
        appointments.replaceAll { _, value ->
            if (value.status == AppointmentStatus.HOLD && value.holdExpiresAt?.isAfter(now) == false) {
                value.copy(status = AppointmentStatus.HOLD_EXPIRED, updatedAt = now)
            } else value
        }
    }
}

class AppointmentService(
    private val persistence: AppointmentPersistence,
    private val providers: ProviderService,
    private val customerData: CustomerDataService,
    private val clock: Clock = Clock.systemUTC(),
    private val holdDuration: Duration = Duration.ofMinutes(10),
) {
    fun createOffering(
        merchant: Principal,
        outletId: UUID,
        capability: ServiceCapability,
        name: String,
        description: String?,
        durationMinutes: Int,
        pricePaise: Long,
    ): ServiceOffering {
        Authorizer.requireOutlet(merchant, outletId)
        val outlet = providers.getOutlet(outletId)
        if (outlet.status != ProviderStatus.ACTIVE || !supports(outlet.capabilities, capability)) unavailable()
        val cleanName = name.trim()
        val cleanDescription = description?.trim()?.takeIf { it.isNotEmpty() }
        if (cleanName.length !in 2..160 || (cleanDescription != null && cleanDescription.length > 1_000) || durationMinutes !in 5..480 || pricePaise !in 0..10_000_000) invalidService()
        return persistence.saveOffering(
            ServiceOffering(UUID.randomUUID(), outlet.organizationId, outletId, capability, cleanName, cleanDescription, durationMinutes, pricePaise, true, clock.instant()),
        )
    }

    fun createSlot(merchant: Principal, serviceId: UUID, startsAt: Instant): ServiceSlot {
        val offering = activeOffering(serviceId)
        Authorizer.requireOutlet(merchant, offering.outletId)
        val now = clock.instant()
        if (!startsAt.isAfter(now)) invalidSlot()
        return persistence.saveSlot(ServiceSlot(UUID.randomUUID(), serviceId, startsAt, startsAt.plusSeconds(offering.durationMinutes * 60L), true))
    }

    fun listServices(capability: ServiceCapability?, outletId: UUID?): List<ServiceOffering> =
        persistence.listOfferings(capability, outletId).filter { offering ->
            providers.allOutlets().any { outlet -> outlet.id == offering.outletId && outlet.status == ProviderStatus.ACTIVE && supports(outlet.capabilities, offering.capability) }
        }

    fun availability(serviceId: UUID, from: Instant, to: Instant): List<ServiceSlot> {
        activeOffering(serviceId)
        if (!to.isAfter(from) || Duration.between(from, to) > Duration.ofDays(31)) invalidSlot()
        return persistence.availableSlots(serviceId, from, to, clock.instant())
    }

    fun hold(
        customer: Principal,
        outletId: UUID,
        serviceId: UUID,
        petId: UUID,
        slotId: UUID,
        paymentMethod: AppointmentPaymentMethod,
        notes: String?,
        idempotencyKey: String,
    ): CustomerAppointment {
        Authorizer.requireRole(customer, Role.CUSTOMER)
        validateIdempotencyKey(idempotencyKey)
        val offering = activeOffering(serviceId)
        if (offering.outletId != outletId) unavailable()
        val slot = persistence.getSlot(slotId)?.takeIf { it.serviceId == serviceId && it.active } ?: unavailable()
        val now = clock.instant()
        if (!slot.startsAt.isAfter(now)) slotUnavailable()
        val pet = customerData.getPet(customer.actorId, petId)
        val outlet = providers.getOutlet(outletId).takeIf { it.status == ProviderStatus.ACTIVE } ?: unavailable()
        val cleanNotes = notes?.trim()?.takeIf { it.isNotEmpty() }
        if (cleanNotes != null && cleanNotes.length > 1_000) invalidAppointment()
        val appointment = CustomerAppointment(
            UUID.randomUUID(), customer.actorId, petId, offering.organizationId, outletId, serviceId, slotId,
            offering.name, outlet.name, pet.name, slot.startsAt, slot.endsAt, AppointmentStatus.HOLD,
            paymentMethod, AppointmentPaymentStatus.NOT_REQUIRED, offering.pricePaise, cleanNotes,
            now.plus(holdDuration), now, now,
        )
        return persistence.hold(appointment, idempotencyKey, fingerprint("${customer.actorId}:$outletId:$serviceId:$petId:$slotId:$paymentMethod:$cleanNotes"), now)
    }

    fun confirm(customer: Principal, appointmentId: UUID): CustomerAppointment {
        Authorizer.requireRole(customer, Role.CUSTOMER)
        return persistence.confirm(customer.actorId, appointmentId, clock.instant()) ?: unavailable()
    }

    fun cancel(customer: Principal, appointmentId: UUID, reason: String?): CustomerAppointment {
        Authorizer.requireRole(customer, Role.CUSTOMER)
        if (reason != null && reason.trim().length > 500) invalidAppointment()
        return persistence.cancel(customer.actorId, appointmentId, reason, clock.instant()) ?: unavailable()
    }

    fun get(customer: Principal, appointmentId: UUID): CustomerAppointment {
        Authorizer.requireRole(customer, Role.CUSTOMER)
        return persistence.get(customer.actorId, appointmentId, clock.instant()) ?: unavailable()
    }

    fun list(customer: Principal, page: Int, pageSize: Int): AppointmentPage {
        Authorizer.requireRole(customer, Role.CUSTOMER)
        if (page < 0 || pageSize !in 1..100) throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        return persistence.list(customer.actorId, page, pageSize, clock.instant())
    }

    private fun activeOffering(serviceId: UUID): ServiceOffering {
        val offering = persistence.getOffering(serviceId)?.takeIf { it.active } ?: unavailable()
        val outlet = providers.allOutlets().find { it.id == offering.outletId }
        if (outlet?.status != ProviderStatus.ACTIVE || !supports(outlet.capabilities, offering.capability)) unavailable()
        return offering
    }

    private fun supports(capabilities: Set<ProviderCapability>, capability: ServiceCapability) = when (capability) {
        ServiceCapability.GROOMING -> ProviderCapability.GROOMING in capabilities
        ServiceCapability.VETERINARY -> ProviderCapability.VETERINARY_CLINIC in capabilities || ProviderCapability.VETERINARY_HOSPITAL in capabilities
    }

    private fun validateIdempotencyKey(key: String) {
        if (!key.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
    }

    private fun fingerprint(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }

    private fun invalidService(): Nothing = throw DomainException("SERVICE_INVALID", "The service details are invalid")
    private fun invalidSlot(): Nothing = throw DomainException("SERVICE_SLOT_INVALID", "The service slot is invalid")
    private fun invalidAppointment(): Nothing = throw DomainException("APPOINTMENT_INVALID", "The appointment request is invalid")
    private fun unavailable(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
}

private val OCCUPYING_STATUSES = setOf(AppointmentStatus.HOLD, AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE)
private fun slotUnavailable(): Nothing = throw DomainException("APPOINTMENT_SLOT_UNAVAILABLE", "This appointment slot is no longer available")
private fun invalidState(): Nothing = throw DomainException("APPOINTMENT_STATE_INVALID", "The appointment cannot be changed from its current state")
private fun holdExpired(): Nothing = throw DomainException("APPOINTMENT_HOLD_EXPIRED", "The appointment hold has expired")
