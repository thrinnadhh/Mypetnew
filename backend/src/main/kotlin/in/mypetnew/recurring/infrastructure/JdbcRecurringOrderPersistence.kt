package `in`.mypetnew.recurring.infrastructure

import `in`.mypetnew.recurring.domain.RecurringOrderPage
import `in`.mypetnew.recurring.domain.RecurringOrderPersistence
import `in`.mypetnew.recurring.domain.RecurringOrderStatus
import `in`.mypetnew.recurring.domain.RecurringOrderSubscription
import org.springframework.jdbc.core.simple.JdbcClient
import java.util.UUID

class JdbcRecurringOrderPersistence(
    private val jdbc: JdbcClient,
) : RecurringOrderPersistence {
    override fun save(subscription: RecurringOrderSubscription): RecurringOrderSubscription {
        val updated = jdbc.sql(
            """
            UPDATE mypet.recurring_order_subscription
            SET delivery_address_id = :deliveryAddressId,
                cadence_days = :cadenceDays,
                quantity_multiplier = :quantityMultiplier,
                status = :status,
                next_order_at = :nextOrderAt,
                last_reminded_at = :lastRemindedAt,
                updated_at = :updatedAt
            WHERE id = :id AND customer_id = :customerId
            """.trimIndent(),
        )
            .param("deliveryAddressId", subscription.deliveryAddressId)
            .param("cadenceDays", subscription.cadenceDays)
            .param("quantityMultiplier", subscription.quantityMultiplier)
            .param("status", subscription.status.name)
            .param("nextOrderAt", subscription.nextOrderAt)
            .param("lastRemindedAt", subscription.lastRemindedAt)
            .param("updatedAt", subscription.updatedAt)
            .param("id", subscription.id)
            .param("customerId", subscription.customerId)
            .update()

        if (updated == 0) {
            jdbc.sql(
                """
                INSERT INTO mypet.recurring_order_subscription (
                    id, customer_id, provider_id, source_order_id, delivery_address_id,
                    cadence_days, quantity_multiplier, status, next_order_at,
                    last_reminded_at, created_at, updated_at
                ) VALUES (
                    :id, :customerId, :providerId, :sourceOrderId, :deliveryAddressId,
                    :cadenceDays, :quantityMultiplier, :status, :nextOrderAt,
                    :lastRemindedAt, :createdAt, :updatedAt
                )
                """.trimIndent(),
            )
                .param("id", subscription.id)
                .param("customerId", subscription.customerId)
                .param("providerId", subscription.providerId)
                .param("sourceOrderId", subscription.sourceOrderId)
                .param("deliveryAddressId", subscription.deliveryAddressId)
                .param("cadenceDays", subscription.cadenceDays)
                .param("quantityMultiplier", subscription.quantityMultiplier)
                .param("status", subscription.status.name)
                .param("nextOrderAt", subscription.nextOrderAt)
                .param("lastRemindedAt", subscription.lastRemindedAt)
                .param("createdAt", subscription.createdAt)
                .param("updatedAt", subscription.updatedAt)
                .update()
        }
        return subscription
    }

    override fun get(customerId: UUID, subscriptionId: UUID): RecurringOrderSubscription? =
        jdbc.sql(
            """
            SELECT * FROM mypet.recurring_order_subscription
            WHERE id = :id AND customer_id = :customerId
            """.trimIndent(),
        )
            .param("id", subscriptionId)
            .param("customerId", customerId)
            .query(::map)
            .optional()
            .orElse(null)

    override fun findActiveBySource(customerId: UUID, sourceOrderId: UUID): RecurringOrderSubscription? =
        jdbc.sql(
            """
            SELECT * FROM mypet.recurring_order_subscription
            WHERE customer_id = :customerId
              AND source_order_id = :sourceOrderId
              AND status <> 'CANCELLED'
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """.trimIndent(),
        )
            .param("customerId", customerId)
            .param("sourceOrderId", sourceOrderId)
            .query(::map)
            .optional()
            .orElse(null)

    override fun list(customerId: UUID, page: Int, pageSize: Int): RecurringOrderPage {
        val rows = jdbc.sql(
            """
            SELECT * FROM mypet.recurring_order_subscription
            WHERE customer_id = :customerId
            ORDER BY created_at DESC, id DESC
            LIMIT :limit OFFSET :offset
            """.trimIndent(),
        )
            .param("customerId", customerId)
            .param("limit", pageSize + 1)
            .param("offset", page.toLong() * pageSize.toLong())
            .query(::map)
            .list()
        return RecurringOrderPage(rows.take(pageSize), rows.size > pageSize)
    }

    private fun map(result: java.sql.ResultSet, @Suppress("UNUSED_PARAMETER") row: Int) = RecurringOrderSubscription(
        id = result.getObject("id", UUID::class.java),
        customerId = result.getObject("customer_id", UUID::class.java),
        providerId = result.getObject("provider_id", UUID::class.java),
        sourceOrderId = result.getObject("source_order_id", UUID::class.java),
        deliveryAddressId = result.getObject("delivery_address_id", UUID::class.java),
        cadenceDays = result.getInt("cadence_days"),
        quantityMultiplier = result.getInt("quantity_multiplier"),
        status = RecurringOrderStatus.valueOf(result.getString("status")),
        nextOrderAt = result.getTimestamp("next_order_at").toInstant(),
        lastRemindedAt = result.getTimestamp("last_reminded_at")?.toInstant(),
        createdAt = result.getTimestamp("created_at").toInstant(),
        updatedAt = result.getTimestamp("updated_at").toInstant(),
    )
}
