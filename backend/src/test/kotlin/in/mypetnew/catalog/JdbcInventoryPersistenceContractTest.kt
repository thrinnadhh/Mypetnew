package `in`.mypetnew.catalog

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.common.error.DomainException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors

class JdbcInventoryPersistenceContractTest {
    @Test
    fun `persistent receive is replay safe and rejects fingerprint reuse`() {
        val fixture = fixture()
        val listingId = fixture.createListing()
        val inventory = fixture.inventory

        val first = inventory.adjust(listingId, 5, StockReason.RECEIPT, "receive-1", UUID.randomUUID(), "trace-1")
        val replay = inventory.adjust(listingId, 5, StockReason.RECEIPT, "receive-1", UUID.randomUUID(), "trace-2")

        assertEquals(first.id, replay.id)
        assertEquals(5, inventory.available(listingId))
        assertEquals(1, inventory.history(listingId).size)
        assertThrows(DomainException::class.java) {
            inventory.adjust(listingId, 6, StockReason.RECEIPT, "receive-1", UUID.randomUUID(), "trace-3")
        }
        assertEquals(5, inventory.available(listingId))
    }

    @Test
    fun `database lock allows exactly one last unit reservation winner`() {
        val fixture = fixture()
        val listingId = fixture.createListing()
        val inventory = fixture.inventory
        inventory.adjust(listingId, 1, StockReason.RECEIPT, "receive-last", UUID.randomUUID(), "trace-receive")
        val executor = Executors.newFixedThreadPool(12)

        try {
            val results = executor.invokeAll((1..50).map { attempt ->
                Callable {
                    runCatching {
                        inventory.reserve(
                            listingId,
                            1,
                            "order-$attempt",
                            UUID.randomUUID(),
                            "trace-$attempt",
                        )
                    }.isSuccess
                }
            }).map { it.get() }

            assertEquals(1, results.count { it })
            assertEquals(0, inventory.available(listingId))
            assertEquals(1, inventory.reserved(listingId))
            assertEquals(2, inventory.history(listingId).size)
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `reservation release is idempotent and never over releases`() {
        val fixture = fixture()
        val listingId = fixture.createListing()
        val inventory = fixture.inventory
        val actor = UUID.randomUUID()
        inventory.adjust(listingId, 2, StockReason.RECEIPT, "receive-2", actor, "trace-receive")
        inventory.reserve(listingId, 1, "reserve-2", actor, "trace-reserve")

        val released = inventory.release(listingId, 1, "release-2", actor, "trace-release")
        val replay = inventory.release(listingId, 1, "release-2", actor, "trace-release-replay")

        assertEquals(released.id, replay.id)
        assertEquals(2, inventory.available(listingId))
        assertEquals(0, inventory.reserved(listingId))
        assertEquals(3, inventory.history(listingId).size)
    }

    private fun fixture(): Fixture {
        val databaseName = "inventory_${UUID.randomUUID().toString().replace("-", "")}"
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:$databaseName;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
            "sa",
            "",
        )
        val jdbc = JdbcTemplate(dataSource)
        jdbc.execute("CREATE SCHEMA mypet")
        jdbc.execute(
            """
            CREATE TABLE mypet.catalog_listing (
                id UUID PRIMARY KEY,
                outlet_id UUID NOT NULL
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.inventory_balance (
                listing_id UUID PRIMARY KEY,
                on_hand INTEGER NOT NULL DEFAULT 0,
                reserved INTEGER NOT NULL DEFAULT 0,
                version BIGINT NOT NULL DEFAULT 0,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CHECK (on_hand >= 0),
                CHECK (reserved >= 0),
                CHECK (on_hand >= reserved)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.inventory_movement (
                id UUID PRIMARY KEY,
                listing_id UUID NOT NULL,
                outlet_id UUID NOT NULL,
                reason VARCHAR(40) NOT NULL,
                quantity_delta INTEGER NOT NULL,
                resulting_on_hand INTEGER NOT NULL,
                resulting_reserved INTEGER NOT NULL,
                source_type VARCHAR(40) NOT NULL,
                source_reference VARCHAR(160) NOT NULL,
                actor_id UUID NOT NULL,
                idempotency_key VARCHAR(128) NOT NULL,
                trace_id VARCHAR(64) NOT NULL,
                operation_scope VARCHAR(40) NOT NULL,
                request_fingerprint VARCHAR(64) NOT NULL,
                occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_inventory_movement_idempotency UNIQUE (outlet_id, idempotency_key),
                CHECK (resulting_on_hand >= resulting_reserved),
                CHECK (resulting_reserved >= 0)
            )
            """.trimIndent(),
        )
        val transaction = TransactionTemplate(DataSourceTransactionManager(dataSource))
        return Fixture(jdbc, InventoryService(JdbcInventoryPersistence(jdbc, transaction)))
    }

    private data class Fixture(
        val jdbc: JdbcTemplate,
        val inventory: InventoryService,
    ) {
        fun createListing(): UUID {
            val listingId = UUID.randomUUID()
            jdbc.update(
                "INSERT INTO mypet.catalog_listing (id, outlet_id) VALUES (?, ?)",
                listingId,
                UUID.randomUUID(),
            )
            return listingId
        }
    }
}
