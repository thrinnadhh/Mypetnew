package `in`.mypetnew.customer

import `in`.mypetnew.customer.domain.CustomerFavourite
import `in`.mypetnew.customer.infrastructure.JdbcCustomerFavouritePersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DriverManagerDataSource
import java.time.Instant
import java.util.UUID

class JdbcCustomerFavouritePersistenceContractTest {
    @Test
    fun `jdbc favourites are idempotent paginated owner scoped and erasable`() {
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:favourites-${UUID.randomUUID()};MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
            "sa",
            "",
        )
        val jdbcTemplate = JdbcTemplate(dataSource)
        jdbcTemplate.execute("CREATE SCHEMA mypet")
        jdbcTemplate.execute(
            """
            CREATE TABLE mypet.customer_favourite_listing(
                customer_id UUID NOT NULL,
                listing_id UUID NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                PRIMARY KEY(customer_id, listing_id)
            )
            """.trimIndent(),
        )
        val persistence = JdbcCustomerFavouritePersistence(JdbcClient.create(dataSource))
        val customerA = UUID.randomUUID()
        val customerB = UUID.randomUUID()
        val listingA = UUID.randomUUID()
        val listingB = UUID.randomUUID()
        val firstAt = Instant.parse("2026-08-15T05:00:00Z")
        val secondAt = firstAt.plusSeconds(1)

        val first = persistence.put(CustomerFavourite(customerA, listingA, firstAt))
        val replay = persistence.put(CustomerFavourite(customerA, listingA, secondAt))
        assertEquals(firstAt, first.createdAt)
        assertEquals(first, replay)

        persistence.put(CustomerFavourite(customerA, listingB, secondAt))
        persistence.put(CustomerFavourite(customerB, listingA, secondAt))

        val page0 = persistence.list(customerA, 0, 1)
        assertEquals(listOf(listingB), page0.items.map { it.listingId })
        assertTrue(page0.hasNext)
        val page1 = persistence.list(customerA, 1, 1)
        assertEquals(listOf(listingA), page1.items.map { it.listingId })
        assertFalse(page1.hasNext)
        assertEquals(1, persistence.list(customerB, 0, 20).items.size)

        assertFalse(persistence.delete(customerB, listingB))
        assertEquals(2, persistence.list(customerA, 0, 20).items.size)
        assertTrue(persistence.delete(customerA, listingB))
        assertFalse(persistence.delete(customerA, listingB))

        persistence.eraseAll(customerA)
        assertTrue(persistence.list(customerA, 0, 20).items.isEmpty())
        assertEquals(1, persistence.list(customerB, 0, 20).items.size)
    }
}
