package `in`.mypetnew.engagement

import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.engagement.domain.AppKind
import `in`.mypetnew.engagement.domain.DeviceRegistrationService
import `in`.mypetnew.engagement.domain.Notification
import `in`.mypetnew.engagement.domain.Platform
import `in`.mypetnew.engagement.domain.RegistrationStatus
import `in`.mypetnew.engagement.infrastructure.DeviceTokenCipher
import `in`.mypetnew.engagement.infrastructure.FirebaseProperties
import `in`.mypetnew.engagement.infrastructure.JdbcDeviceRegistrationPersistence
import `in`.mypetnew.engagement.infrastructure.JdbcNotificationDeliveryRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID

class DeviceRegistrationContractTest {
    @Test
    fun `active registration can be revoked by its owner and is no longer active`() {
        val service = DeviceRegistrationService()
        val userId = UUID.randomUUID()
        val installationId = UUID.randomUUID()

        val registered = service.register(
            userId = userId,
            appKind = AppKind.CUSTOMER,
            platform = Platform.ANDROID,
            installationId = installationId,
            token = "native-fcm-token-1",
            environment = "development",
        )

        assertEquals(RegistrationStatus.ACTIVE, registered.status)
        assertEquals(1, service.activeFor(userId).size)

        val revoked = service.revoke(
            userId = userId,
            appKind = AppKind.CUSTOMER,
            installationId = installationId,
            environment = "development",
        )

        assertTrue(revoked)
        assertEquals(0, service.activeFor(userId).size)
    }

    @Test
    fun `repeated revoke is idempotent and safe`() {
        val service = DeviceRegistrationService()
        val userId = UUID.randomUUID()
        val installationId = UUID.randomUUID()

        service.register(
            userId = userId,
            appKind = AppKind.CUSTOMER,
            platform = Platform.ANDROID,
            installationId = installationId,
            token = "native-fcm-token-1",
            environment = "development",
        )

        val firstRevoke = service.revoke(userId, AppKind.CUSTOMER, installationId, "development")
        assertTrue(firstRevoke)

        val secondRevoke = service.revoke(userId, AppKind.CUSTOMER, installationId, "development")
        assertFalse(secondRevoke)
    }

    @Test
    fun `another user cannot revoke installation belonging to another user`() {
        val service = DeviceRegistrationService()
        val user1 = UUID.randomUUID()
        val user2 = UUID.randomUUID()
        val installationId = UUID.randomUUID()

        service.register(
            userId = user1,
            appKind = AppKind.CUSTOMER,
            platform = Platform.ANDROID,
            installationId = installationId,
            token = "native-fcm-token-1",
            environment = "development",
        )

        val exception = assertThrows(DomainException::class.java) {
            service.revoke(user2, AppKind.CUSTOMER, installationId, "development")
        }
        assertEquals("DEVICE_REGISTRATION_INVALID", exception.code)
    }

    @Test
    fun `permission DENIED disables installation`() {
        val service = DeviceRegistrationService()
        val userId = UUID.randomUUID()
        val installationId = UUID.randomUUID()

        service.register(
            userId = userId,
            appKind = AppKind.CUSTOMER,
            platform = Platform.ANDROID,
            installationId = installationId,
            token = "native-fcm-token-1",
            environment = "development",
        )

        val denied = service.recordPermissionDenied(
            userId = userId,
            appKind = AppKind.CUSTOMER,
            platform = Platform.ANDROID,
            installationId = installationId,
            environment = "development",
        )

        assertEquals(RegistrationStatus.DISABLED, denied.status)
        assertEquals(0, service.activeFor(userId).size)
    }

    @Test
    fun `token rotation leaves only the correct ACTIVE binding`() {
        val service = DeviceRegistrationService()
        val userId = UUID.randomUUID()
        val installationId = UUID.randomUUID()

        service.register(
            userId = userId,
            appKind = AppKind.CUSTOMER,
            platform = Platform.ANDROID,
            installationId = installationId,
            token = "native-token-v1",
            environment = "development",
        )

        val rotated = service.register(
            userId = userId,
            appKind = AppKind.CUSTOMER,
            platform = Platform.ANDROID,
            installationId = installationId,
            token = "native-token-v2",
            environment = "development",
        )

        val activeList = service.activeFor(userId)
        assertEquals(1, activeList.size)
        assertEquals(rotated.id, activeList.first().id)
        assertEquals(RegistrationStatus.ACTIVE, activeList.first().status)
    }

    @Test
    fun `revoked registration generates zero notification attempt rows and cannot be claimed by worker`() {
        val dbName = "notify_attempt_${UUID.randomUUID().toString().replace("-", "")}"
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:$dbName;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
            "sa",
            "",
        )
        val jdbcTemplate = JdbcTemplate(dataSource)
        val transaction = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val jdbcClient = JdbcClient.create(dataSource)

        createNotificationTables(jdbcTemplate)

        val key = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
        val cipher = DeviceTokenCipher(key)
        val firebaseProps = FirebaseProperties(environment = "development", projectId = "mypet-dev")
        val objectMapper = tools.jackson.databind.ObjectMapper()

        val persistence = JdbcDeviceRegistrationPersistence(
            jdbc = jdbcClient,
            transaction = transaction,
            tokens = cipher,
        )
        val service = DeviceRegistrationService(persistence)
        val deliveryRepo = JdbcNotificationDeliveryRepository(
            jdbc = jdbcClient,
            transaction = transaction,
            tokenCipher = cipher,
            firebase = firebaseProps,
            json = objectMapper,
        )

        val userId = UUID.randomUUID()
        val sessionId = UUID.randomUUID()
        val installationId = UUID.randomUUID()

        jdbcTemplate.update(
            "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'CUSTOMER', 'ACTIVE')",
            userId,
            "+919876543210",
        )
        jdbcTemplate.update(
            "INSERT INTO mypet.user_session(id, account_id, refresh_token_hash, device_id, expires_at) VALUES (?, ?, 'hash', 'device-1', ?)",
            sessionId,
            userId,
            Instant.now().plusSeconds(3600),
        )

        val reg = persistence.register(
            userId = userId,
            role = Role.CUSTOMER,
            sessionId = sessionId,
            appKind = AppKind.CUSTOMER,
            platform = Platform.ANDROID,
            installationId = installationId,
            token = "fcm-native-token-1",
            environment = "development",
        )

        val notif1 = Notification(
            id = UUID.randomUUID(),
            sourceEventId = UUID.randomUUID(),
            recipientId = userId,
            templateVersion = "order-placed-v1",
            resourceId = UUID.randomUUID(),
            title = "Order Placed",
            body = "Your order was received.",
            payload = mapOf(
                "notificationId" to UUID.randomUUID().toString(),
                "resourceId" to UUID.randomUUID().toString(),
                "route" to "customer/loyalty",
                "eventType" to "order-placed",
            ),
            createdAt = Instant.now(),
        )
        deliveryRepo.putIfAbsent(notif1)

        val activeAttemptsCount = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM mypet.notification_attempt WHERE registration_id = ?",
            Int::class.java,
            reg.id,
        )
        assertEquals(1, activeAttemptsCount, "ACTIVE registration should generate a notification_attempt row")

        val claimedActive = deliveryRepo.claim(10, Instant.now())
        assertEquals(1, claimedActive.size, "Worker should claim attempt for ACTIVE registration")

        service.revoke(userId, AppKind.CUSTOMER, installationId, "development")

        val notif2 = Notification(
            id = UUID.randomUUID(),
            sourceEventId = UUID.randomUUID(),
            recipientId = userId,
            templateVersion = "order-shipped-v1",
            resourceId = UUID.randomUUID(),
            title = "Order Shipped",
            body = "Your order is on the way.",
            payload = mapOf(
                "notificationId" to UUID.randomUUID().toString(),
                "resourceId" to UUID.randomUUID().toString(),
                "route" to "customer/loyalty",
                "eventType" to "order-shipped",
            ),
            createdAt = Instant.now(),
        )
        deliveryRepo.putIfAbsent(notif2)

        val revokedAttemptsCount = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM mypet.notification_attempt WHERE notification_id = ?",
            Int::class.java,
            notif2.id,
        )
        assertEquals(0, revokedAttemptsCount, "REVOKED registration must generate ZERO notification_attempt rows")

        val claimedRevoked = deliveryRepo.claim(10, Instant.now())
        assertEquals(0, claimedRevoked.size, "Worker must claim ZERO attempts for REVOKED registration")
    }

    companion object {
        @JvmStatic
        fun hashtextextended(binding: String, seed: Long): Long {
            return binding.hashCode().toLong()
        }

        @JvmStatic
        fun pgAdvisoryXactLock(lockId: Long) {
            // No-op compatibility alias for H2 in PostgreSQL mode
        }
    }

    private fun createNotificationTables(jdbc: JdbcTemplate) {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS mypet")
        jdbc.execute("CREATE ALIAS IF NOT EXISTS hashtextextended FOR \"in.mypetnew.engagement.DeviceRegistrationContractTest.hashtextextended\"")
        jdbc.execute("CREATE ALIAS IF NOT EXISTS pg_advisory_xact_lock FOR \"in.mypetnew.engagement.DeviceRegistrationContractTest.pgAdvisoryXactLock\"")
        jdbc.execute(
            """
            CREATE TABLE IF NOT EXISTS mypet.identity_account (
                id UUID PRIMARY KEY,
                mobile_e164 VARCHAR(16) NOT NULL UNIQUE,
                role VARCHAR(32) NOT NULL,
                status VARCHAR(32) NOT NULL
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE IF NOT EXISTS mypet.user_session (
                id UUID PRIMARY KEY,
                account_id UUID NOT NULL REFERENCES mypet.identity_account(id),
                refresh_token_hash VARCHAR(128) NOT NULL UNIQUE,
                device_id VARCHAR(128) NOT NULL,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                revoked_at TIMESTAMP WITH TIME ZONE
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE IF NOT EXISTS mypet.device_registration (
                id UUID PRIMARY KEY,
                user_id UUID NOT NULL REFERENCES mypet.identity_account(id),
                role VARCHAR(32) NOT NULL,
                session_id UUID NOT NULL REFERENCES mypet.user_session(id),
                app_kind VARCHAR(32) NOT NULL,
                platform VARCHAR(32) NOT NULL,
                installation_id UUID NOT NULL,
                environment VARCHAR(32) NOT NULL,
                protected_token VARCHAR(2048) NOT NULL,
                token_fingerprint VARCHAR(64) NOT NULL,
                permission_state VARCHAR(32) NOT NULL,
                status VARCHAR(32) NOT NULL,
                last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE IF NOT EXISTS mypet.notification_item (
                id UUID PRIMARY KEY,
                source_event_id UUID NOT NULL,
                recipient_id UUID NOT NULL,
                event_type VARCHAR(80) NOT NULL,
                template_version VARCHAR(80) NOT NULL,
                safe_route VARCHAR(80) NOT NULL,
                resource_id UUID NOT NULL,
                title VARCHAR(80) NOT NULL,
                body VARCHAR(240) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
            """.trimIndent(),
        )
        jdbc.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_item_dedupe ON mypet.notification_item(source_event_id, recipient_id, template_version)")
        jdbc.execute(
            """
            CREATE TABLE IF NOT EXISTS mypet.notification_attempt (
                id UUID PRIMARY KEY,
                notification_id UUID NOT NULL REFERENCES mypet.notification_item(id),
                registration_id UUID NOT NULL REFERENCES mypet.device_registration(id),
                channel VARCHAR(32) NOT NULL,
                status VARCHAR(32) NOT NULL,
                attempt_count INT NOT NULL,
                next_attempt_at TIMESTAMP WITH TIME ZONE,
                claimed_at TIMESTAMP WITH TIME ZONE,
                provider_reference VARCHAR(160),
                safe_provider_code VARCHAR(80),
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """.trimIndent(),
        )
        jdbc.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_attempt_dedupe ON mypet.notification_attempt(notification_id, registration_id, channel)")
        jdbc.execute(
            """
            CREATE TABLE IF NOT EXISTS mypet.outbox_event (
                id UUID PRIMARY KEY,
                aggregate_type VARCHAR(64) NOT NULL,
                aggregate_id UUID NOT NULL,
                event_type VARCHAR(128) NOT NULL,
                event_version INT NOT NULL,
                payload TEXT NOT NULL,
                status VARCHAR(32) NOT NULL,
                trace_id VARCHAR(128),
                delivered_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE IF NOT EXISTS mypet.dead_letter (
                id UUID PRIMARY KEY,
                source_event_id UUID NOT NULL,
                consumer_name VARCHAR(128) NOT NULL,
                safe_error_code VARCHAR(80) NOT NULL,
                attempt_count INT NOT NULL,
                payload TEXT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """.trimIndent(),
        )
    }
}
