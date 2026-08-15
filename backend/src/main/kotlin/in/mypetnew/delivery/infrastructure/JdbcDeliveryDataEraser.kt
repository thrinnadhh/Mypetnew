package `in`.mypetnew.delivery.infrastructure

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.delivery.domain.DeliveryDataEraser
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.util.UUID

@Component
@Profile("!test & !development")
class JdbcDeliveryDataEraser(private val jdbc: JdbcClient) : DeliveryDataEraser {
    override fun eraseCustomerDeliveryIdentifiers(customerId: UUID) {
        val activeDeliveryOrders = jdbc.sql(
            """
            SELECT COUNT(*)
            FROM mypet.product_order
            WHERE customer_id = :customer_id
              AND fulfilment_mode = 'MYPET_CAPTAIN_DELIVERY'
              AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP')
            """.trimIndent(),
        ).param("customer_id", customerId)
            .query(Int::class.java)
            .single()
        if (activeDeliveryOrders > 0) {
            throw DomainException(
                "ACCOUNT_DELETION_BLOCKED_ACTIVE_DELIVERY",
                "Complete or cancel the active delivery order before deleting the account",
            )
        }

        jdbc.sql(
            """
            UPDATE mypet.commerce_quote
            SET delivery_address_id = :redacted_address_id,
                delivery_recipient_name = 'DELETED',
                delivery_phone_number = 'DELETED',
                delivery_line1 = 'DELETED',
                delivery_line2 = NULL,
                delivery_city = 'DELETED',
                delivery_state = 'DELETED',
                delivery_pincode = '000000'
            WHERE customer_id = :customer_id
              AND fulfilment_mode = 'MYPET_CAPTAIN_DELIVERY'
            """.trimIndent(),
        ).param("redacted_address_id", REDACTED_ADDRESS_ID)
            .param("customer_id", customerId)
            .update()
    }

    companion object {
        val REDACTED_ADDRESS_ID: UUID = UUID(0L, 0L)
    }
}
