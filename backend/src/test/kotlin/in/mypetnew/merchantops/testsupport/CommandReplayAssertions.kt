package `in`.mypetnew.merchantops.testsupport

import org.junit.jupiter.api.Assertions.assertEquals
import org.springframework.jdbc.core.simple.JdbcClient

object CommandReplayAssertions {
    fun assertSameReceipt(first: Any, replay: Any) {
        assertEquals(first, replay, "An idempotent replay must return the canonical receipt")
    }

    fun assertExactlyOneEffect(jdbc: JdbcClient, countSql: String, vararg parameters: Any) {
        val count = jdbc.sql(countSql).params(*parameters).query(Int::class.javaObjectType).single()
        assertEquals(1, count, "An accepted command must produce exactly one durable effect")
    }
}
