package `in`.mypetnew.merchantops

import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID

@MerchantOpsContract
@MerchantOpsPostgres
class MI3AsyncInfrastructurePostgresContractTest {
    @Test
    fun `MI3 queue lifecycle constraints reject unrecognized states on real PostgreSQL`() {
        PostgresTestDatabase.resetAndMigrate()
        val jdbc = JdbcTemplate(PostgresTestDatabase.dataSource())

        val constraints = jdbc.query(
            """
            SELECT c.conname, c.convalidated, pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'mypet'
              AND c.conname IN ('chk_outbox_event_status', 'chk_notification_attempt_status')
            ORDER BY c.conname
            """.trimIndent(),
        ) { rs, _ -> Triple(rs.getString(1), rs.getBoolean(2), rs.getString(3)) }

        assertEquals(2, constraints.size)
        constraints.forEach { (_, validated, definition) ->
            assertTrue(validated)
            assertTrue(definition.contains("PENDING"))
            assertTrue(definition.contains("DEAD_LETTER"))
        }

        assertThrows(Exception::class.java) {
            jdbc.update(
                """
                INSERT INTO mypet.outbox_event(
                    id, aggregate_type, aggregate_id, event_type, event_version,
                    payload, status, trace_id
                ) VALUES (?, 'MI3_TEST', ?, 'MI3_TEST_EVENT', 1, '{}', 'CORRUPT_STATE', 'mi3-test')
                """.trimIndent(),
                UUID.randomUUID(),
                UUID.randomUUID(),
            )
        }

        // Disable only FK triggers so the second assertion isolates the status CHECK failure mode.
        jdbc.execute("SET session_replication_role = replica")
        try {
            assertThrows(Exception::class.java) {
                jdbc.update(
                    """
                    INSERT INTO mypet.notification_attempt(
                        id, notification_id, registration_id, channel, status, attempt_count
                    ) VALUES (?, ?, ?, 'PUSH', 'CORRUPT_STATE', 0)
                    """.trimIndent(),
                    UUID.randomUUID(),
                    UUID.randomUUID(),
                    UUID.randomUUID(),
                )
            }
        } finally {
            jdbc.execute("SET session_replication_role = origin")
        }
    }

    @Test
    fun `MI3 async claim and dedupe indexes remain present after V32`() {
        PostgresTestDatabase.resetAndMigrate()
        val jdbc = JdbcTemplate(PostgresTestDatabase.dataSource())

        val requiredIndexes = setOf(
            "idx_outbox_claim",
            "idx_notification_attempt_delivery",
            "uq_inventory_movement_change_publication",
        )
        val present = jdbc.queryForList(
            "SELECT indexname FROM pg_indexes WHERE schemaname = 'mypet'",
            String::class.java,
        ).toSet()

        assertTrue(present.containsAll(requiredIndexes), "Missing async indexes: ${requiredIndexes - present}")

        val inboxPrimaryKey = jdbc.queryForObject(
            """
            SELECT COUNT(*)
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'mypet'
              AND t.relname = 'inbox_event'
              AND c.contype = 'p'
              AND pg_get_constraintdef(c.oid) LIKE '%consumer_name%source_event_id%'
            """.trimIndent(),
            Int::class.java,
        )
        assertEquals(1, inboxPrimaryKey)
    }
}
