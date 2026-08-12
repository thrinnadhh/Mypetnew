package `in`.mypetnew.persistence

import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
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
        assertEquals(9, result.migrationsExecuted)

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
                "inventory_balance",
                "inventory_movement",
                "product_order",
                "pos_sale",
                "loyalty_source",
                "outbox_event",
                "device_registration",
                "audit_event",
            )), "tables=$tables")

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
                listing_kind, commerce_mode, mrp_paise, selling_price_paise, active
            ) values (?, ?, ?, 'GTIN_13', ?, 'Food', 'PRODUCT', 'COMMERCE', 15000, 12500, true)
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
