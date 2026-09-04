package `in`.mypetnew.merchantops

import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID
import javax.sql.DataSource

@MerchantOpsPostgres
class V31SecurityPostgisContractTest {
    @Test
    fun `V31 hardens trigger functions and adds additive indexed geography projections`() {
        val dataSource = PostgresTestDatabase.dataSource()
        val toV30 = flyway(dataSource, MigrationVersion.fromVersion("30"))
        toV30.clean()
        assertEquals("30", toV30.migrate().targetSchemaVersion)

        val jdbc = JdbcTemplate(dataSource)
        val actorId = UUID.randomUUID()
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, '+919399999931', 'MERCHANT', 'ACTIVE')",
            actorId,
        )
        jdbc.update(
            "INSERT INTO mypet.merchant_organization(id, name, status, owner_actor_id) VALUES (?, 'V31 Org', 'ACTIVE', ?)",
            organizationId,
            actorId,
        )
        jdbc.update(
            """
            INSERT INTO mypet.provider_outlet(
                id, organization_id, name, status, pickup_enabled, dispatch_latitude, dispatch_longitude
            ) VALUES (?, ?, 'V31 Geo Outlet', 'ACTIVE', TRUE, 13.628800, 79.419200)
            """.trimIndent(),
            outletId,
            organizationId,
        )

        // Keep this regression scoped to the V30 -> V31 upgrade even when later
        // migrations exist. Without an explicit target, adding V32+ legitimately
        // makes more than one migration pending and breaks the V31-specific proof.
        val v31 = flyway(dataSource, MigrationVersion.fromVersion("31"))
        val pending = v31.info().pending()
        assertEquals(1, pending.size)
        assertEquals("31", pending.single().version.version)
        assertEquals("supabase security postgis foundation", pending.single().description)
        assertEquals(1, v31.migrate().migrationsExecuted)

        assertEquals(
            "31",
            jdbc.queryForObject(
                "SELECT version FROM mypet.flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1",
                String::class.java,
            ),
        )
        assertTrue(
            jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis' AND extnamespace = 'extensions'::regnamespace)",
                Boolean::class.java,
            )!!,
        )

        assertEquals(13.6288, jdbc.queryForObject("SELECT dispatch_latitude FROM mypet.provider_outlet WHERE id = ?", Double::class.java, outletId)!!, 0.000001)
        assertEquals(79.4192, jdbc.queryForObject("SELECT dispatch_longitude FROM mypet.provider_outlet WHERE id = ?", Double::class.java, outletId)!!, 0.000001)
        assertTrue(jdbc.queryForObject("SELECT dispatch_geog IS NOT NULL FROM mypet.provider_outlet WHERE id = ?", Boolean::class.java, outletId)!!)
        assertTrue(jdbc.queryForObject("SELECT center_geog IS NOT NULL FROM mypet.service_region WHERE city_identity = 'tirupati'", Boolean::class.java)!!)

        val distanceMeters = jdbc.queryForObject(
            """
            SELECT extensions.ST_Distance(
                dispatch_geog,
                extensions.ST_SetSRID(extensions.ST_MakePoint(79.419200, 13.628800), 4326)::extensions.geography
            )
            FROM mypet.provider_outlet
            WHERE id = ?
            """.trimIndent(),
            Double::class.java,
            outletId,
        )!!
        assertTrue(distanceMeters < 0.01)

        assertTrue(
            jdbc.queryForObject(
                """
                SELECT extensions.ST_DWithin(
                    center_geog,
                    extensions.ST_SetSRID(extensions.ST_MakePoint(79.45, 13.65), 4326)::extensions.geography,
                    radius_km::double precision * 1000.0
                )
                FROM mypet.service_region
                WHERE city_identity = 'tirupati'
                """.trimIndent(),
                Boolean::class.java,
            )!!,
        )
        assertFalse(
            jdbc.queryForObject(
                """
                SELECT extensions.ST_DWithin(
                    center_geog,
                    extensions.ST_SetSRID(extensions.ST_MakePoint(77.5946, 12.9716), 4326)::extensions.geography,
                    radius_km::double precision * 1000.0
                )
                FROM mypet.service_region
                WHERE city_identity = 'tirupati'
                """.trimIndent(),
                Boolean::class.java,
            )!!,
        )

        val nullOutletId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'V31 Null Geo', 'ACTIVE', TRUE)",
            nullOutletId,
            organizationId,
        )
        assertTrue(jdbc.queryForObject("SELECT dispatch_geog IS NULL FROM mypet.provider_outlet WHERE id = ?", Boolean::class.java, nullOutletId)!!)

        assertThrows(Exception::class.java) {
            jdbc.update("UPDATE mypet.provider_outlet SET dispatch_latitude = 90.000001, dispatch_longitude = 79.4192 WHERE id = ?", outletId)
        }
        assertThrows(Exception::class.java) {
            jdbc.update("UPDATE mypet.provider_outlet SET dispatch_latitude = NULL, dispatch_longitude = 79.4192 WHERE id = ?", outletId)
        }
        assertThrows(Exception::class.java) {
            jdbc.update("UPDATE mypet.service_region SET center_longitude = 180.000001 WHERE city_identity = 'tirupati'")
        }

        assertIndexIsGist(jdbc, "idx_provider_outlet_dispatch_geog")
        assertIndexIsGist(jdbc, "idx_service_region_center_geog")
        assertGeneratedColumn(jdbc, "provider_outlet", "dispatch_geog")
        assertGeneratedColumn(jdbc, "service_region", "center_geog")

        listOf("reject_inventory_movement_mutation", "initialize_inventory_balance_for_listing").forEach { functionName ->
            assertEquals(
                "search_path=pg_catalog",
                jdbc.queryForObject(
                    """
                    SELECT array_to_string(p.proconfig, ',')
                    FROM pg_proc p
                    JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'mypet' AND p.proname = ?
                    """.trimIndent(),
                    String::class.java,
                    functionName,
                ),
            )
        }

        verifySearchPathShadowingCannotRedirectInventoryInitialization(dataSource, organizationId, outletId)
    }

    private fun verifySearchPathShadowingCannotRedirectInventoryInitialization(
        dataSource: DataSource,
        organizationId: UUID,
        outletId: UUID,
    ) {
        val listingId = UUID.randomUUID()
        dataSource.connection.use { connection ->
            connection.autoCommit = false
            connection.createStatement().use { statement ->
                statement.execute("CREATE SCHEMA attacker")
                statement.execute("CREATE TABLE attacker.inventory_balance(listing_id UUID PRIMARY KEY)")
                statement.execute("SET LOCAL search_path = attacker, mypet, public")
            }
            connection.prepareStatement(
                """
                INSERT INTO mypet.catalog_listing(
                    id, organization_id, outlet_id, barcode_type, normalized_barcode, name,
                    listing_kind, commerce_mode, mrp_paise, selling_price_paise, active
                ) VALUES (?, ?, ?, 'INTERNAL', ?, 'V31 shadow test', 'PRODUCT', 'COMMERCE', 10000, 9000, TRUE)
                """.trimIndent(),
            ).use { statement ->
                statement.setObject(1, listingId)
                statement.setObject(2, organizationId)
                statement.setObject(3, outletId)
                statement.setString(4, "V31-$listingId")
                assertEquals(1, statement.executeUpdate())
            }
            connection.prepareStatement("SELECT COUNT(*) FROM mypet.inventory_balance WHERE listing_id = ?").use { statement ->
                statement.setObject(1, listingId)
                statement.executeQuery().use { result ->
                    assertTrue(result.next())
                    assertEquals(1, result.getInt(1))
                }
            }
            connection.createStatement().use { statement ->
                statement.executeQuery("SELECT COUNT(*) FROM attacker.inventory_balance").use { result ->
                    assertTrue(result.next())
                    assertEquals(0, result.getInt(1))
                }
            }
            connection.rollback()
        }
    }

    private fun assertIndexIsGist(jdbc: JdbcTemplate, indexName: String) {
        val indexDefinition = jdbc.queryForObject(
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'mypet' AND indexname = ?",
            String::class.java,
            indexName,
        )!!
        assertTrue(indexDefinition.contains("USING gist", ignoreCase = true), indexDefinition)
    }

    private fun assertGeneratedColumn(jdbc: JdbcTemplate, tableName: String, columnName: String) {
        assertEquals(
            "ALWAYS",
            jdbc.queryForObject(
                """
                SELECT is_generated
                FROM information_schema.columns
                WHERE table_schema = 'mypet' AND table_name = ? AND column_name = ?
                """.trimIndent(),
                String::class.java,
                tableName,
                columnName,
            ),
        )
    }

    private fun flyway(dataSource: DataSource, target: MigrationVersion? = null): Flyway {
        val configuration = Flyway.configure()
            .dataSource(dataSource)
            .schemas("mypet")
            .defaultSchema("mypet")
            .createSchemas(true)
            .cleanDisabled(false)
            .locations("classpath:db/migration")
        if (target != null) configuration.target(target)
        return configuration.load()
    }
}
