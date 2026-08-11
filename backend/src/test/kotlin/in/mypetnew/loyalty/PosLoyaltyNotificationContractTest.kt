package `in`.mypetnew.loyalty

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.engagement.domain.AppKind
import `in`.mypetnew.engagement.domain.DeviceRegistrationService
import `in`.mypetnew.engagement.domain.NotificationService
import `in`.mypetnew.engagement.domain.Platform
import `in`.mypetnew.engagement.domain.SafeRoute
import `in`.mypetnew.loyalty.domain.LoyaltyService
import `in`.mypetnew.pos.domain.PaymentDeclaration
import `in`.mypetnew.pos.domain.PosService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors

class PosLoyaltyNotificationContractTest {
    @Test
    fun `eligible POS replay creates one sale movement and merchant-scoped star`() {
        val inventory = InventoryService()
        val loyalty = LoyaltyService()
        val pos = PosService(inventory, loyalty)
        val listing = UUID.randomUUID()
        val merchant = UUID.randomUUID()
        val customer = UUID.randomUUID()
        inventory.adjust(listing, 3, StockReason.RECEIPT, "receive")

        val first = pos.complete(
            merchantId = merchant,
            outletId = UUID.randomUUID(),
            customerId = customer,
            lines = mapOf(listing to Pair(1, 10_000L)),
            payment = PaymentDeclaration.CASH,
            idempotencyKey = "sale-1",
        )
        val replay = pos.complete(
            merchantId = merchant,
            outletId = first.outletId,
            customerId = customer,
            lines = mapOf(listing to Pair(1, 10_000L)),
            payment = PaymentDeclaration.CASH,
            idempotencyKey = "sale-1",
        )

        assertEquals(first.id, replay.id)
        assertEquals(1, loyalty.balance(customer, merchant))
        assertEquals(2, inventory.available(listing))
    }

    @Test
    fun `nine stars plus two concurrent awards issue one reward and retain one star`() {
        val loyalty = LoyaltyService()
        val customer = UUID.randomUUID()
        val merchant = UUID.randomUUID()
        repeat(9) { loyalty.award(customer, merchant, "SEED:$it", 10_000) }
        val executor = Executors.newFixedThreadPool(2)

        executor.invokeAll(listOf(
            Callable { loyalty.award(customer, merchant, "POS:A", 10_000) },
            Callable { loyalty.award(customer, merchant, "POS:B", 10_000) },
        )).forEach { it.get() }
        executor.shutdown()

        assertEquals(1, loyalty.balance(customer, merchant))
        assertEquals(1, loyalty.rewards(customer, merchant).size)
    }

    @Test
    fun `device rotation and notification dedupe preserve safe payload`() {
        val devices = DeviceRegistrationService()
        val notifications = NotificationService(devices)
        val user = UUID.randomUUID()
        val installation = UUID.randomUUID()
        devices.register(user, AppKind.CUSTOMER, Platform.ANDROID, installation, "token-old", "dev")
        devices.register(user, AppKind.CUSTOMER, Platform.ANDROID, installation, "token-new", "dev")

        val first = notifications.enqueue(
            sourceEventId = UUID.randomUUID(),
            recipientId = user,
            templateVersion = "pos-star-v1",
            title = "You earned a star",
            body = "Open MyPetNew to view your loyalty activity.",
            route = SafeRoute.CUSTOMER_LOYALTY,
            resourceId = UUID.randomUUID(),
        )
        val replay = notifications.enqueue(
            sourceEventId = first.sourceEventId,
            recipientId = user,
            templateVersion = "pos-star-v1",
            title = "You earned a star",
            body = "Open MyPetNew to view your loyalty activity.",
            route = SafeRoute.CUSTOMER_LOYALTY,
            resourceId = first.resourceId,
        )

        assertEquals(first.id, replay.id)
        assertEquals(1, devices.activeFor(user).size)
        assertFalse(first.payload.values.any { it.contains("token-") })
        assertTrue(first.payload.keys.all { it in setOf("notificationId", "resourceId", "route", "eventType") })
    }
}

