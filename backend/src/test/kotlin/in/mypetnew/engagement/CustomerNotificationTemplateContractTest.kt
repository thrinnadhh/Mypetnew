package `in`.mypetnew.engagement

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.engagement.domain.NotificationService
import `in`.mypetnew.engagement.domain.SafeRoute
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class CustomerNotificationTemplateContractTest {

    private val service = NotificationService()

    private fun enqueue(templateVersion: String, title: String, body: String, route: SafeRoute) = service.enqueue(
        sourceEventId = UUID.randomUUID(),
        recipientId = UUID.randomUUID(),
        templateVersion = templateVersion,
        title = title,
        body = body,
        route = route,
        resourceId = UUID.randomUUID(),
    )

    @Test
    fun `customer order lifecycle templates are approved and lock-screen safe`() {
        val accepted = enqueue(
            "customer-order-accepted-v1",
            "Order accepted",
            "The store accepted your order and is preparing it.",
            SafeRoute.CUSTOMER_ORDER,
        )
        val ready = enqueue(
            "customer-order-ready-v1",
            "Order ready",
            "Your order is ready at the store counter.",
            SafeRoute.CUSTOMER_ORDER,
        )
        val outForDelivery = enqueue(
            "customer-order-out-for-delivery-v1",
            "Order on the way",
            "A Captain picked up your order. Follow live tracking in MyPet.",
            SafeRoute.CUSTOMER_ORDER,
        )
        val delivered = enqueue(
            "customer-order-delivered-v1",
            "Order delivered",
            "Your order was delivered. Thank you for shopping with MyPet.",
            SafeRoute.CUSTOMER_ORDER,
        )
        val cancelled = enqueue(
            "customer-order-cancelled-v1",
            "Order update",
            "Your order was cancelled by the store. Open MyPet for details.",
            SafeRoute.CUSTOMER_ORDER,
        )
        listOf(accepted, ready, outForDelivery, delivered, cancelled).forEach {
            assertEquals(SafeRoute.CUSTOMER_ORDER.wireValue, it.payload["route"])
        }
    }

    @Test
    fun `customer appointment templates are approved and target the appointment surface`() {
        val confirmed = enqueue(
            "customer-appointment-confirmed-v1",
            "Appointment confirmed",
            "The provider confirmed your booking request.",
            SafeRoute.CUSTOMER_APPOINTMENT,
        )
        val declined = enqueue(
            "customer-appointment-declined-v1",
            "Appointment update",
            "The provider could not accept your booking request. Open MyPet for details.",
            SafeRoute.CUSTOMER_APPOINTMENT,
        )
        assertEquals("customer/appointments/detail", confirmed.payload["route"])
        assertEquals("customer/appointments/detail", declined.payload["route"])
    }

    @Test
    fun `unapproved or mutated customer templates fail closed`() {
        assertThrows<DomainException> {
            enqueue(
                "customer-order-magic-v1",
                "Order magic",
                "Not an approved template.",
                SafeRoute.CUSTOMER_ORDER,
            )
        }
        assertThrows<DomainException> {
            enqueue(
                "customer-order-delivered-v1",
                "Order delivered",
                "Mutated body is rejected.",
                SafeRoute.CUSTOMER_ORDER,
            )
        }
    }

    @Test
    fun `customer routes are exposed to the safe route allowlist`() {
        val wireValues = SafeRoute.entries.map(SafeRoute::wireValue)
        assertTrue("customer/orders/detail" in wireValues)
        assertTrue("customer/appointments/detail" in wireValues)
    }
}
