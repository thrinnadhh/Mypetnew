package `in`.mypetnew.appointment

import `in`.mypetnew.appointment.domain.AppointmentService
import `in`.mypetnew.appointment.domain.AppointmentStatus
import `in`.mypetnew.appointment.domain.InMemoryAppointmentPersistence
import `in`.mypetnew.common.error.DomainException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class AppointmentServiceTest {
    private val now = Instant.parse("2026-08-16T00:00:00Z")
    private val persistence = InMemoryAppointmentPersistence()
    private val service = AppointmentService(persistence, Clock.fixed(now, ZoneOffset.UTC))
    private val outletId = UUID.randomUUID()
    private val customerId = UUID.randomUUID()
    private val petId = UUID.randomUUID()

    @Test
    fun `pay at clinic booking uses server price and confirms without payment id`() {
        val offering = service.createOffering(outletId, "Full Groom", null, 129900, 60)
        val slot = service.createSlot(offering.id, now.plusSeconds(3600), now.plusSeconds(7200))

        val held = service.hold(customerId, outletId, offering.id, slot.id, petId, payAtClinic = true)
        assertEquals(129900, held.pricePaise)
        assertEquals(AppointmentStatus.HOLD, held.status)

        val confirmed = service.confirm(customerId, held.id, null)
        assertEquals(AppointmentStatus.BOOKED, confirmed.status)
        assertEquals(null, confirmed.paymentId)
    }

    @Test
    fun `same live slot cannot be held twice`() {
        val offering = service.createOffering(outletId, "Consultation", null, 50000, 30)
        val slot = service.createSlot(offering.id, now.plusSeconds(3600), now.plusSeconds(5400))
        service.hold(customerId, outletId, offering.id, slot.id, petId, payAtClinic = true)

        val error = assertThrows(DomainException::class.java) {
            service.hold(UUID.randomUUID(), outletId, offering.id, slot.id, UUID.randomUUID(), payAtClinic = true)
        }
        assertEquals("SLOT_UNAVAILABLE", error.code)
    }

    @Test
    fun `online appointment payment remains fail closed`() {
        val offering = service.createOffering(outletId, "Vet Review", null, 79900, 30)
        val slot = service.createSlot(offering.id, now.plusSeconds(3600), now.plusSeconds(5400))
        val held = service.hold(customerId, outletId, offering.id, slot.id, petId, payAtClinic = false)

        val error = assertThrows(DomainException::class.java) {
            service.confirm(customerId, held.id, UUID.randomUUID())
        }
        assertEquals("APPOINTMENT_ONLINE_PAYMENT_UNAVAILABLE", error.code)
    }

    @Test
    fun `client payment reference cannot confirm pay at clinic booking`() {
        val offering = service.createOffering(outletId, "Nail Trim", null, 29900, 15)
        val slot = service.createSlot(offering.id, now.plusSeconds(3600), now.plusSeconds(4500))
        val held = service.hold(customerId, outletId, offering.id, slot.id, petId, payAtClinic = true)

        val error = assertThrows(DomainException::class.java) {
            service.confirm(customerId, held.id, UUID.randomUUID())
        }
        assertEquals("APPOINTMENT_PAYMENT_NOT_ACCEPTED", error.code)
    }

    @Test
    fun `provider offering mismatch is rejected`() {
        val offering = service.createOffering(outletId, "Bath", null, 69900, 30)
        val slot = service.createSlot(offering.id, now.plusSeconds(3600), now.plusSeconds(5400))

        val error = assertThrows(DomainException::class.java) {
            service.hold(customerId, UUID.randomUUID(), offering.id, slot.id, petId, payAtClinic = true)
        }
        assertEquals("RESOURCE_NOT_FOUND", error.code)
    }
}
