package `in`.mypetnew.commerce

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.Test
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class OrderLifecycleActorContractTest {
    @Test
    fun `customer can cancel placed order and reservation is released exactly once`() {
        val fixture = fixture()
        val customerId = fixture.orders.get(fixture.orderId).customerId

        val cancelled = fixture.orders.transition(
            orderId = fixture.orderId,
            target = OrderStatus.CANCELLED,
            idempotencyKey = "customer-cancel-1",
            actorId = customerId,
            actorRole = Role.CUSTOMER,
            reason = "Changed mind",
            traceId = "trace-customer-cancel",
        )
        val replay = fixture.orders.transition(
            orderId = fixture.orderId,
            target = OrderStatus.CANCELLED,
            idempotencyKey = "customer-cancel-1",
            actorId = customerId,
            actorRole = Role.CUSTOMER,
            reason = "Changed mind",
            traceId = "trace-customer-cancel-replay",
        )

        assertThat(cancelled.status).isEqualTo(OrderStatus.CANCELLED)
        assertThat(replay).isEqualTo(cancelled)
        assertThat(cancelled.history).hasSize(2)
        assertThat(cancelled.history.last().actorRole).isEqualTo(Role.CUSTOMER)
        assertThat(cancelled.history.last().actorId).isEqualTo(customerId)
        assertThat(cancelled.history.last().fromStatus).isEqualTo(OrderStatus.PLACED)
        assertThat(cancelled.history.last().reason).isEqualTo("Changed mind")
        assertThat(fixture.inventory.reserved(fixture.listingId)).isZero()
        assertThat(fixture.inventory.available(fixture.listingId)).isEqualTo(1)
    }

    @Test
    fun `customer cannot execute merchant accept transition`() {
        val fixture = fixture()

        assertThatThrownBy {
            fixture.orders.transition(
                orderId = fixture.orderId,
                target = OrderStatus.ACCEPTED,
                idempotencyKey = "customer-accept-attempt",
                actorRole = Role.CUSTOMER,
            )
        }
            .isInstanceOf(DomainException::class.java)
            .hasMessageContaining("cannot move")

        assertThat(fixture.orders.get(fixture.orderId).status).isEqualTo(OrderStatus.PLACED)
        assertThat(fixture.inventory.reserved(fixture.listingId)).isEqualTo(1)
    }

    @Test
    fun `merchant cannot cancel an order that is still placed`() {
        val fixture = fixture()

        assertThatThrownBy {
            fixture.orders.transition(
                orderId = fixture.orderId,
                target = OrderStatus.CANCELLED,
                idempotencyKey = "merchant-cancel-before-accept",
                actorRole = Role.MERCHANT,
                reason = "Merchant cancellation attempt",
            )
        }
            .isInstanceOf(DomainException::class.java)
            .hasMessageContaining("cannot move")

        assertThat(fixture.orders.get(fixture.orderId).status).isEqualTo(OrderStatus.PLACED)
    }

    @Test
    fun `customer cancel racing merchant accept produces exactly one winning transition`() {
        val fixture = fixture()
        val customerId = fixture.orders.get(fixture.orderId).customerId
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)

        val customer = executor.submit<Result<OrderStatus>> {
            raceTransition(
                ready = ready,
                start = start,
                orders = fixture.orders,
                orderId = fixture.orderId,
                target = OrderStatus.CANCELLED,
                key = "race-customer-cancel",
                actorId = customerId,
                actorRole = Role.CUSTOMER,
                reason = "Changed mind",
            )
        }
        val merchant = executor.submit<Result<OrderStatus>> {
            raceTransition(
                ready = ready,
                start = start,
                orders = fixture.orders,
                orderId = fixture.orderId,
                target = OrderStatus.ACCEPTED,
                key = "race-merchant-accept",
                actorId = UUID.randomUUID(),
                actorRole = Role.MERCHANT,
                reason = null,
            )
        }

        assertThat(ready.await(2, TimeUnit.SECONDS)).isTrue()
        start.countDown()
        val outcomes = listOf(customer.get(2, TimeUnit.SECONDS), merchant.get(2, TimeUnit.SECONDS))
        executor.shutdownNow()

        assertThat(outcomes.count { it.isSuccess }).isEqualTo(1)
        assertThat(outcomes.count { it.isFailure }).isEqualTo(1)
        val finalOrder = fixture.orders.get(fixture.orderId)
        assertThat(finalOrder.status).isIn(OrderStatus.CANCELLED, OrderStatus.ACCEPTED)
        assertThat(finalOrder.history).hasSize(2)
        if (finalOrder.status == OrderStatus.CANCELLED) {
            assertThat(fixture.inventory.reserved(fixture.listingId)).isZero()
            assertThat(fixture.inventory.available(fixture.listingId)).isEqualTo(1)
        } else {
            assertThat(fixture.inventory.reserved(fixture.listingId)).isEqualTo(1)
            assertThat(fixture.inventory.available(fixture.listingId)).isZero()
        }
    }

    private fun raceTransition(
        ready: CountDownLatch,
        start: CountDownLatch,
        orders: OrderService,
        orderId: UUID,
        target: OrderStatus,
        key: String,
        actorId: UUID,
        actorRole: Role,
        reason: String?,
    ): Result<OrderStatus> {
        ready.countDown()
        start.await(2, TimeUnit.SECONDS)
        return runCatching {
            orders.transition(
                orderId = orderId,
                target = target,
                idempotencyKey = key,
                actorId = actorId,
                actorRole = actorRole,
                reason = reason,
                traceId = "trace-$key",
            ).status
        }
    }

    private fun fixture(): Fixture {
        val inventory = InventoryService()
        val listingId = UUID.randomUUID()
        inventory.adjust(listingId, 1, StockReason.RECEIPT, "receive-1")
        val orders = OrderService(inventory)
        val order = orders.checkout(
            customerId = UUID.randomUUID(),
            outletId = UUID.randomUUID(),
            lines = mapOf(listingId to 1),
            grandTotalPaise = 3_000,
            idempotencyKey = "checkout-1",
        )
        return Fixture(inventory, orders, listingId, order.id)
    }

    private data class Fixture(
        val inventory: InventoryService,
        val orders: OrderService,
        val listingId: UUID,
        val orderId: UUID,
    )
}
