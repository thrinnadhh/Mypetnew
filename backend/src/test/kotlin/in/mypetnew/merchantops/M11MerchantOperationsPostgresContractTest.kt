package `in`.mypetnew.merchantops

import `in`.mypetnew.application.web.MerchantOperationsController
import `in`.mypetnew.application.web.MerchantAppointmentInboxController
import `in`.mypetnew.application.web.StaffGrantRequest
import `in`.mypetnew.application.web.StaffRevokeRequest
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.appointment.infrastructure.MerchantAppointmentQuery
import `in`.mypetnew.identity.infrastructure.JdbcMerchantPrincipalResolver
import `in`.mypetnew.merchantops.domain.MerchantOperationsService
import `in`.mypetnew.merchantops.infrastructure.JdbcMerchantOperationsPersistence
import `in`.mypetnew.merchantops.infrastructure.MerchantNotificationRecipientQuery
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

@MerchantOpsContract
@MerchantOpsPostgres
class M11MerchantOperationsPostgresContractTest {
    @Test
    fun `dashboard aggregates canonical rows only across current authorized active outlets`() {
        val context = context()
        val owner = context.merchant("Owner")
        val scope = context.organization(owner, "M11 scope")
        val first = context.outlet(scope, "First", owner, MerchantPermission.OWNER)
        val second = context.outlet(scope, "Second", owner, MerchantPermission.OWNER)
        val sameOrganizationButUnauthorized = context.outlet(scope, "Not granted")

        context.listing(first, active = true, onHand = 0)
        context.listing(first, active = true, onHand = 3)
        context.listing(first, active = true, onHand = 12, reserved = 2)
        context.listing(first, active = false, onHand = 0)
        context.listing(second, active = true, onHand = 5)
        context.listing(sameOrganizationButUnauthorized, active = true, onHand = 0)

        context.appointment(first, "BOOKED")
        context.appointment(second, "BOOKED")
        context.appointment(first, "CONFIRMED")
        context.appointment(sameOrganizationButUnauthorized, "BOOKED")

        context.order(first, "PLACED")
        context.order(first, "PICKED_UP")
        context.order(second, "PREPARING")
        context.order(first, "DELIVERED")
        context.order(sameOrganizationButUnauthorized, "PLACED")

        val response = context.controller.dashboard(context.authentication(owner), null)

        assertEquals(listOf(first, second).sortedBy(UUID::toString), response.outletIds)
        assertEquals(2L, response.metrics.pendingAppointments)
        assertEquals(4L, response.metrics.activeCatalog)
        assertEquals(2L, response.metrics.lowStockInventory)
        assertEquals(1L, response.metrics.outOfStockInventory)
        assertEquals(3L, response.metrics.orderWork)
        assertEquals(5, response.metrics.lowStockThreshold)
        assertTrue(response.generatedAt <= Instant.now())

        val selected = context.controller.dashboard(context.authentication(owner), first)
        assertEquals(listOf(first), selected.outletIds)
        assertEquals(1L, selected.metrics.pendingAppointments)
        assertEquals(3L, selected.metrics.activeCatalog)
        assertEquals(1L, selected.metrics.lowStockInventory)
        assertEquals(1L, selected.metrics.outOfStockInventory)
        assertEquals(2L, selected.metrics.orderWork)

        val boundedOrderWork = context.controller.orderWork(context.authentication(owner), null, 0, 1)
        assertEquals(1, boundedOrderWork.items.size)
        assertTrue(boundedOrderWork.hasNext)
        assertEquals(
            "PAGE_SIZE_INVALID",
            assertThrows(DomainException::class.java) {
                context.controller.orderWork(context.authentication(owner), null, 0, 101)
            }.code,
        )
    }

    @Test
    fun `dashboard rejects cross tenant and stale revoked outlet authority`() {
        val context = context()
        val ownerA = context.merchant("Owner A")
        val organizationA = context.organization(ownerA, "A")
        val outletA = context.outlet(organizationA, "A", ownerA, MerchantPermission.OWNER)
        val stale = context.authentication(ownerA)

        val ownerB = context.merchant("Owner B")
        val organizationB = context.organization(ownerB, "B")
        val outletB = context.outlet(organizationB, "B", ownerB, MerchantPermission.OWNER)

        assertEquals(
            "RESOURCE_NOT_FOUND",
            assertThrows(DomainException::class.java) {
                context.controller.dashboard(stale, outletB)
            }.code,
        )

        context.jdbc.update(
            "UPDATE mypet.merchant_staff SET active = FALSE WHERE account_id = ? AND outlet_id = ?",
            ownerA,
            outletA,
        )
        assertEquals(
            "RESOURCE_NOT_FOUND",
            assertThrows(DomainException::class.java) {
                context.controller.dashboard(stale, outletA)
            }.code,
        )
    }

    @Test
    fun `staff grants re-enable and revoke exact permissions while canonical owner remains immutable`() {
        val context = context()
        val owner = context.merchant("Owner")
        val organization = context.organization(owner, "Staff org")
        val outlet = context.outlet(organization, "Staff outlet", owner, MerchantPermission.OWNER)
        val target = context.merchant("Target")

        val granted = context.controller.grantStaff(
            context.authentication(owner),
            StaffGrantRequest(outlet, target, MerchantPermission.CATALOG_WRITE),
        )
        assertTrue(granted.active)
        assertEquals(target, granted.accountId)
        assertEquals(outlet, granted.outletId)
        assertEquals(MerchantPermission.CATALOG_WRITE, granted.permission)

        val page = context.controller.listStaff(context.authentication(owner), outlet, 0, 100)
        assertEquals(2, page.items.size)
        assertFalse(page.hasNext)

        val revoked = context.controller.revokeStaff(
            context.authentication(owner),
            target,
            MerchantPermission.CATALOG_WRITE,
            StaffRevokeRequest(outlet),
        )
        assertFalse(revoked.active)

        val reenabled = context.controller.grantStaff(
            context.authentication(owner),
            StaffGrantRequest(outlet, target, MerchantPermission.CATALOG_WRITE),
        )
        assertTrue(reenabled.active)

        assertEquals(
            "OWNER_PERMISSION_IMMUTABLE",
            assertThrows(DomainException::class.java) {
                context.controller.revokeStaff(
                    context.authentication(owner),
                    owner,
                    MerchantPermission.OWNER,
                    StaffRevokeRequest(outlet),
                )
            }.code,
        )
        assertEquals(
            "OWNER_PERMISSION_IMMUTABLE",
            assertThrows(DomainException::class.java) {
                context.controller.grantStaff(
                    context.authentication(owner),
                    StaffGrantRequest(outlet, target, MerchantPermission.OWNER),
                )
            }.code,
        )
    }

    @Test
    fun `staff management denies cross outlet escalation conflicting organizations and revoked actors`() {
        val context = context()
        val owner = context.merchant("Owner")
        val organization = context.organization(owner, "Primary")
        val outlet = context.outlet(organization, "Primary", owner, MerchantPermission.OWNER)
        val manager = context.merchant("Manager")
        context.grant(organization, outlet, manager, MerchantPermission.OUTLET_MANAGE)
        val target = context.merchant("Target")

        context.controller.grantStaff(
            context.authentication(manager),
            StaffGrantRequest(outlet, target, MerchantPermission.INVENTORY_WRITE),
        )
        assertEquals(
            "OWNER_PERMISSION_IMMUTABLE",
            assertThrows(DomainException::class.java) {
                context.controller.grantStaff(
                    context.authentication(manager),
                    StaffGrantRequest(outlet, target, MerchantPermission.OWNER),
                )
            }.code,
        )

        val foreignOwner = context.merchant("Foreign owner")
        val foreignOrganization = context.organization(foreignOwner, "Foreign")
        val foreignOutlet = context.outlet(
            foreignOrganization,
            "Foreign",
            foreignOwner,
            MerchantPermission.OWNER,
        )
        assertEquals(
            "RESOURCE_NOT_FOUND",
            assertThrows(DomainException::class.java) {
                context.controller.grantStaff(
                    context.authentication(owner),
                    StaffGrantRequest(foreignOutlet, target, MerchantPermission.CATALOG_WRITE),
                )
            }.code,
        )

        val conflicting = context.merchant("Conflicting")
        context.grant(foreignOrganization, foreignOutlet, conflicting, MerchantPermission.CATALOG_WRITE)
        assertEquals(
            "STAFF_ORGANIZATION_CONFLICT",
            assertThrows(DomainException::class.java) {
                context.controller.grantStaff(
                    context.authentication(owner),
                    StaffGrantRequest(outlet, conflicting, MerchantPermission.CATALOG_WRITE),
                )
            }.code,
        )

        val staleManager = context.authentication(manager)
        context.jdbc.update(
            "UPDATE mypet.merchant_staff SET active = FALSE WHERE account_id = ? AND outlet_id = ?",
            manager,
            outlet,
        )
        assertEquals(
            "RESOURCE_NOT_FOUND",
            assertThrows(DomainException::class.java) {
                context.controller.grantStaff(
                    staleManager,
                    StaffGrantRequest(outlet, target, MerchantPermission.ORDER_FULFIL),
                )
            }.code,
        )

        assertEquals(
            "PAGE_SIZE_INVALID",
            assertThrows(DomainException::class.java) {
                context.controller.listStaff(context.authentication(owner), outlet, 0, 101)
            }.code,
        )
    }

    @Test
    fun `notification inbox is bounded recipient scoped deduplicated and resource scoped`() {
        val context = context()
        val owner = context.merchant("Owner")
        val organization = context.organization(owner, "Notifications")
        val outlet = context.outlet(organization, "Notifications", owner, MerchantPermission.OWNER)
        val fulfiller = context.merchant("Fulfiller")
        val catalogOnly = context.merchant("Catalog only")
        val revokedFulfiller = context.merchant("Revoked fulfiller")
        context.grant(organization, outlet, fulfiller, MerchantPermission.ORDER_FULFIL)
        context.grant(organization, outlet, catalogOnly, MerchantPermission.CATALOG_WRITE)
        context.grant(organization, outlet, revokedFulfiller, MerchantPermission.ORDER_FULFIL)
        context.jdbc.update(
            "UPDATE mypet.merchant_staff SET active = FALSE WHERE account_id = ? AND outlet_id = ?",
            revokedFulfiller,
            outlet,
        )
        val appointment = context.appointment(outlet, "BOOKED")
        val secondAppointment = context.appointment(outlet, "BOOKED")

        val foreignOwner = context.merchant("Foreign owner")
        val foreignOrganization = context.organization(foreignOwner, "Foreign notifications")
        val foreignOutlet = context.outlet(
            foreignOrganization,
            "Foreign notifications",
            foreignOwner,
            MerchantPermission.OWNER,
        )
        val foreignAppointment = context.appointment(foreignOutlet, "BOOKED")

        assertEquals(
            setOf(owner, fulfiller),
            context.notificationRecipients.appointmentRecipients(organization, outlet).toSet(),
        )

        assertEquals(1, context.notification(owner, appointment, "merchant-appointment-booked-v1"))
        assertEquals(0, context.notification(owner, appointment, "merchant-appointment-booked-v1"))
        assertEquals(1, context.notification(owner, secondAppointment, "merchant-appointment-cancelled-v1"))
        context.notification(foreignOwner, appointment, "merchant-appointment-booked-v1")
        context.notification(owner, foreignAppointment, "merchant-appointment-booked-v1")

        val firstPage = context.controller.notifications(context.authentication(owner), null, 0, 1)
        assertEquals(1, firstPage.items.size)
        assertTrue(firstPage.hasNext)
        val all = context.controller.notifications(context.authentication(owner), outlet, 0, 100)
        assertEquals(setOf(appointment, secondAppointment), all.items.map { it.resourceId }.toSet())
        assertFalse(all.hasNext)
        assertEquals(
            "PAGE_SIZE_INVALID",
            assertThrows(DomainException::class.java) {
                context.controller.notifications(context.authentication(owner), outlet, 0, 101)
            }.code,
        )
    }

    @Test
    fun `appointment deep links reauthorize and foreign stale identifiers fail closed`() {
        val context = context()
        val owner = context.merchant("Owner")
        val organization = context.organization(owner, "Appointments")
        val outlet = context.outlet(organization, "Appointments", owner, MerchantPermission.OWNER)
        val ownedAppointment = context.appointment(outlet, "BOOKED")
        val stale = context.authentication(owner)

        val foreignOwner = context.merchant("Foreign owner")
        val foreignOrganization = context.organization(foreignOwner, "Foreign appointments")
        val foreignOutlet = context.outlet(
            foreignOrganization,
            "Foreign appointments",
            foreignOwner,
            MerchantPermission.OWNER,
        )
        val foreignAppointment = context.appointment(foreignOutlet, "BOOKED")

        assertEquals(ownedAppointment, context.appointments.get(stale, ownedAppointment).appointmentId)
        assertEquals(
            "RESOURCE_NOT_FOUND",
            assertThrows(DomainException::class.java) {
                context.appointments.get(stale, foreignAppointment)
            }.code,
        )

        context.jdbc.update("UPDATE mypet.provider_outlet SET status = 'SUSPENDED' WHERE id = ?", outlet)
        assertEquals(
            "RESOURCE_NOT_FOUND",
            assertThrows(DomainException::class.java) {
                context.appointments.get(stale, ownedAppointment)
            }.code,
        )
        context.jdbc.update("UPDATE mypet.provider_outlet SET status = 'ACTIVE' WHERE id = ?", outlet)

        context.jdbc.update(
            "UPDATE mypet.merchant_staff SET active = FALSE WHERE account_id = ? AND outlet_id = ?",
            owner,
            outlet,
        )
        assertEquals(
            "RESOURCE_NOT_FOUND",
            assertThrows(DomainException::class.java) {
                context.appointments.get(stale, ownedAppointment)
            }.code,
        )
    }

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val jdbcClient = JdbcClient.create(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val persistence = JdbcMerchantOperationsPersistence(jdbcClient, transactions)
        val service = MerchantOperationsService(persistence)
        val resolver = JdbcMerchantPrincipalResolver(jdbcClient)
        return Context(
            jdbc,
            resolver,
            MerchantOperationsController(service, resolver),
            MerchantAppointmentInboxController(MerchantAppointmentQuery(jdbcClient), resolver),
            MerchantNotificationRecipientQuery(jdbcClient),
        )
    }

    private class Context(
        val jdbc: JdbcTemplate,
        private val resolver: JdbcMerchantPrincipalResolver,
        val controller: MerchantOperationsController,
        val appointments: MerchantAppointmentInboxController,
        val notificationRecipients: MerchantNotificationRecipientQuery,
    ) {
        private val sequence = AtomicInteger()

        fun merchant(label: String): UUID = account("MERCHANT", label)

        fun organization(owner: UUID, label: String): UUID = UUID.randomUUID().also { id ->
            jdbc.update(
                "INSERT INTO mypet.merchant_organization(id, name, status, owner_actor_id) VALUES (?, ?, 'ACTIVE', ?)",
                id,
                label,
                owner,
            )
        }

        fun outlet(
            organizationId: UUID,
            label: String,
            accountId: UUID? = null,
            permission: MerchantPermission? = null,
        ): UUID = UUID.randomUUID().also { id ->
            jdbc.update(
                "INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, ?, 'ACTIVE', TRUE)",
                id,
                organizationId,
                label,
            )
            if (accountId != null && permission != null) grant(organizationId, id, accountId, permission)
        }

        fun grant(
            organizationId: UUID,
            outletId: UUID,
            accountId: UUID,
            permission: MerchantPermission,
        ) {
            jdbc.update(
                "INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, ?, TRUE)",
                accountId,
                organizationId,
                outletId,
                permission.name,
            )
        }

        fun listing(outletId: UUID, active: Boolean, onHand: Int, reserved: Int = 0): UUID {
            val organizationId = organizationFor(outletId)
            val id = UUID.randomUUID()
            jdbc.update(
                """
                INSERT INTO mypet.catalog_listing(
                    id, organization_id, outlet_id, barcode_type, normalized_barcode, name,
                    listing_kind, commerce_mode, mrp_paise, selling_price_paise, active
                ) VALUES (?, ?, ?, 'INTERNAL', ?, ?, 'PRODUCT', 'COMMERCE', 10000, 9000, ?)
                """.trimIndent(),
                id,
                organizationId,
                outletId,
                "M11-$id",
                "M11 listing $id",
                active,
            )
            jdbc.update(
                "UPDATE mypet.inventory_balance SET on_hand = ?, reserved = ? WHERE listing_id = ?",
                onHand,
                reserved,
                id,
            )
            return id
        }

        fun appointment(outletId: UUID, status: String): UUID {
            val organizationId = organizationFor(outletId)
            val customer = account("CUSTOMER", "Appointment customer")
            val pet = UUID.randomUUID()
            val service = UUID.randomUUID()
            val slot = UUID.randomUUID()
            val appointment = UUID.randomUUID()
            jdbc.update(
                "INSERT INTO mypet.customer_pet(id, customer_id, name, species, created_at, updated_at) VALUES (?, ?, 'Milo', 'DOG', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                pet,
                customer,
            )
            jdbc.update(
                "INSERT INTO mypet.service_offering(id, organization_id, outlet_id, capability, name, duration_minutes, price_paise) VALUES (?, ?, ?, 'GROOMING', 'Grooming', 30, 50000)",
                service,
                organizationId,
                outletId,
            )
            jdbc.update(
                "INSERT INTO mypet.service_slot(id, service_id, starts_at, ends_at) VALUES (?, ?, CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP + INTERVAL '1 day 30 minutes')",
                slot,
                service,
            )
            jdbc.update(
                """
                INSERT INTO mypet.appointment(
                    id, customer_id, pet_id, organization_id, outlet_id, service_id, slot_id,
                    service_name, outlet_name, pet_name, starts_at, ends_at, status,
                    payment_method, payment_status, payment_mode, payment_state,
                    price_paise, notes, idempotency_key, request_fingerprint
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Grooming', 'Outlet', 'Milo',
                    CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP + INTERVAL '1 day 30 minutes', ?,
                    'PAY_AT_PROVIDER', 'NOT_REQUIRED', 'PAY_AT_PROVIDER', 'NOT_REQUIRED',
                    50000, NULL, ?, ?)
                """.trimIndent(),
                appointment,
                customer,
                pet,
                organizationId,
                outletId,
                service,
                slot,
                status,
                "m11-appointment-$appointment",
                appointment.toString().replace("-", ""),
            )
            return appointment
        }

        fun notification(recipientId: UUID, resourceId: UUID, templateVersion: String): Int {
            val sourceEventId = UUID.nameUUIDFromBytes("$resourceId:$templateVersion".toByteArray())
            return jdbc.update(
                """
                INSERT INTO mypet.notification_item(
                    id, source_event_id, recipient_id, event_type, template_version,
                    safe_route, resource_id, title, body
                ) VALUES (?, ?, ?, ?, ?, 'merchant/appointments/detail', ?, 'Appointment update', 'Open MyPet Merchant for details.')
                ON CONFLICT DO NOTHING
                """.trimIndent(),
                UUID.randomUUID(),
                sourceEventId,
                recipientId,
                templateVersion.substringBefore("-v"),
                templateVersion,
                resourceId,
            )
        }

        fun order(outletId: UUID, status: String) {
            val organizationId = organizationFor(outletId)
            val customer = account("CUSTOMER", "Order customer")
            val quote = UUID.randomUUID()
            val order = UUID.randomUUID()
            jdbc.update(
                """
                INSERT INTO mypet.commerce_quote(
                    id, customer_id, outlet_id, cart_signature, fulfilment_mode, payment_method,
                    item_subtotal_paise, platform_fee_paise, merchant_commission_paise,
                    delivery_fee_paise, grand_total_paise, currency, rule_version, expires_at
                ) VALUES (?, ?, ?, ?, 'STORE_PICKUP', 'PAY_ON_FULFILMENT',
                    10000, 0, 0, 0, 10000, 'INR', 'm11-v1', CURRENT_TIMESTAMP + INTERVAL '1 day')
                """.trimIndent(),
                quote,
                customer,
                outletId,
                "m11-$quote",
            )
            jdbc.update(
                """
                INSERT INTO mypet.product_order(
                    id, order_number, customer_id, organization_id, outlet_id, quote_id, status,
                    fulfilment_mode, payment_method, payment_status, grand_total_paise,
                    platform_fee_paise, merchant_commission_paise, currency
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'STORE_PICKUP', 'PAY_ON_FULFILMENT',
                    'PENDING_EXTERNAL_COLLECTION', 10000, 0, 0, 'INR')
                """.trimIndent(),
                order,
                "M11-${order.toString().replace("-", "").take(12)}",
                customer,
                organizationId,
                outletId,
                quote,
                status,
            )
        }

        fun authentication(accountId: UUID): UsernamePasswordAuthenticationToken {
            val principal = resolver.resolve(accountId, UUID.randomUUID())
            return UsernamePasswordAuthenticationToken(principal, null, emptyList())
        }

        private fun account(role: String, label: String): UUID = UUID.randomUUID().also { id ->
            val number = sequence.incrementAndGet()
            jdbc.update(
                "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, ?, 'ACTIVE')",
                id,
                "+918${number.toString().padStart(9, '0')}",
                role,
            )
            check(label.isNotBlank())
        }

        private fun organizationFor(outletId: UUID): UUID = jdbc.queryForObject(
            "SELECT organization_id FROM mypet.provider_outlet WHERE id = ?",
            UUID::class.java,
            outletId,
        ) ?: error("Missing outlet")
    }
}
