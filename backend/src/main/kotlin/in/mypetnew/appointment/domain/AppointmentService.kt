package `in`.mypetnew.appointment.domain

import `in`.mypetnew.common.error.DomainException
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

enum class ServiceOfferingStatus { ACTIVE, INACTIVE }
enum class AppointmentStatus {
    HOLD,
    HOLD_EXPIRED,
    BOOKED,
    CONFIRMED,
    CHECKED_IN,
    IN_SERVICE,
    COMPLETED,
    CANCELLED,
    REJECTED,
    NO_SHOW,
}

data class ServiceOffering(
    val id: UUID,
    val outletId: UUID,
    val name: String,
    val description: String?,
    val pricePaise: Long,
    val durationMinutes: Int,
    val status: ServiceOfferingStatus,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class ServiceSlot(
    val id: UUID,
    val offeringId: UUID,
    val slotStart: Instant,
    val slotEnd: Instant,
    val createdAt: Instant,
)

data class Appointment(
    val id: UUID,
    val customerId: UUID,
    val providerId: UUID,
    val offeringId: UUID,
    val slotId: UUID,
    val petId: UUID,
    val pricePaise: Long,
    val status: AppointmentStatus,
    val payAtClinic: Boolean,
    val paymentId: UUID?,
    val holdExpiresAt: Instant?,
    val bookedAt: Instant?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

interface AppointmentPersistence {
    fun createOffering(offering: ServiceOffering): ServiceOffering
    fun getOffering(offeringId: UUID): ServiceOffering?
    fun listOfferings(outletId: UUID): List<ServiceOffering>
    fun createSlot(slot: ServiceSlot): ServiceSlot
    fun listSlots(offeringId: UUID, now: Instant): List<ServiceSlot>
    fun hold(
        appointment: Appointment,
        now: Instant,
    ): Appointment
    fun getAppointment(appointmentId: UUID): Appointment?
    fun confirm(
        appointmentId: UUID,
        customerId: UUID,
        paymentId: UUID?,
        now: Instant,
    ): Appointment
    fun listCustomerAppointments(customerId: UUID): List<Appointment>
}

class InMemoryAppointmentPersistence : AppointmentPersistence {
    private val offerings = linkedMapOf<UUID, ServiceOffering>()
    private val slots = linkedMapOf<UUID, ServiceSlot>()
    private val appointments = linkedMapOf<UUID, Appointment>()

    @Synchronized
    override fun createOffering(offering: ServiceOffering): ServiceOffering = offering.also { offerings[it.id] = it }

    @Synchronized
    override fun getOffering(offeringId: UUID): ServiceOffering? = offerings[offeringId]

    @Synchronized
    override fun listOfferings(outletId: UUID): List<ServiceOffering> = offerings.values
        .filter { it.outletId == outletId && it.status == ServiceOfferingStatus.ACTIVE }
        .sortedWith(compareBy<ServiceOffering> { it.name.lowercase() }.thenBy { it.id.toString() })

    @Synchronized
    override fun createSlot(slot: ServiceSlot): ServiceSlot {
        if (slots.values.any { it.offeringId == slot.offeringId && it.slotStart == slot.slotStart }) {
            throw DomainException("SLOT_ALREADY_EXISTS", "A slot already exists at this time")
        }
        slots[slot.id] = slot
        return slot
    }

    @Synchronized
    override fun listSlots(offeringId: UUID, now: Instant): List<ServiceSlot> {
        expireHolds(now)
        val unavailable = appointments.values
            .filter {
                it.slotId in slots && it.status in setOf(
                    AppointmentStatus.HOLD,
                    AppointmentStatus.BOOKED,
                    AppointmentStatus.CONFIRMED,
                    AppointmentStatus.CHECKED_IN,
                    AppointmentStatus.IN_SERVICE,
                )
            }
            .mapTo(mutableSetOf()) { it.slotId }
        return slots.values
            .filter { it.offeringId == offeringId && it.slotStart.isAfter(now) && it.id !in unavailable }
            .sortedBy { it.slotStart }
    }

    @Synchronized
    override fun hold(appointment: Appointment, now: Instant): Appointment {
        expireHolds(now)
        val offering = offerings[appointment.offeringId] ?: unavailable()
        val slot = slots[appointment.slotId] ?: unavailable()
        if (
            offering.status != ServiceOfferingStatus.ACTIVE ||
            offering.outletId != appointment.providerId ||
            slot.offeringId != offering.id ||
            !slot.slotStart.isAfter(now)
        ) unavailable()
        if (appointments.values.any {
                it.slotId == slot.id && it.status in setOf(
                    AppointmentStatus.HOLD,
                    AppointmentStatus.BOOKED,
                    AppointmentStatus.CONFIRMED,
                    AppointmentStatus.CHECKED_IN,
                    AppointmentStatus.IN_SERVICE,
                )
            }
        ) {
            throw DomainException("SLOT_UNAVAILABLE", "This slot was just taken")
        }
        appointments[appointment.id] = appointment
        return appointment
    }

    @Synchronized
    override fun getAppointment(appointmentId: UUID): Appointment? = appointments[appointmentId]

    @Synchronized
    override fun confirm(
        appointmentId: UUID,
        customerId: UUID,
        paymentId: UUID?,
        now: Instant,
    ): Appointment {
        expireHolds(now)
        val current = appointments[appointmentId]?.takeIf { it.customerId == customerId } ?: unavailable()
        if (current.status == AppointmentStatus.HOLD_EXPIRED) {
            throw DomainException("SLOT_HOLD_EXPIRED", "The slot hold expired; choose a fresh slot")
        }
        if (current.status != AppointmentStatus.HOLD) {
            if (current.status == AppointmentStatus.BOOKED) return current
            throw DomainException("APPOINTMENT_STATE_INVALID", "The appointment cannot be confirmed from its current state")
        }
        if (!current.payAtClinic && paymentId == null) {
            throw DomainException("APPOINTMENT_PAYMENT_REQUIRED", "A reconciled appointment payment is required")
        }
        val updated = current.copy(
            status = AppointmentStatus.BOOKED,
            paymentId = paymentId,
            bookedAt = now,
            holdExpiresAt = null,
            updatedAt = now,
        )
        appointments[appointmentId] = updated
        return updated
    }

    @Synchronized
    override fun listCustomerAppointments(customerId: UUID): List<Appointment> = appointments.values
        .filter { it.customerId == customerId }
        .sortedWith(compareByDescending<Appointment> { it.createdAt }.thenByDescending { it.id.toString() })

    private fun expireHolds(now: Instant) {
        appointments.replaceAll { _, current ->
            if (
                current.status == AppointmentStatus.HOLD &&
                current.holdExpiresAt?.let { !it.isAfter(now) } == true
            ) {
                current.copy(status = AppointmentStatus.HOLD_EXPIRED, updatedAt = now)
            } else current
        }
    }
}

class AppointmentService(
    private val persistence: AppointmentPersistence,
    private val clock: Clock = Clock.systemUTC(),
    private val holdDuration: Duration = Duration.ofMinutes(10),
) {
    fun createOffering(
        outletId: UUID,
        name: String,
        description: String?,
        pricePaise: Long,
        durationMinutes: Int,
    ): ServiceOffering {
        val cleanName = name.trim()
        val cleanDescription = description?.trim()?.takeIf { it.isNotEmpty() }
        if (cleanName.length !in 2..160) throw DomainException("VALIDATION_ERROR", "Service name is invalid")
        if (cleanDescription != null && cleanDescription.length > 500) {
            throw DomainException("VALIDATION_ERROR", "Service description is too long")
        }
        if (pricePaise < 0) throw DomainException("VALIDATION_ERROR", "Service price must not be negative")
        if (durationMinutes !in 5..480) throw DomainException("VALIDATION_ERROR", "Service duration must be between 5 and 480 minutes")
        val now = clock.instant()
        return persistence.createOffering(
            ServiceOffering(
                id = UUID.randomUUID(),
                outletId = outletId,
                name = cleanName,
                description = cleanDescription,
                pricePaise = pricePaise,
                durationMinutes = durationMinutes,
                status = ServiceOfferingStatus.ACTIVE,
                createdAt = now,
                updatedAt = now,
            ),
        )
    }

    fun listOfferings(outletId: UUID): List<ServiceOffering> = persistence.listOfferings(outletId)

    fun createSlot(offeringId: UUID, slotStart: Instant, slotEnd: Instant): ServiceSlot {
        val offering = persistence.getOffering(offeringId) ?: unavailable()
        if (offering.status != ServiceOfferingStatus.ACTIVE) unavailable()
        val now = clock.instant()
        if (!slotStart.isAfter(now)) throw DomainException("VALIDATION_ERROR", "Slot must start in the future")
        if (!slotEnd.isAfter(slotStart)) throw DomainException("VALIDATION_ERROR", "Slot end must be after slot start")
        if (Duration.between(slotStart, slotEnd).toMinutes() != offering.durationMinutes.toLong()) {
            throw DomainException("VALIDATION_ERROR", "Slot duration must match the service offering")
        }
        return persistence.createSlot(
            ServiceSlot(UUID.randomUUID(), offeringId, slotStart, slotEnd, now),
        )
    }

    fun listAvailableSlots(offeringId: UUID): List<ServiceSlot> {
        val offering = persistence.getOffering(offeringId) ?: unavailable()
        if (offering.status != ServiceOfferingStatus.ACTIVE) unavailable()
        return persistence.listSlots(offeringId, clock.instant())
    }

    fun hold(
        customerId: UUID,
        providerId: UUID,
        offeringId: UUID,
        slotId: UUID,
        petId: UUID,
        payAtClinic: Boolean,
    ): Appointment {
        val offering = persistence.getOffering(offeringId) ?: unavailable()
        if (offering.outletId != providerId || offering.status != ServiceOfferingStatus.ACTIVE) unavailable()
        val now = clock.instant()
        return persistence.hold(
            Appointment(
                id = UUID.randomUUID(),
                customerId = customerId,
                providerId = providerId,
                offeringId = offeringId,
                slotId = slotId,
                petId = petId,
                pricePaise = offering.pricePaise,
                status = AppointmentStatus.HOLD,
                payAtClinic = payAtClinic,
                paymentId = null,
                holdExpiresAt = now.plus(holdDuration),
                bookedAt = null,
                createdAt = now,
                updatedAt = now,
            ),
            now,
        )
    }

    fun confirm(customerId: UUID, appointmentId: UUID, paymentId: UUID?): Appointment =
        persistence.confirm(appointmentId, customerId, paymentId, clock.instant())

    fun get(customerId: UUID, appointmentId: UUID): Appointment =
        persistence.getAppointment(appointmentId)?.takeIf { it.customerId == customerId } ?: unavailable()

    fun list(customerId: UUID): List<Appointment> = persistence.listCustomerAppointments(customerId)
}

private fun unavailable(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
