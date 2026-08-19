package `in`.mypetnew.recurring

import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.commerce.domain.CustomerOrderCategory
import `in`.mypetnew.commerce.domain.CustomerOrderCursor
import `in`.mypetnew.commerce.domain.CustomerOrderDetailSnapshot
import `in`.mypetnew.commerce.domain.CustomerOrderLineSnapshot
import `in`.mypetnew.commerce.domain.CustomerOrderQuery
import `in`.mypetnew.commerce.domain.CustomerOrderSummaryPage
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.ProductOrder
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.customer.domain.InMemoryCustomerDataPersistence
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.recurring.domain.InMemoryRecurringOrderPersistence
import `in`.mypetnew.recurring.domain.RecurringOrderService
import `in`.mypetnew.recurring.domain.RecurringOrderStatus
import `in`.mypetnew.recurring.domain.RenewalProposalStatus
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class RecurringOrderServiceTest {
    @Test
    fun `create is pickup-safe customer-owned idempotent and cadence bounded`() {
        val fixture = fixture()
        val key = "create-stable-key"
        val created = fixture.service.create(fixture.customerId, fixture.orderId, 30, 2, key)
        val replay = fixture.service.create(fixture.customerId, fixture.orderId, 30, 2, key)

        assertEquals(created.id, replay.id)
        assertEquals(fixture.customerId, created.customerId)
        assertEquals(fixture.outletId, created.providerId)
        assertEquals(null, created.deliveryAddressId)
        assertEquals("STORE_PICKUP", created.fulfilmentMode)
        assertEquals(RecurringOrderStatus.ACTIVE, created.status)
        assertEquals(Instant.parse("2026-09-18T00:00:00Z"), created.nextOrderAt)

        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", codeOf {
            fixture.service.create(fixture.customerId, fixture.orderId, 15, 2, key)
        })
        assertEquals("RECURRING_ALREADY_EXISTS", codeOf {
            fixture.service.create(fixture.customerId, fixture.orderId, 30, 1, "different-key")
        })
        assertEquals("RESOURCE_NOT_FOUND", codeOf {
            fixture.service.create(UUID.randomUUID(), fixture.orderId, 30, 1, "foreign-customer")
        })
        assertEquals("RECURRING_CADENCE_INVALID", codeOf {
            fixture.service.create(fixture.customerId, UUID.randomUUID(), 10, 1, "invalid-cadence")
        })
        assertEquals("RECURRING_QUANTITY_INVALID", codeOf {
            fixture.service.create(fixture.customerId, fixture.orderId, 30, 21, "invalid-quantity")
        })
    }

    @Test
    fun `GET does not promote due schedule and scheduler creates one durable proposal per cycle`() {
        val fixture = fixture()
        val created = fixture.service.create(fixture.customerId, fixture.orderId, 7, 3, "create-seven")
        val dueService = fixture.serviceAt("2026-08-26T00:00:00Z")

        val read = dueService.list(fixture.customerId, 0, 20).items.single()
        assertEquals(RecurringOrderStatus.ACTIVE, read.status)
        assertEquals(created.nextOrderAt, read.nextOrderAt)
        assertTrue(dueService.listProposals(fixture.customerId, 0, 20).items.isEmpty())

        assertEquals(1, dueService.runScheduler().proposalsCreated)
        assertEquals(0, dueService.runScheduler().proposalsCreated)
        val proposals = dueService.listProposals(fixture.customerId, 0, 20).items
        assertEquals(1, proposals.size)
        assertEquals(created.id, proposals.single().subscriptionId)
        assertEquals(created.nextOrderAt, proposals.single().dueCycleAt)
        assertEquals(RenewalProposalStatus.AWAITING_CONFIRMATION, proposals.single().status)

        val afterScheduler = dueService.list(fixture.customerId, 0, 20).items.single()
        assertEquals(created.nextOrderAt, afterScheduler.nextOrderAt)
        assertEquals(RecurringOrderStatus.ACTIVE, afterScheduler.status)
    }

    @Test
    fun `proposal confirmation revalidates current price and stock but schedule advances only after normal order`() {
        val fixture = fixture()
        val created = fixture.service.create(fixture.customerId, fixture.orderId, 7, 3, "create-confirm")
        val dueService = fixture.serviceAt("2026-08-26T00:00:00Z")
        dueService.runScheduler()
        val proposal = dueService.listProposals(fixture.customerId, 0, 20).items.single()

        val confirmation = dueService.confirm(
            fixture.customerId,
            created.id,
            proposal.id,
            "confirm-proposal",
        )
        assertTrue(confirmation.canReorder)
        assertTrue(confirmation.providerServiceable)
        assertEquals(fixture.orderId, confirmation.originalOrderId)
        assertEquals(3, confirmation.items.single().quantity)
        assertEquals(9000L, confirmation.items.single().unitPricePaise)
        assertEquals(RenewalProposalStatus.CONFIRMED, confirmation.proposal.status)
        assertEquals(created.nextOrderAt, confirmation.subscription.nextOrderAt)

        val normalOrder = ProductOrder(
            id = UUID.randomUUID(),
            customerId = fixture.customerId,
            outletId = fixture.outletId,
            lines = mapOf(fixture.listingId to 3),
            grandTotalPaise = 27_000,
            status = OrderStatus.PLACED,
            history = emptyList(),
            fulfilmentMode = "STORE_PICKUP",
        )
        val completed = dueService.completeWithOrder(
            fixture.customerId,
            proposal.id,
            normalOrder,
            "checkout:${normalOrder.id}",
            "test",
        )
        assertEquals(RenewalProposalStatus.ORDER_CREATED, completed.status)
        assertEquals(normalOrder.id, completed.orderId)
        assertEquals(
            Instant.parse("2026-09-02T00:00:00Z"),
            dueService.list(fixture.customerId, 0, 20).items.single().nextOrderAt,
        )
    }

    @Test
    fun `stock changes fail revalidation and never advance schedule`() {
        val fixture = fixture(stock = 2)
        val created = fixture.service.create(fixture.customerId, fixture.orderId, 7, 3, "create-low-stock")
        val dueService = fixture.serviceAt("2026-08-26T00:00:00Z")
        dueService.runScheduler()
        val proposal = dueService.listProposals(fixture.customerId, 0, 20).items.single()

        val confirmation = dueService.confirm(
            fixture.customerId,
            created.id,
            proposal.id,
            "confirm-low-stock",
        )
        assertFalse(confirmation.canReorder)
        assertEquals("INSUFFICIENT_STOCK", confirmation.items.single().failureReason)
        assertEquals(RenewalProposalStatus.REVALIDATION_FAILED, confirmation.proposal.status)
        assertEquals(created.nextOrderAt, dueService.list(fixture.customerId, 0, 20).items.single().nextOrderAt)
    }

    @Test
    fun `pause skip cancel are retry safe and foreign customer cannot mutate or read proposal`() {
        val fixture = fixture()
        val created = fixture.service.create(fixture.customerId, fixture.orderId, 15, 1, "create-actions")
        val foreign = UUID.randomUUID()

        assertEquals("RESOURCE_NOT_FOUND", codeOf {
            fixture.service.update(foreign, created.id, "PAUSE", null, null, null, "foreign-pause")
        })
        val skipped = fixture.service.update(
            fixture.customerId,
            created.id,
            "SKIP",
            null,
            null,
            null,
            "skip-once",
        )
        val skipReplay = fixture.service.update(
            fixture.customerId,
            created.id,
            "SKIP",
            null,
            null,
            null,
            "skip-once",
        )
        assertEquals(skipped.nextOrderAt, skipReplay.nextOrderAt)
        assertEquals(Instant.parse("2026-09-18T00:00:00Z"), skipped.nextOrderAt)

        val paused = fixture.service.update(
            fixture.customerId, created.id, "PAUSE", null, null, null, "pause-once",
        )
        assertEquals(RecurringOrderStatus.PAUSED, paused.status)
        val resumed = fixture.service.update(
            fixture.customerId, created.id, "RESUME", null, null, null, "resume-once",
        )
        assertEquals(RecurringOrderStatus.ACTIVE, resumed.status)
        val cancelled = fixture.service.update(
            fixture.customerId, created.id, "CANCEL", null, null, null, "cancel-once",
        )
        assertEquals(RecurringOrderStatus.CANCELLED, cancelled.status)
        assertEquals("RECURRING_STATE_INVALID", codeOf {
            fixture.service.update(fixture.customerId, created.id, "RESUME", null, null, null, "resume-cancelled")
        })

        val dueFixture = fixture()
        val due = dueFixture.service.create(dueFixture.customerId, dueFixture.orderId, 7, 1, "create-idor")
        val scheduler = dueFixture.serviceAt("2026-08-26T00:00:00Z")
        scheduler.runScheduler()
        val proposal = scheduler.listProposals(dueFixture.customerId, 0, 20).items.single()
        assertEquals("RESOURCE_NOT_FOUND", codeOf { scheduler.getProposal(foreign, due.id, proposal.id) })
    }

    @Test
    fun `pagination is bounded and transition history is durable projection`() {
        val fixture = fixture()
        val created = fixture.service.create(fixture.customerId, fixture.orderId, 30, 1, "history-create")
        fixture.service.update(fixture.customerId, created.id, "PAUSE", null, null, null, "history-pause")

        assertEquals("PAGE_SIZE_INVALID", codeOf { fixture.service.list(fixture.customerId, -1, 20) })
        assertEquals("PAGE_SIZE_INVALID", codeOf { fixture.service.list(fixture.customerId, 0, 101) })
        assertFalse(fixture.service.list(fixture.customerId, 0, 20).hasNext)
        assertEquals(listOf("PAUSED", "SUBSCRIPTION_CREATED"), fixture.service.history(fixture.customerId, created.id).map { it.eventType })
    }

    private fun fixture(stock: Int = 100): Fixture {
        val customerId = UUID.randomUUID()
        val providers = ProviderService()
        val merchant = Principal(UUID.randomUUID(), Role.MERCHANT)
        val submitted = providers.submitOutlet(
            merchant,
            "Happy Pets",
            setOf(ProviderCapability.PRODUCT_STORE),
            setOf("517501"),
            "submit-recurring-store",
        )
        val outlet = providers.approveOutlet(
            Principal(
                UUID.randomUUID(),
                Role.ADMIN,
                permissions = setOf(AdminPermission.PROVIDER_REVIEW),
            ),
            submitted.id,
            "approve-recurring-store",
        )
        val catalog = CatalogService()
        val listing = catalog.createListing(
            CreateListingCommand(
                organizationId = outlet.organizationId,
                outletId = outlet.id,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "REC-${UUID.randomUUID().toString().take(16)}",
                name = "Dog Food",
                kind = ListingKind.PRODUCT,
                mrpPaise = 10_000,
                sellingPricePaise = 9_000,
                capabilities = outlet.capabilities,
                category = "food",
            ),
            "create-recurring-listing",
        )
        val inventory = InventoryService()
        inventory.adjust(listing.id, stock, StockReason.RECEIPT, "recurring-stock-$stock")
        val customerData = CustomerDataService(InMemoryCustomerDataPersistence(), fixedClock("2026-08-19T00:00:00Z"))
        val orderId = UUID.randomUUID()
        val snapshot = CustomerOrderDetailSnapshot(
            orderId = orderId,
            orderNumber = "MP-1001",
            outletId = outlet.id,
            quoteId = UUID.randomUUID(),
            items = listOf(CustomerOrderLineSnapshot(listing.id, listing.name, 1, 8_500)),
            grandTotalPaise = 8_500,
            platformFeePaise = 0,
            paymentMethod = "PAY_ON_FULFILMENT",
            paymentStatus = "NOT_REQUIRED",
            fulfilmentMode = "STORE_PICKUP",
            status = OrderStatus.DELIVERED,
            placedAt = Instant.parse("2026-08-01T00:00:00Z"),
            statusHistory = emptyList(),
        )
        val query = FakeOrderQuery(customerId, snapshot)
        val persistence = InMemoryRecurringOrderPersistence()
        val service = RecurringOrderService(
            persistence,
            query,
            catalog,
            providers,
            customerData,
            inventory,
            fixedClock("2026-08-19T00:00:00Z"),
        )
        return Fixture(
            customerId,
            orderId,
            outlet.id,
            listing.id,
            persistence,
            query,
            catalog,
            providers,
            customerData,
            inventory,
            service,
        )
    }

    private fun Fixture.serviceAt(value: String) = RecurringOrderService(
        persistence,
        query,
        catalog,
        providers,
        customerData,
        inventory,
        fixedClock(value),
    )

    private fun fixedClock(value: String) = Clock.fixed(Instant.parse(value), ZoneOffset.UTC)

    private fun codeOf(block: () -> Unit): String = assertThrows(DomainException::class.java, block).code

    private data class Fixture(
        val customerId: UUID,
        val orderId: UUID,
        val outletId: UUID,
        val listingId: UUID,
        val persistence: InMemoryRecurringOrderPersistence,
        val query: FakeOrderQuery,
        val catalog: CatalogService,
        val providers: ProviderService,
        val customerData: CustomerDataService,
        val inventory: InventoryService,
        val service: RecurringOrderService,
    )

    private class FakeOrderQuery(
        private val ownerId: UUID,
        private val snapshot: CustomerOrderDetailSnapshot,
    ) : CustomerOrderQuery {
        override fun list(
            customerId: UUID,
            status: OrderStatus?,
            page: Int,
            pageSize: Int,
            category: CustomerOrderCategory?,
            cursor: CustomerOrderCursor?,
        ) = CustomerOrderSummaryPage(emptyList(), false)

        override fun detail(customerId: UUID, orderId: UUID): CustomerOrderDetailSnapshot? =
            snapshot.takeIf { customerId == ownerId && orderId == snapshot.orderId }
    }
}
