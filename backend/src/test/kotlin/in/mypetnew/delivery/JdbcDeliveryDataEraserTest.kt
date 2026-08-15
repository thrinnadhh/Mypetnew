package `in`.mypetnew.delivery

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.delivery.infrastructure.JdbcDeliveryDataEraser
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DriverManagerDataSource
import java.util.UUID

class JdbcDeliveryDataEraserTest {
    @Test
    fun `account erasure redacts delivery address direct identifiers but preserves quote`() {
        val fixture = fixture()
        val customerId = UUID.randomUUID()
        val quoteId = fixture.insertDeliveryQuote(customerId)

        JdbcDeliveryDataEraser(fixture.jdbc).eraseCustomerDeliveryIdentifiers(customerId)

        val redacted = fixture.jdbc.sql(
            """
            SELECT delivery_address_id, delivery_recipient_name, delivery_phone_number,
                   delivery_line1, delivery_line2, delivery_city, delivery_state, delivery_pincode
            FROM mypet.commerce_quote WHERE id = :id
            """.trimIndent(),
        ).param("id", quoteId).query { rows, _ ->
            RedactedDelivery(
                addressId = rows.getObject("delivery_address_id", UUID::class.java),
                recipientName = rows.getString("delivery_recipient_name"),
                phoneNumber = rows.getString("delivery_phone_number"),
                line1 = rows.getString("delivery_line1"),
                line2 = rows.getString("delivery_line2"),
                city = rows.getString("delivery_city"),
                state = rows.getString("delivery_state"),
                pincode = rows.getString("delivery_pincode"),
            )
        }.single()

        assertEquals(UUID(0L, 0L), redacted.addressId)
        assertEquals("DELETED", redacted.recipientName)
        assertEquals("DELETED", redacted.phoneNumber)
        assertEquals("DELETED", redacted.line1)
        assertNull(redacted.line2)
        assertEquals("DELETED", redacted.city)
        assertEquals("DELETED", redacted.state)
        assertEquals("000000", redacted.pincode)
    }

    @Test
    fun `active Captain delivery blocks deletion before delivery identifiers are erased`() {
        val fixture = fixture()
        val customerId = UUID.randomUUID()
        val quoteId = fixture.insertDeliveryQuote(customerId)
        fixture.jdbc.sql(
            """
            INSERT INTO mypet.product_order(id, customer_id, fulfilment_mode, status)
            VALUES (:id, :customer_id, 'MYPET_CAPTAIN_DELIVERY', 'PICKED_UP')
            """.trimIndent(),
        ).param("id", UUID.randomUUID())
            .param("customer_id", customerId)
            .update()

        val failure = assertThrows(DomainException::class.java) {
            JdbcDeliveryDataEraser(fixture.jdbc).eraseCustomerDeliveryIdentifiers(customerId)
        }
        assertEquals("ACCOUNT_DELETION_BLOCKED_ACTIVE_DELIVERY", failure.code)

        val recipient = fixture.jdbc.sql(
            "SELECT delivery_recipient_name FROM mypet.commerce_quote WHERE id = :id",
        ).param("id", quoteId)
            .query(String::class.java)
            .single()
        assertEquals("Named Customer", recipient)
    }

    private fun fixture(): Fixture {
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
        jdbc.sql(
            """
            CREATE TABLE mypet.product_order (
                id UUID PRIMARY KEY,
                customer_id UUID NOT NULL,
                fulfilment_mode VARCHAR(32) NOT NULL,
                status VARCHAR(32) NOT NULL
            )
            """.trimIndent(),
        ).update()
        return Fixture(jdbc)
    }

    private data class Fixture(val jdbc: JdbcClient) {
        fun insertDeliveryQuote(customerId: UUID): UUID {
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
            return quoteId
        }
    }

    private data class RedactedDelivery(
        val addressId: UUID?,
        val recipientName: String?,
        val phoneNumber: String?,
        val line1: String?,
        val line2: String?,
        val city: String?,
        val state: String?,
        val pincode: String?,
    )
}
