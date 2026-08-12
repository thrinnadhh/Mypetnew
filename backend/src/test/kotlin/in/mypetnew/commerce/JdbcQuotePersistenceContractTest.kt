package `in`.mypetnew.commerce

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
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem=quote_${UUID.randomUUID().toString().replace("-", "")};MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
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
        val persistence = JdbcQuotePersistence(jdbc, transactions)
        val issuedAt = Instant.parse("2026-08-12T05:00:00Z")
        val initial = QuoteService(
            clock = Clock.fixed(issuedAt, ZoneOffset.UTC),
            lifetime = Duration.ofMinutes(5),
            persistence = persistence,
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
            persistence = JdbcQuotePersistence(jdbc, transactions),
        )
        val restored = restarted.requireValid(quote.id, quote.cartSignature)

        assertEquals(quote.id, restored.id)
        assertEquals(25_000, restored.pricing.itemSubtotalPaise)
        assertEquals(26_000, restored.pricing.grandTotalPaise)
        assertEquals(quote.expiresAt, restored.expiresAt)

        val afterExpiry = QuoteService(
            clock = Clock.fixed(issuedAt.plusSeconds(301), ZoneOffset.UTC),
            lifetime = Duration.ofMinutes(5),
            persistence = JdbcQuotePersistence(jdbc, transactions),
        )
        assertThrows(DomainException::class.java) {
            afterExpiry.requireValid(quote.id, quote.cartSignature)
        }
    }
}
