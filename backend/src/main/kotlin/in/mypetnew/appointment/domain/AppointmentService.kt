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
enum class AppointmentPaymentMethod { PAY_AT_PROVIDER, ONLINE_PAYMENT }
enum class AppointmentPaymentStatus { NOT_REQUIRED, PENDING, PAID, FAILED, EXPIRED, REFUND_PENDING, REFUNDED, REFUND_FAILED }

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
    fun merchantTransition(
        outletId: UUID,
        appointmentId: UUID,
        allowedFrom: Set<AppointmentStatus>,
        target: AppointmentStatus,
        actorId: UUID,
        reason: String?,
        now: Instant,
    ): CustomerAppointment?
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
        return slots.values
            .filter { it.serviceId == serviceId && it.active && it.startsAt >= from && it.startsAt < to && it.startsAt > now && it.id !in occupied }
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
        val current = appointments[appointmentId]?.takeIf { it.customerId == customerId } ?: return null
        if (current.status == AppointmentStatus.BOOKED || current.status == AppointmentStatus.CONFIRMED) return current
        if (current.status == AppointmentStatus.HOLD_EXPIRED) holdExpired()
        if (current.status == AppointmentStatus.HOLD && (current.holdExpiresAt == null || !current.holdExpiresAt.isAfter(now))) {
            appointments[appointmentId] = current.copy(
                status = AppointmentStatus.HOLD_EXPIRED,
                paymentStatus = if (current.paymentMethod == AppointmentPaymentMethod.ONLINE_PAYMENT) AppointmentPaymentStatus.EXPIRED else current.paymentStatus,
                updatedAt = now,
            )
            holdExpired()
        }
        if (current.paymentMethod == AppointmentPaymentMethod.ONLINE_PAYMENT) {
            throw DomainException(
                "APPOINTMENT_PAYMENT_REQUIRED",
                "Online appointment payment must be captured before provider confirmation can begin",
            )
        }
        if (current.status != AppointmentStatus.HOLD) invalidState()
        return current.copy(status = AppointmentStatus.BOOKED, holdExpiresAt = null, updatedAt = now)
            .also { appointments[appointmentId] = it }
    }

    @Synchronized override fun cancel(customerId: UUID, appointmentId: UUID, reason: String?, now: Instant): CustomerAppointment? {
        val current = appointments[appointmentId]?.takeIf { it.customerId == customerId } ?: return null
        if (current.status == AppointmentStatus.CANCELLED) return current
        if (current.status == AppointmentStatus.HOLD_EXPIRED) holdExpired()
        if (current.status == AppointmentStatus.HOLD && (current.holdExpiresAt == null || !current.holdExpiresAt.isAfter(now))) {
            appointments[appointmentId] = current.copy(
                status = AppointmentStatus.HOLD_EXPIRED,
                paymentStatus = if (current.paymentMethod == AppointmentPaymentMethod.ONLINE_PAYMENT) AppointmentPaymentStatus.EXPIRED else current.paymentStatus,
                updatedAt = now,
            )
            holdExpired()
        }
        if (current.status !in setOf(AppointmentStatus.HOLD, AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED)) invalidState()
        return current.copy(
            status = AppointmentStatus.CANCELLED,
            paymentStatus = if (
                current.paymentMethod == AppointmentPaymentMethod.ONLINE_PAYMENT &&
                current.paymentStatus == AppointmentPaymentStatus.PENDING
            ) AppointmentPaymentStatus.EXPIRED else current.paymentStatus,
            notes = reason?.trim()?.takeIf { it.isNotEmpty() } ?: current.notes,
            holdExpiresAt = null,
            updatedAt = now,
        ).also { appointments[appointmentId] = it }
    }

    @Synchronized override fun merchantTransition(
        outletId: UUID,
        appointmentId: UUID,
        allowedFrom: Set<AppointmentStatus>,
        target: AppointmentStatus,
        actorId: UUID,
        reason: String?,
        now: Instant,
    ): CustomerAppointment? {
        expireHolds(now)
        val current = appointments[appointmentId]?.takeIf { it.outletId == outletId } ?: return null
        if (current.status == target) return current
        if (current.status !in allowedFrom) invalidState()
        return current.copy(status = target, holdExpiresAt = null, updatedAt = now)
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
                value.copy(
                    status = AppointmentStatus.HOLD_EXPIRED,
                    paymentStatus = if (value.paymentMethod == AppointmentPaymentMethod.ONLINE_PAYMENT) AppointmentPaymentStatus.EXPIRED else value.paymentStatus,
                    updatedAt = now,
                )
            } else {
                value
            }
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
        if (merchant.organizationId == null || merchant.organizationId != outlet.organizationId) unavailable()
        if (outlet.status != ProviderStatus.ACTIVE || !supports(outlet.capabilities, capability)) unavailable()
        val cleanName = name.trim()
        val cleanDescription = description?.trim()?.takeIf { it.isNotEmpty() }
        if (
            cleanName.length !in 2..160 ||
            (cleanDescription != null && cleanDescription.length > 1_000) ||
            durationMinutes !in 5..480 ||
            pricePaise !in 0..10_000_000
        ) {
            invalidService()
        }
        return persistence.saveOffering(
            ServiceOffering(
                UUID.randomUUID(),
                outlet.organizationId,
                outletId,
                capability,
                cleanName,
                cleanDescription,
                durationMinutes,
                pricePaise,
                true,
                clock.instant(),
            ),
        )
    }

    fun createSlot(merchant: Principal, serviceId: UUID, startsAt: Instant): ServiceSlot {
        val offering = activeOffering(serviceId)
        Authorizer.requireOutlet(merchant, offering.outletId)
        if (merchant.organizationId == null || merchant.organizationId != offering.organizationId) unavailable()
        val now = clock.instant()
        if (!startsAt.isAfter(now)) invalidSlot()
        return persistence.saveSlot(
            ServiceSlot(
                UUID.randomUUID(),
                serviceId,
                startsAt,
                startsAt.plusSeconds(offering.durationMinutes * 60L),
                true,
            ),
        )
    }

    fun listServices(capability: ServiceCapability?, outletId: UUID?): List<ServiceOffering> =
        persistence.listOfferings(capability, outletId).filter { offering ->
            providers.allOutlets().any { outlet ->
                outlet.id == offering.outletId &&
                    outlet.status == ProviderStatus.ACTIVE &&
                    supports(outlet.capabilities, offering.capability)
            }
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
        servicePincode: String,
        expectedSlotStartsAt: Instant? = null,
        expectedSlotEndsAt: Instant? = null,
    ): CustomerAppointment {
        Authorizer.requireRole(customer, Role.CUSTOMER)
        validateIdempotencyKey(idempotencyKey)
        val offering = activeOffering(serviceId)
        if (offering.outletId != outletId) unavailable()
        val slot = persistence.getSlot(slotId)?.takeIf { it.serviceId == serviceId && it.active } ?: unavailable()
        if (
            expectedSlotStartsAt != null || expectedSlotEndsAt != null
        ) {
            if (
                expectedSlotStartsAt == null ||
                expectedSlotEndsAt == null ||
                slot.startsAt != expectedSlotStartsAt ||
                slot.endsAt != expectedSlotEndsAt
            ) {
                staleSlot()
            }
        }
        val now = clock.instant()
        if (!slot.startsAt.isAfter(now)) slotUnavailable()
        val pet = customerData.getPet(customer.actorId, petId)
        val outlet = providers.getOutlet(outletId).takeIf { it.status == ProviderStatus.ACTIVE } ?: unavailable()
        if (outlet.organizationId != offering.organizationId) unavailable()
        validateServicePincode(servicePincode)
        if (servicePincode !in outlet.servicePinCodes) appointmentPincodeUnavailable()
        val cleanNotes = notes?.trim()?.takeIf { it.isNotEmpty() }
        if (cleanNotes != null && cleanNotes.length > 1_000) invalidAppointment()
        val appointment = CustomerAppointment(
            UUID.randomUUID(),
            customer.actorId,
            petId,
            offering.organizationId,
            outletId,
            serviceId,
            slotId,
            offering.name,
            outlet.name,
            pet.name,
            slot.startsAt,
            slot.endsAt,
            AppointmentStatus.HOLD,
            paymentMethod,
            if (paymentMethod == AppointmentPaymentMethod.ONLINE_PAYMENT) {
                AppointmentPaymentStatus.PENDING
            } else {
                AppointmentPaymentStatus.NOT_REQUIRED
            },
            offering.pricePaise,
            cleanNotes,
            now.plus(holdDuration),
            now,
            now,
        )
        val fingerprint = fingerprint(
            "${customer.actorId}:$outletId:$serviceId:$petId:$slotId:$paymentMethod:$servicePincode:" +
                "${expectedSlotStartsAt ?: slot.startsAt}:${expectedSlotEndsAt ?: slot.endsAt}:$cleanNotes",
        )
        return persistence.hold(appointment, idempotencyKey, fingerprint, now)
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

    fun merchantTransition(
        merchant: Principal,
        outletId: UUID,
        appointmentId: UUID,
        target: AppointmentStatus,
        reason: String? = null,
    ): CustomerAppointment {
        Authorizer.requireRole(merchant, Role.MERCHANT)
        Authorizer.requireOutlet(merchant, outletId)
        val outlet = providers.getOutlet(outletId)
        if (merchant.organizationId == null || merchant.organizationId != outlet.organizationId) unavailable()
        val normalizedReason = reason?.trim()?.takeIf { it.isNotEmpty() }
        if (target in setOf(AppointmentStatus.REJECTED, AppointmentStatus.CANCELLED) && normalizedReason == null) {
            throw DomainException("APPOINTMENT_REASON_REQUIRED", "A reason is required for this appointment transition")
        }
        if ((normalizedReason?.length ?: 0) > 240) {
            throw DomainException("APPOINTMENT_REASON_INVALID", "The appointment transition reason is too long")
        }
        val allowedFrom = when (target) {
            AppointmentStatus.CONFIRMED -> setOf(AppointmentStatus.BOOKED)
            AppointmentStatus.REJECTED -> setOf(AppointmentStatus.BOOKED)
            AppointmentStatus.CHECKED_IN -> setOf(AppointmentStatus.CONFIRMED)
            AppointmentStatus.IN_SERVICE -> setOf(AppointmentStatus.CHECKED_IN)
            AppointmentStatus.COMPLETED -> setOf(AppointmentStatus.IN_SERVICE)
            AppointmentStatus.NO_SHOW -> setOf(AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED)
            AppointmentStatus.CANCELLED -> setOf(AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED)
            else -> throw DomainException(
                "APPOINTMENT_STATUS_TARGET_INVALID",
                "The requested merchant appointment status is not allowed",
            )
        }
        return persistence.merchantTransition(
            outletId,
            appointmentId,
            allowedFrom,
            target,
            merchant.actorId,
            normalizedReason,
            clock.instant(),
        ) ?: unavailable()
    }

    fun get(customer: Principal, appointmentId: UUID): CustomerAppointment {
        Authorizer.requireRole(customer, Role.CUSTOMER)
        return persistence.get(customer.actorId, appointmentId, clock.instant()) ?: unavailable()
    }

    fun list(customer: Principal, page: Int, pageSize: Int): AppointmentPage {
        Authorizer.requireRole(customer, Role.CUSTOMER)
        if (page < 0 || pageSize !in 1..100) {
            throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        }
        return persistence.list(customer.actorId, page, pageSize, clock.instant())
    }

    private fun activeOffering(serviceId: UUID): ServiceOffering {
        val offering = persistence.getOffering(serviceId)?.takeIf { it.active } ?: unavailable()
        val outlet = providers.allOutlets().find { it.id == offering.outletId }
        if (
            outlet?.status != ProviderStatus.ACTIVE ||
            !supports(outlet.capabilities, offering.capability)
        ) {
            unavailable()
        }
        return offering
    }

    private fun supports(capabilities: Set<ProviderCapability>, capability: ServiceCapability) = when (capability) {
        ServiceCapability.GROOMING -> ProviderCapability.GROOMING in capabilities
        ServiceCapability.VETERINARY ->
            ProviderCapability.VETERINARY_CLINIC in capabilities || ProviderCapability.VETERINARY_HOSPITAL in capabilities
    }

    private fun validateIdempotencyKey(key: String) {
        if (!key.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) {
            throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
        }
    }

    private fun validateServicePincode(pincode: String) {
        if (!pincode.matches(Regex("[1-9][0-9]{5}"))) {
            throw DomainException("PIN_CODE_INVALID", "PIN code must contain exactly six digits")
        }
    }

    private fun fingerprint(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun invalidService(): Nothing = throw DomainException("SERVICE_INVALID", "The service details are invalid")
    private fun invalidSlot(): Nothing = throw DomainException("SERVICE_SLOT_INVALID", "The service slot is invalid")
    private fun invalidAppointment(): Nothing = throw DomainException("APPOINTMENT_INVALID", "The appointment request is invalid")
    private fun unavailable(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
    private fun appointmentPincodeUnavailable(): Nothing = throw DomainException(
        "APPOINTMENT_PIN_NOT_SERVICEABLE",
        "The selected provider no longer serves this PIN code",
    )
    private fun staleSlot(): Nothing = throw DomainException(
        "APPOINTMENT_SLOT_STALE",
        "The selected appointment time has changed. Choose a current slot before booking.",
    )
}

private val OCCUPYING_STATUSES = setOf(
    AppointmentStatus.HOLD,
    AppointmentStatus.BOOKED,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.IN_SERVICE,
)

private fun slotUnavailable(): Nothing =
    throw DomainException("APPOINTMENT_SLOT_UNAVAILABLE", "This appointment slot is no longer available")

private fun invalidState(): Nothing =
    throw DomainException("APPOINTMENT_STATE_INVALID", "The appointment cannot be changed from its current state")

private fun holdExpired(): Nothing =
    throw DomainException("APPOINTMENT_HOLD_EXPIRED", "The appointment hold has expired")
