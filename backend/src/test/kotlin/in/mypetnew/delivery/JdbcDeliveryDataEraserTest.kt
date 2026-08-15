package `in`.mypetnew.delivery

import `in`.mypetnew.delivery.infrastructure.JdbcDeliveryDataEraser
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DriverManagerDataSource
import java.util.UUID

class JdbcDeliveryDataEraserTest {
    @Test
    fun `account erasure redacts delivery address direct identifiers but preserves quote`() {
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:delivery_privacy_${UUID.randomUUID().toString().replace("-", "")};MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
            "sa",
            "",
        )
        val jdbc = JdbcClient.create(dataSource)
        jdbc.sql("CREATE SCHEMA mypet").update()
        jdbc.sql(
            """
            CREATE TABLE mypet.commerce_quote (
                id UUID PRIMARY KEY,
                customer_id UUID NOT NULL,
                fulfilment_mode VARCHAR(32) NOT NULL,
                delivery_address_id UUID,
                delivery_recipient_name VARCHAR(120),
                delivery_phone_number VARCHAR(16),
                delivery_line1 VARCHAR(240),
                delivery_line2 VARCHAR(240),
                delivery_city VARCHAR(120),
                delivery_state VARCHAR(120),
                delivery_pincode VARCHAR(6)
            )
            """.trimIndent(),
        ).update()
        val customerId = UUID.randomUUID()
        val quoteId = UUID.randomUUID()
        jdbc.sql(
            """
            INSERT INTO mypet.commerce_quote(
                id, customer_id, fulfilment_mode, delivery_address_id,
                delivery_recipient_name, delivery_phone_number, delivery_line1, delivery_line2,
                delivery_city, delivery_state, delivery_pincode
            ) VALUES (
                :id, :customer_id, 'MYPET_CAPTAIN_DELIVERY', :address_id,
                'Named Customer', '+919876543210', '12 Main Road', 'Landmark',
                'Tirupati', 'Andhra Pradesh', '517501'
            )
            """.trimIndent(),
        ).param("id", quoteId)
            .param("customer_id", customerId)
            .param("address_id", UUID.randomUUID())
            .update()

        JdbcDeliveryDataEraser(jdbc).eraseCustomerDeliveryIdentifiers(customerId)

        val redacted = jdbc.sql(
            """
            SELECT delivery_address_id, delivery_recipient_name, delivery_phone_number,
                   delivery_line1, delivery_line2, delivery_city, delivery_state, delivery_pincode
            FROM mypet.commerce_quote WHERE id = :id
            """.trimIndent(),
        ).param("id", quoteId).query { rows, _ ->
            listOf(
                rows.getObject("delivery_address_id", UUID::class.java).toString(),
                rows.getString("delivery_recipient_name"),
                rows.getString("delivery_phone_number"),
                rows.getString("delivery_line1"),
                rows.getString("delivery_line2"),
                rows.getString("delivery_city"),
                rows.getString("delivery_state"),
                rows.getString("delivery_pincode"),
            )
        }.single()

        assertEquals(UUID(0L, 0L).toString(), redacted[0])
        assertEquals("DELETED", redacted[1])
        assertEquals("DELETED", redacted[2])
        assertEquals("DELETED", redacted[3])
        assertEquals(null, redacted[4])
        assertEquals("DELETED", redacted[5])
        assertEquals("DELETED", redacted[6])
        assertEquals("000000", redacted[7])
    }
}
