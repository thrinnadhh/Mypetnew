package `in`.mypetnew.merchantops.testsupport

import org.springframework.jdbc.core.simple.JdbcClient
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import javax.sql.DataSource

data class MerchantScenario(
    val accountId: UUID,
    val organizationId: UUID,
    val outletId: UUID,
    val listingId: UUID,
)

class MerchantScenarioFixture(dataSource: DataSource) {
    private val jdbc = JdbcClient.create(dataSource)
    private val sequence = AtomicInteger()

    fun create(onHand: Int = 0, reserved: Int = 0): MerchantScenario {
        val number = sequence.incrementAndGet()
        val scenario = MerchantScenario(
            accountId = UUID.randomUUID(),
            organizationId = UUID.randomUUID(),
            outletId = UUID.randomUUID(),
            listingId = UUID.randomUUID(),
        )
        jdbc.sql(
            "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'MERCHANT', 'ACTIVE')",
        ).params(scenario.accountId, "+919${number.toString().padStart(9, '0')}").update()
        jdbc.sql(
            "INSERT INTO mypet.merchant_organization(id, name, status, owner_actor_id) VALUES (?, ?, 'ACTIVE', ?)",
        ).params(scenario.organizationId, "M0 organization $number", scenario.accountId).update()
        jdbc.sql(
            "INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, ?, 'ACTIVE', TRUE)",
        ).params(scenario.outletId, scenario.organizationId, "M0 outlet $number").update()
        jdbc.sql(
            "INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'OWNER', TRUE)",
        ).params(scenario.accountId, scenario.organizationId, scenario.outletId).update()
        jdbc.sql(
            """
            INSERT INTO mypet.catalog_listing(
                id, organization_id, outlet_id, barcode_type, normalized_barcode, name,
                listing_kind, commerce_mode, mrp_paise, selling_price_paise, active
            ) VALUES (?, ?, ?, 'INTERNAL', ?, ?, 'PRODUCT', 'COMMERCE', 10000, 9000, TRUE)
            """.trimIndent(),
        ).params(
            scenario.listingId,
            scenario.organizationId,
            scenario.outletId,
            "M0-${scenario.listingId}",
            "M0 product $number",
        ).update()
        // V25 initializes a canonical zero projection when the listing is inserted. Older test callers
        // may still request seeded non-zero values, so update that fixture projection rather than
        // inserting a second row. M3 contract tests use zero and create stock through movements.
        jdbc.sql(
            """
            UPDATE mypet.inventory_balance
            SET on_hand = ?, reserved = ?, version = 0, updated_at = CURRENT_TIMESTAMP
            WHERE organization_id = ? AND outlet_id = ? AND listing_id = ?
            """.trimIndent(),
        ).params(
            onHand,
            reserved,
            scenario.organizationId,
            scenario.outletId,
            scenario.listingId,
        ).update()
        return scenario
    }

    fun listingIds(organizationId: UUID, outletId: UUID): List<UUID> = jdbc.sql(
        "SELECT id FROM mypet.catalog_listing WHERE organization_id = ? AND outlet_id = ? ORDER BY id",
    ).params(organizationId, outletId)
        .query { result, _ -> checkNotNull(result.getObject("id", UUID::class.java)) }
        .list()
}
