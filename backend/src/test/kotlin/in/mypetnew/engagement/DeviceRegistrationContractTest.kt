package `in`.mypetnew.engagement

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.engagement.domain.AppKind
import `in`.mypetnew.engagement.domain.DeviceRegistrationService
import `in`.mypetnew.engagement.domain.Platform
import `in`.mypetnew.engagement.domain.RegistrationStatus
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
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
    fun `revoked registration cannot create or send future push attempts`() {
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

        service.revoke(userId, AppKind.CUSTOMER, installationId, "development")

        val activeDevices = service.activeFor(userId)
        assertTrue(activeDevices.isEmpty(), "No active devices should remain after revocation")
    }
}
