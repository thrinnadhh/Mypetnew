package `in`.mypetnew.customer.infrastructure

import `in`.mypetnew.customer.domain.CustomerFavourite
import `in`.mypetnew.customer.domain.CustomerFavouritePage
import `in`.mypetnew.customer.domain.CustomerFavouritePersistence
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.simple.JdbcClient
import java.sql.ResultSet
import java.sql.Timestamp
import java.util.UUID

class JdbcCustomerFavouritePersistence(
    private val jdbc: JdbcClient,
) : CustomerFavouritePersistence {
    override fun list(customerId: UUID, page: Int, pageSize: Int): CustomerFavouritePage {
        val rows = jdbc.sql(
            """
            SELECT customer_id, listing_id, created_at
            FROM mypet.customer_favourite_listing
            WHERE customer_id = :customer_id
            ORDER BY created_at DESC, listing_id DESC
            LIMIT :limit OFFSET :offset
            """.trimIndent(),
        ).param("customer_id", customerId)
            .param("limit", pageSize + 1)
            .param("offset", page.toLong() * pageSize.toLong())
            .query(::mapFavourite)
            .list()
        return CustomerFavouritePage(rows.take(pageSize), rows.size > pageSize)
    }

    override fun put(favourite: CustomerFavourite): CustomerFavourite {
        try {
            jdbc.sql(
                """
                INSERT INTO mypet.customer_favourite_listing(customer_id, listing_id, created_at)
                VALUES (:customer_id, :listing_id, :created_at)
                """.trimIndent(),
            ).param("customer_id", favourite.customerId)
                .param("listing_id", favourite.listingId)
                .param("created_at", Timestamp.from(favourite.createdAt))
                .update()
        } catch (_: DuplicateKeyException) {
            // The composite primary key is the idempotency/concurrency boundary. A concurrent or replayed PUT
            // returns the row that won the insert instead of changing the original creation timestamp.
        }
        return jdbc.sql(
            """
            SELECT customer_id, listing_id, created_at
            FROM mypet.customer_favourite_listing
            WHERE customer_id = :customer_id AND listing_id = :listing_id
            """.trimIndent(),
        ).param("customer_id", favourite.customerId)
            .param("listing_id", favourite.listingId)
            .query(::mapFavourite)
            .single()
    }

    override fun delete(customerId: UUID, listingId: UUID): Boolean =
        jdbc.sql(
            "DELETE FROM mypet.customer_favourite_listing WHERE customer_id = :customer_id AND listing_id = :listing_id",
        ).param("customer_id", customerId)
            .param("listing_id", listingId)
            .update() == 1

    override fun eraseAll(customerId: UUID) {
        jdbc.sql("DELETE FROM mypet.customer_favourite_listing WHERE customer_id = :customer_id")
            .param("customer_id", customerId)
            .update()
    }

    private fun mapFavourite(rows: ResultSet, rowNumber: Int): CustomerFavourite {
        require(rowNumber >= 0)
        return CustomerFavourite(
            customerId = rows.getObject("customer_id", UUID::class.java),
            listingId = rows.getObject("listing_id", UUID::class.java),
            createdAt = rows.getTimestamp("created_at").toInstant(),
        )
    }
}
