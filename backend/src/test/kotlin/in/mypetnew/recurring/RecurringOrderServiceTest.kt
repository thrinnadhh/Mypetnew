package `in`.mypetnew.recurring

import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.commerce.domain.CustomerOrderCategory
import `in`.mypetnew.commerce.domain.CustomerOrderCursor
import `in`.mypetnew.commerce.domain.CustomerOrderDetailSnapshot
import `in`.mypetnew.commerce.domain.CustomerOrderLineSnapshot
import `in`.mypetnew.commerce.domain.CustomerOrderQuery
import `in`.mypetnew.commerce.domain.CustomerOrderSummaryPage
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.customer.domain.CustomerAddressInput
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.customer.domain.InMemoryCustomerDataPersistence
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.recurring.domain.InMemoryRecurringOrderPersistence
import `in`.mypetnew.recurring.domain.RecurringOrderService
import `in`.mypetnew.recurring.domain.RecurringOrderStatus
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
    fun `create derives owned source provider address and blocks foreign or duplicate sources`() {
        val fixture = fixture()
        val created = fixture.service.create(fixture.customerId, fixture.orderId, 30, 2)

        assertEquals(fixture.customerId, created.customerId)
        assertEquals(fixture.outletId, created.providerId)
        assertEquals(fixture.addressId, created.deliveryAddressId)
        assertEquals(RecurringOrderStatus.ACTIVE, created.status)
        assertEquals(Instant.parse("2026-09-18T00:00:00Z"), created.nextOrderAt)

        assertEquals("RECURRING_ALREADY_EXISTS", codeOf {
            fixture.service.create(fixture.customerId, fixture.orderId, 30, 1)
        })
        assertEquals("RESOURCE_NOT_FOUND", codeOf {
            fixture.service.create(UUID.randomUUID(), fixture.orderId, 30, 1)
        })
        assertEquals("RECURRING_CADENCE_INVALID", codeOf {
            fixture.service.create(fixture.customerId, UUID.randomUUID(), 10, 1)
        })
    }

    @Test
    fun `due reminder requires confirmation and returns current server price without creating an order`() {
        val fixture = fixture()
        val created = fixture.service.create(fixture.customerId, fixture.orderId, 7, 3)
        val dueService = fixture.serviceAt("2026-08-27T00:00:00Z")

        val due = dueService.list(fixture.customerId, 0, 20).items.single()
        assertEquals(RecurringOrderStatus.AWAITING_CONFIRMATION, due.status)

        val confirmation = dueService.confirm(fixture.customerId, created.id)
        assertTrue(confirmation.canReorder)
        assertTrue(confirmation.providerServiceable)
        assertEquals(fixture.orderId, confirmation.originalOrderId)
        assertEquals(3, confirmation.items.single().quantity)
        assertEquals(9000, confirmation.items.single().unitPricePaise)
        assertEquals(RecurringOrderStatus.ACTIVE, confirmation.subscription.status)
        assertEquals(Instant.parse("2026-09-03T00:00:00Z"), confirmation.subscription.nextOrderAt)
    }

    @Test
    fun `update is customer isolated and cancelled reminders cannot be resumed`() {
        val fixture = fixture()
        val created = fixture.service.create(fixture.customerId, fixture.orderId, 15, 1)

        assertEquals("RESOURCE_NOT_FOUND", codeOf {
            fixture.service.update(UUID.randomUUID(), created.id, "PAUSE", null, null, null)
        })
        val paused = fixture.service.update(fixture.customerId, created.id, "PAUSE", null, null, null)
        assertEquals(RecurringOrderStatus.PAUSED, paused.status)
        val resumed = fixture.service.update(fixture.customerId, created.id, "RESUME", null, null, null)
        assertEquals(RecurringOrderStatus.ACTIVE, resumed.status)
        val cancelled = fixture.service.update(fixture.customerId, created.id, "CANCEL", null, null, null)
        assertEquals(RecurringOrderStatus.CANCELLED, cancelled.status)
        assertEquals("RECURRING_STATE_INVALID", codeOf {
            fixture.service.update(fixture.customerId, created.id, "RESUME", null, null, null)
        })
    }

    @Test
    fun `list pagination is bounded`() {
        val fixture = fixture()
        assertEquals("PAGE_SIZE_INVALID", codeOf { fixture.service.list(fixture.customerId, -1, 20) })
        assertEquals("PAGE_SIZE_INVALID", codeOf { fixture.service.list(fixture.customerId, 0, 101) })
        assertFalse(fixture.service.list(fixture.customerId, 0, 20).hasNext)
    }

    private fun fixture(): Fixture {
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
                barcode = "RECURRING-DOG-FOOD",
                name = "Dog Food",
                kind = ListingKind.PRODUCT,
                mrpPaise = 10000,
                sellingPricePaise = 9000,
                capabilities = outlet.capabilities,
                category = "food",
            ),
            "create-recurring-listing",
        )
        val customerData = CustomerDataService(InMemoryCustomerDataPersistence(), fixedClock("2026-08-19T00:00:00Z"))
        val address = customerData.createAddress(
            customerId,
            CustomerAddressInput(
                label = "Home",
                recipientName = "Customer",
                phoneNumber = "+919876543210",
                line1 = "Main Road 1",
                line2 = null,
                city = "Tirupati",
                state = "Andhra Pradesh",
                pincode = "517501",
                isDefault = true,
            ),
        )
        val orderId = UUID.randomUUID()
        val snapshot = CustomerOrderDetailSnapshot(
            orderId = orderId,
            orderNumber = "MP-1001",
            outletId = outlet.id,
            quoteId = UUID.randomUUID(),
            items = listOf(CustomerOrderLineSnapshot(listing.id, listing.name, 1, 8500)),
            grandTotalPaise = 8500,
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
            fixedClock("2026-08-19T00:00:00Z"),
        )
        return Fixture(customerId, orderId, outlet.id, address.id, persistence, query, catalog, providers, customerData, service)
    }

    private fun Fixture.serviceAt(value: String) = RecurringOrderService(
        persistence,
        query,
        catalog,
        providers,
        customerData,
        fixedClock(value),
    )

    private fun fixedClock(value: String) = Clock.fixed(Instant.parse(value), ZoneOffset.UTC)

    private fun codeOf(block: () -> Unit): String = assertThrows(DomainException::class.java, block).code

    private data class Fixture(
        val customerId: UUID,
        val orderId: UUID,
        val outletId: UUID,
        val addressId: UUID,
        val persistence: InMemoryRecurringOrderPersistence,
        val query: FakeOrderQuery,
        val catalog: CatalogService,
        val providers: ProviderService,
        val customerData: CustomerDataService,
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
