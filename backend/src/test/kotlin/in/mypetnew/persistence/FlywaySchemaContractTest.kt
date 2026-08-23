package `in`.mypetnew.persistence

import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.core.io.support.PathMatchingResourcePatternResolver
import java.sql.DriverManager
import java.util.UUID

class FlywaySchemaContractTest {
    @Test
    fun `clean migration creates private Sprint 1 schema and database-backed invariants`() {
        val url = "jdbc:h2:mem:migration-${UUID.randomUUID()};MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
        val flyway = Flyway.configure()
            .dataSource(url, "sa", "")
            .schemas("mypet")
            .defaultSchema("mypet")
            .createSchemas(true)
            .locations("classpath:db/migration")
            .load()

        val result = flyway.migrate()
        val migrationCount = PathMatchingResourcePatternResolver()
            .getResources("classpath*:db/migration/V*.sql")
            .size
        assertEquals(migrationCount, result.migrationsExecuted)

        DriverManager.getConnection(url, "sa", "").use { connection ->
            val tables = connection.prepareStatement(
                "select table_name from information_schema.tables where lower(table_schema) = 'mypet'",
            ).use { statement ->
                statement.executeQuery().use { rows -> buildSet { while (rows.next()) add(rows.getString(1).lowercase()) } }
            }
            assertTrue(tables.containsAll(setOf(
                "identity_account",
                "provider_outlet",
                "catalog_listing",
                "catalog_listing_image",
                "inventory_balance",
                "inventory_movement",
                "product_order",
                "pos_sale",
                "pos_customer_association_challenge",
                "loyalty_source",
                "outbox_event",
                "device_registration",
                "audit_event",
                "customer_profile",
                "customer_pet",
                "customer_address",
                "customer_favourite_listing",
                "captain_delivery_state",
                "dispatch_job",
                "dispatch_offer",
                "privacy_consent",
                "privacy_rights_request",
                "account_deletion_request",
                "deleted_identity_tombstone",
                "security_incident",
                "payment",
                "payment_initiation_command",
                "payment_history",
                "payment_attempt",
                "payment_webhook_inbox",
                "payment_refund",
                "payment_refund_history",
                "service_offering",
                "service_slot",
                "appointment",
                "appointment_history",
                "appointment_payment_refund",
                "service_region",
                "service_region_pincode",
                "service_region_launch_request",
                "recurring_order_subscription",
                "recurring_order_proposal",
                "recurring_order_command",
                "recurring_order_history",
                "captain_onboarding",
                "captain_support_ticket",
            )), "tables=$tables")

            val serviceRegionCount = connection.prepareStatement(
                "select count(*) from mypet.service_region where city_identity = 'tirupati' and status = 'ACTIVE'",
            ).use { statement ->
                statement.executeQuery().use { rows -> rows.next(); rows.getInt(1) }
            }
            assertEquals(1, serviceRegionCount)

            val tirupatiPincodes = connection.prepareStatement(
                """
                select p.pincode
                from mypet.service_region_pincode p
                join mypet.service_region r on r.id = p.service_region_id
                where r.city_identity = 'tirupati' and p.active = true
                order by p.pincode
                """.trimIndent(),
            ).use { statement ->
                statement.executeQuery().use { rows -> buildList { while (rows.next()) add(rows.getString(1)) } }
            }
            assertEquals(listOf("517501", "517502", "517507"), tirupatiPincodes)

            val appointmentColumns = connection.prepareStatement(
                """
                select column_name from information_schema.columns
                where lower(table_schema) = 'mypet' and lower(table_name) = 'appointment'
                """.trimIndent(),
            ).use { statement ->
                statement.executeQuery().use { rows -> buildSet { while (rows.next()) add(rows.getString(1).lowercase()) } }
            }
            assertTrue(appointmentColumns.containsAll(setOf("payment_mode", "payment_state")), "appointmentColumns=$appointmentColumns")

            val appointmentChecks = connection.prepareStatement(
                """
                select constraint_name from information_schema.table_constraints
                where lower(table_schema) = 'mypet'
                  and lower(table_name) = 'appointment'
                  and upper(constraint_type) = 'CHECK'
                """.trimIndent(),
            ).use { statement ->
                statement.executeQuery().use { rows -> buildSet { while (rows.next()) add(rows.getString(1).lowercase()) } }
            }
            assertTrue(
                appointmentChecks.containsAll(setOf("ck_appointment_payment_mode_v2", "ck_appointment_payment_state_v2")),
                "appointmentChecks=$appointmentChecks",
            )

            val recurringColumns = connection.prepareStatement(
                """
                select column_name from information_schema.columns
                where lower(table_schema) = 'mypet' and lower(table_name) = 'recurring_order_subscription'
                """.trimIndent(),
            ).use { statement ->
                statement.executeQuery().use { rows -> buildSet { while (rows.next()) add(rows.getString(1).lowercase()) } }
            }
            assertTrue(recurringColumns.containsAll(setOf("fulfilment_mode", "time_zone", "version")))

            val proposalConstraints = connection.prepareStatement(
                """
                select constraint_name from information_schema.table_constraints
                where lower(table_schema) = 'mypet'
                  and lower(table_name) = 'recurring_order_proposal'
                """.trimIndent(),
            ).use { statement ->
                statement.executeQuery().use { rows -> buildSet { while (rows.next()) add(rows.getString(1).lowercase()) } }
            }
            assertTrue(
                proposalConstraints.containsAll(
                    setOf(
                        "uq_recurring_proposal_cycle",
                        "ck_recurring_proposal_cadence",
                        "ck_recurring_proposal_quantity",
                        "ck_recurring_proposal_mode",
                        "ck_recurring_proposal_status",
                    ),
                ),
                "proposalConstraints=$proposalConstraints",
            )

            val cadenceCheck = connection.prepareStatement(
                """
                select check_clause from information_schema.check_constraints
                where lower(constraint_schema) = 'mypet'
                  and lower(constraint_name) = 'ck_recurring_proposal_cadence'
                """.trimIndent(),
            ).use { statement ->
                statement.executeQuery().use { rows ->
                    assertTrue(rows.next(), "Recurring proposal cadence check is missing")
                    rows.getString(1)
                }
            }
            listOf("7", "15", "25", "30", "35").forEach { cadence ->
                assertTrue(cadenceCheck.contains(cadence), "cadenceCheck=$cadenceCheck")
            }

            val organizationId = UUID.randomUUID()
            val outletId = UUID.randomUUID()
            connection.prepareStatement(
                "insert into mypet.merchant_organization(id, name, status) values (?, 'A', 'ACTIVE')",
            ).use { it.setObject(1, organizationId); it.executeUpdate() }
            connection.prepareStatement(
                "insert into mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) values (?, ?, 'A1', 'ACTIVE', true)",
            ).use { it.setObject(1, outletId); it.setObject(2, organizationId); it.executeUpdate() }
            val listingId = UUID.randomUUID()
            insertListing(connection, listingId, organizationId, outletId, "4006381333931")
            assertThrows(Exception::class.java) {
                insertListing(connection, UUID.randomUUID(), organizationId, outletId, "4006381333931")
            }
            assertThrows(Exception::class.java) {
                connection.prepareStatement(
                    "insert into mypet.inventory_balance(listing_id, on_hand, reserved, version) values (?, 0, 1, 0)",
                ).use { it.setObject(1, listingId); it.executeUpdate() }
            }
        }
    }

    private fun insertListing(
        connection: java.sql.Connection,
        id: UUID,
        organizationId: UUID,
        outletId: UUID,
        barcode: String,
    ) {
        connection.prepareStatement(
            """
            insert into mypet.catalog_listing(
                id, organization_id, outlet_id, barcode_type, normalized_barcode, name,
                listing_kind, commerce_mode, mrp_paise, selling_price_paise, active, category
            ) values (?, ?, ?, 'GTIN_13', ?, 'Food', 'PRODUCT', 'COMMERCE', 15000, 12500, true, 'food')
            """.trimIndent(),
        ).use {
            it.setObject(1, id)
            it.setObject(2, organizationId)
            it.setObject(3, outletId)
            it.setString(4, barcode)
            it.executeUpdate()
        }
    }
}
