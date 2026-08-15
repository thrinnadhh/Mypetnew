package `in`.mypetnew.commerce

import `in`.mypetnew.commerce.domain.DeliveryAddressSnapshot
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.commerce.infrastructure.JdbcQuotePersistence
import `in`.mypetnew.common.error.DomainException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class JdbcQuotePersistenceContractTest {
    @Test
    fun `quote survives service restart and retains expiry and server pricing`() {
        val fixture = fixture()
        val issuedAt = Instant.parse("2026-08-12T05:00:00Z")
        val initial = QuoteService(
            clock = Clock.fixed(issuedAt, ZoneOffset.UTC),
            lifetime = Duration.ofMinutes(5),
            persistence = fixture.persistence,
        )
        val listingId = UUID.randomUUID()
        val quote = initial.createPickupQuote(
            customerId = UUID.randomUUID(),
            outletId = UUID.randomUUID(),
            lines = mapOf(listingId to Pair(2, 12_500L)),
        )

        val restarted = QuoteService(
            clock = Clock.fixed(issuedAt.plusSeconds(120), ZoneOffset.UTC),
            lifetime = Duration.ofMinutes(5),
            persistence = JdbcQuotePersistence(fixture.jdbc, fixture.transactions),
        )
        val restored = restarted.requireValid(quote.id, quote.cartSignature)

        assertEquals(quote.id, restored.id)
        assertEquals(25_000, restored.pricing.itemSubtotalPaise)
        assertEquals(26_000, restored.pricing.grandTotalPaise)
        assertEquals(quote.expiresAt, restored.expiresAt)

        val afterExpiry = QuoteService(
            clock = Clock.fixed(issuedAt.plusSeconds(301), ZoneOffset.UTC),
            lifetime = Duration.ofMinutes(5),
            persistence = JdbcQuotePersistence(fixture.jdbc, fixture.transactions),
        )
        assertThrows(DomainException::class.java) {
            afterExpiry.requireValid(quote.id, quote.cartSignature)
        }
    }

    @Test
    fun `delivery quote survives restart with address fee and eta snapshot`() {
        val fixture = fixture()
        val issuedAt = Instant.parse("2026-08-15T08:00:00Z")
        val service = QuoteService(
            clock = Clock.fixed(issuedAt, ZoneOffset.UTC),
            persistence = fixture.persistence,
        )
        val addressId = UUID.randomUUID()
        val quote = service.createDeliveryQuote(
            customerId = UUID.randomUUID(),
            outletId = UUID.randomUUID(),
            lines = mapOf(UUID.randomUUID() to Pair(1, 20_000L)),
            deliveryAddress = DeliveryAddressSnapshot(
                addressId = addressId,
                recipientName = "Customer",
                phoneNumber = "+919876543210",
                line1 = "12 Main Road",
                line2 = "Near Temple",
                city = "Tirupati",
                state = "Andhra Pradesh",
                pincode = "517501",
            ),
            deliveryFeePaise = 2_500,
            etaMinutes = 35,
        )

        val restarted = QuoteService(
            clock = Clock.fixed(issuedAt.plusSeconds(30), ZoneOffset.UTC),
            persistence = JdbcQuotePersistence(fixture.jdbc, fixture.transactions),
        )
        val restored = restarted.requireValid(quote.id, quote.cartSignature)

        assertEquals("MYPET_CAPTAIN_DELIVERY", restored.fulfilmentMode)
        assertEquals(addressId, restored.deliveryAddress?.addressId)
        assertEquals("517501", restored.deliveryAddress?.pincode)
        assertEquals(2_500, restored.pricing.deliveryFeePaise)
        assertEquals(23_500, restored.pricing.grandTotalPaise)
        assertEquals(35, restored.etaMinutes)
    }

    private fun fixture(): Fixture {
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:quote_${UUID.randomUUID().toString().replace("-", "")};MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
            "sa",
            "",
        )
        val jdbc = JdbcTemplate(dataSource)
        jdbc.execute("CREATE SCHEMA mypet")
        jdbc.execute(
            """
            CREATE TABLE mypet.commerce_quote (
                id UUID PRIMARY KEY,
                customer_id UUID NOT NULL,
                outlet_id UUID NOT NULL,
                cart_signature VARCHAR(128) NOT NULL,
                fulfilment_mode VARCHAR(32) NOT NULL,
                payment_method VARCHAR(40) NOT NULL,
                item_subtotal_paise BIGINT NOT NULL,
                platform_fee_paise BIGINT NOT NULL,
                merchant_commission_paise BIGINT NOT NULL,
                delivery_fee_paise BIGINT NOT NULL DEFAULT 0,
                grand_total_paise BIGINT NOT NULL,
                currency VARCHAR(3) NOT NULL DEFAULT 'INR',
                rule_version VARCHAR(48) NOT NULL,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                delivery_address_id UUID,
                delivery_recipient_name VARCHAR(120),
                delivery_phone_number VARCHAR(16),
                delivery_line1 VARCHAR(240),
                delivery_line2 VARCHAR(240),
                delivery_city VARCHAR(120),
                delivery_state VARCHAR(120),
                delivery_pincode VARCHAR(6),
                delivery_eta_minutes INTEGER,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.quote_line (
                quote_id UUID NOT NULL,
                listing_id UUID NOT NULL,
                quantity INTEGER NOT NULL,
                unit_price_paise BIGINT NOT NULL,
                PRIMARY KEY (quote_id, listing_id)
            )
            """.trimIndent(),
        )
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        return Fixture(jdbc, transactions, JdbcQuotePersistence(jdbc, transactions))
    }

    private data class Fixture(
        val jdbc: JdbcTemplate,
        val transactions: TransactionTemplate,
        val persistence: JdbcQuotePersistence,
    )
}
