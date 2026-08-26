package `in`.mypetnew.engagement

import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.engagement.domain.AppKind
import `in`.mypetnew.engagement.domain.DeviceRegistrationService
import `in`.mypetnew.engagement.domain.Platform
import `in`.mypetnew.engagement.infrastructure.DeviceTokenCipher
import `in`.mypetnew.engagement.infrastructure.JdbcDeviceRegistrationPersistence
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.transaction.support.TransactionTemplate

class DeviceRegistrationAccountSwitchTest {
    @Test
    fun `in-memory binding blocks foreign active owner but can be reused after revoke`() {
        val service = DeviceRegistrationService()
        val userA = UUID.randomUUID()
        val userB = UUID.randomUUID()
        val installation = UUID.randomUUID()

        service.register(userA, AppKind.CUSTOMER, Platform.ANDROID, installation, "token-a", "development")
        val foreign = assertThrows(DomainException::class.java) {
            service.register(userB, AppKind.CUSTOMER, Platform.ANDROID, installation, "token-b", "development")
        }
        assertEquals("DEVICE_REGISTRATION_INVALID", foreign.code)

        assertTrue(service.revoke(userA, AppKind.CUSTOMER, installation, "development"))
        val rebound = service.register(userB, AppKind.CUSTOMER, Platform.ANDROID, installation, "token-b", "development")
        assertEquals(userB, rebound.userId)
        assertEquals(0, service.activeFor(userA).size)
        assertEquals(1, service.activeFor(userB).size)
    }

    @Test
    fun `jdbc binding preserves active ownership and releases it after explicit revoke`() {
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:device_switch_${UUID.randomUUID().toString().replace("-", "")};MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
            "sa",
            "",
        )
        val template = JdbcTemplate(dataSource)
        createSchema(template)
        val persistence = JdbcDeviceRegistrationPersistence(
            JdbcClient.create(dataSource),
            TransactionTemplate(DataSourceTransactionManager(dataSource)),
            DeviceTokenCipher(ByteArray(32) { (it + 1).toByte() }),
        )
        val userA = UUID.randomUUID()
        val userB = UUID.randomUUID()
        val sessionA = UUID.randomUUID()
        val sessionB = UUID.randomUUID()
        val installation = UUID.randomUUID()
        insertIdentity(template, userA, sessionA, "+919876543210")
        insertIdentity(template, userB, sessionB, "+919876543211")

        persistence.register(userA, Role.CUSTOMER, sessionA, AppKind.CUSTOMER, Platform.ANDROID, installation, "token-a", "development")
        val foreign = assertThrows(DomainException::class.java) {
            persistence.register(userB, Role.CUSTOMER, sessionB, AppKind.CUSTOMER, Platform.ANDROID, installation, "token-b", "development")
        }
        assertEquals("DEVICE_REGISTRATION_INVALID", foreign.code)

        assertTrue(persistence.revoke(userA, AppKind.CUSTOMER, installation, "development"))
        val rebound = persistence.register(userB, Role.CUSTOMER, sessionB, AppKind.CUSTOMER, Platform.ANDROID, installation, "token-b", "development")
        assertEquals(userB, rebound.userId)
        assertEquals(0, persistence.activeFor(userA).size)
        assertEquals(1, persistence.activeFor(userB).size)
    }

    private fun insertIdentity(template: JdbcTemplate, userId: UUID, sessionId: UUID, mobile: String) {
        template.update(
            "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'CUSTOMER', 'ACTIVE')",
            userId,
            mobile,
        )
        template.update(
            "INSERT INTO mypet.user_session(id, account_id, refresh_token_hash, device_id, expires_at) VALUES (?, ?, ?, ?, ?)",
            sessionId,
            userId,
            "hash-$sessionId",
            "device-$sessionId",
            Instant.now().plusSeconds(3600),
        )
    }

    private fun createSchema(template: JdbcTemplate) {
        template.execute("CREATE SCHEMA IF NOT EXISTS mypet")
        template.execute("CREATE ALIAS IF NOT EXISTS hashtextextended FOR \"in.mypetnew.engagement.DeviceRegistrationAccountSwitchTest.hashtextextended\"")
        template.execute("CREATE ALIAS IF NOT EXISTS pg_advisory_xact_lock FOR \"in.mypetnew.engagement.DeviceRegistrationAccountSwitchTest.pgAdvisoryXactLock\"")
        template.execute("CREATE TABLE mypet.identity_account(id UUID PRIMARY KEY, mobile_e164 VARCHAR(16) UNIQUE NOT NULL, role VARCHAR(32) NOT NULL, status VARCHAR(32) NOT NULL)")
        template.execute("CREATE TABLE mypet.user_session(id UUID PRIMARY KEY, account_id UUID NOT NULL REFERENCES mypet.identity_account(id), refresh_token_hash VARCHAR(128) UNIQUE NOT NULL, device_id VARCHAR(128) NOT NULL, expires_at TIMESTAMP WITH TIME ZONE NOT NULL, revoked_at TIMESTAMP WITH TIME ZONE)")
        template.execute(
            """
            CREATE TABLE mypet.device_registration(
                id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES mypet.identity_account(id), role VARCHAR(32) NOT NULL,
                session_id UUID NOT NULL REFERENCES mypet.user_session(id), app_kind VARCHAR(32) NOT NULL, platform VARCHAR(32) NOT NULL,
                installation_id UUID NOT NULL, environment VARCHAR(32) NOT NULL, protected_token VARCHAR(2048) NOT NULL,
                token_fingerprint VARCHAR(64) NOT NULL, permission_state VARCHAR(32) NOT NULL, status VARCHAR(32) NOT NULL,
                last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """.trimIndent(),
        )
    }

    companion object {
        @JvmStatic fun hashtextextended(binding: String, seed: Long): Long = binding.hashCode().toLong() + seed
        @JvmStatic fun pgAdvisoryXactLock(lockId: Long) { require(lockId == lockId) }
    }
}
