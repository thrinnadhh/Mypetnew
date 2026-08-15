package `in`.mypetnew.identity

import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.infrastructure.AuthorizedMerchantSessionIssuer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID

class AuthorizedMerchantSessionIssuerContractTest {
    @Test
    fun `verified mobile resolves canonical merchant account id`() {
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:merchant_session_${UUID.randomUUID().toString().replace("-", "")};MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
            "sa",
            "",
        )
        val jdbcTemplate = JdbcTemplate(dataSource)
        createIdentityTables(jdbcTemplate)
        val canonicalAccountId = UUID.randomUUID()
        val mobile = "+919876543210"
        jdbcTemplate.update(
            "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'MERCHANT', 'ACTIVE')",
            canonicalAccountId,
            mobile,
        )

        val issuer = AuthorizedMerchantSessionIssuer(
            JdbcClient.create(dataSource),
            TransactionTemplate(DataSourceTransactionManager(dataSource)),
        )
        val session = issuer.createMerchant(mobile, "merchant-device-prod")

        assertEquals(canonicalAccountId, session.accountId)
        assertEquals(Role.MERCHANT, session.role)
        assertEquals(
            canonicalAccountId,
            jdbcTemplate.queryForObject(
                "SELECT account_id FROM mypet.user_session WHERE id = ?",
                UUID::class.java,
                session.sessionId,
            ),
        )
    }

    @Test
    fun `non merchant or inactive identity cannot obtain merchant session`() {
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:merchant_reject_${UUID.randomUUID().toString().replace("-", "")};MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
            "sa",
            "",
        )
        val jdbcTemplate = JdbcTemplate(dataSource)
        createIdentityTables(jdbcTemplate)
        val customerMobile = "+919876543211"
        val suspendedMerchantMobile = "+919876543212"
        jdbcTemplate.update(
            "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'CUSTOMER', 'ACTIVE')",
            UUID.randomUUID(),
            customerMobile,
        )
        jdbcTemplate.update(
            "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'MERCHANT', 'SUSPENDED')",
            UUID.randomUUID(),
            suspendedMerchantMobile,
        )

        val issuer = AuthorizedMerchantSessionIssuer(
            JdbcClient.create(dataSource),
            TransactionTemplate(DataSourceTransactionManager(dataSource)),
        )
        assertThrows(DomainException::class.java) {
            issuer.createMerchant(customerMobile, "merchant-device-prod")
        }
        assertThrows(DomainException::class.java) {
            issuer.createMerchant(suspendedMerchantMobile, "merchant-device-prod")
        }
        assertEquals(0, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM mypet.user_session", Int::class.java))
    }

    private fun createIdentityTables(jdbc: JdbcTemplate) {
        jdbc.execute("CREATE SCHEMA mypet")
        jdbc.execute(
            """
            CREATE TABLE mypet.identity_account (
                id UUID PRIMARY KEY,
                mobile_e164 VARCHAR(16) NOT NULL UNIQUE,
                role VARCHAR(32) NOT NULL,
                status VARCHAR(32) NOT NULL
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.user_session (
                id UUID PRIMARY KEY,
                account_id UUID NOT NULL REFERENCES mypet.identity_account(id),
                refresh_token_hash VARCHAR(128) NOT NULL UNIQUE,
                device_id VARCHAR(128) NOT NULL,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                revoked_at TIMESTAMP WITH TIME ZONE
            )
            """.trimIndent(),
        )
    }
}
