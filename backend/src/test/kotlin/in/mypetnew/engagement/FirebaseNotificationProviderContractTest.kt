package `in`.mypetnew.engagement

import `in`.mypetnew.engagement.domain.NotificationProvider
import `in`.mypetnew.engagement.domain.ProviderDeliveryResult
import `in`.mypetnew.engagement.domain.PushDeliveryCommand
import `in`.mypetnew.engagement.infrastructure.FcmAccessTokenProvider
import `in`.mypetnew.engagement.infrastructure.FcmHttpResponse
import `in`.mypetnew.engagement.infrastructure.FcmTransport
import `in`.mypetnew.engagement.infrastructure.FirebaseNotificationProvider
import `in`.mypetnew.engagement.infrastructure.DeviceTokenCipher
import `in`.mypetnew.common.error.DomainException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import tools.jackson.databind.json.JsonMapper
import java.util.UUID

class FirebaseNotificationProviderContractTest {
    @Test
    fun `FCM adapter emits only safe routing data and redacts credentials from values`() {
        val transport = RecordingTransport(FcmHttpResponse(200, """{"name":"projects/dev/messages/message-1"}"""))
        val provider: NotificationProvider = FirebaseNotificationProvider(
            projectId = "mypet-dev",
            environment = "development",
            accessTokens = FcmAccessTokenProvider { "oauth-secret" },
            transport = transport,
            json = JsonMapper.builder().build(),
        )
        val command = command()

        val result = provider.send(command)

        assertInstanceOf(ProviderDeliveryResult.Delivered::class.java, result)
        assertEquals("mypet-dev", transport.projectId)
        assertEquals("oauth-secret", transport.accessToken)
        assertTrue(transport.body!!.contains("native-token"))
        assertTrue(transport.body!!.contains("merchant/orders/detail"))
        assertFalse(transport.body!!.contains("+919876543210"))
        assertFalse(command.toString().contains("native-token"))
        assertFalse(result.toString().contains("oauth-secret"))
    }

    @Test
    fun `FCM adapter classifies invalid tokens transient failures and environment mismatch`() {
        val invalid = provider(FcmHttpResponse(404, """{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}"""))
        assertInstanceOf(ProviderDeliveryResult.InvalidRegistration::class.java, invalid.send(command()))

        val transient = provider(FcmHttpResponse(503, "{}"))
        assertInstanceOf(ProviderDeliveryResult.TransientFailure::class.java, transient.send(command()))

        val mismatch = provider(FcmHttpResponse(200, "{}"))
        assertEquals(
            ProviderDeliveryResult.PermanentFailure("FCM_ENVIRONMENT_MISMATCH"),
            mismatch.send(command().copy(environment = "production")),
        )
    }

    @Test
    fun `device tokens use authenticated encryption and reject tampering`() {
        val cipher = DeviceTokenCipher(ByteArray(32) { it.toByte() })
        val protectedToken = cipher.encrypt("native-token")

        assertFalse(protectedToken.contains("native-token"))
        assertEquals("native-token", cipher.decrypt(protectedToken))
        val tampered = protectedToken.dropLast(2) + "AA"
        org.junit.jupiter.api.Assertions.assertThrows(DomainException::class.java) {
            cipher.decrypt(tampered)
        }
    }

    private fun provider(response: FcmHttpResponse): FirebaseNotificationProvider = FirebaseNotificationProvider(
        projectId = "mypet-dev",
        environment = "development",
        accessTokens = FcmAccessTokenProvider { "oauth-secret" },
        transport = RecordingTransport(response),
        json = JsonMapper.builder().build(),
    )

    private fun command(): PushDeliveryCommand {
        val notificationId = UUID.randomUUID()
        return PushDeliveryCommand(
            registrationId = UUID.randomUUID(),
            environment = "development",
            nativeToken = "native-token",
            notificationId = notificationId,
            title = "New pickup order",
            body = "Open MyPet Merchant to review the order.",
            data = mapOf(
                "notificationId" to notificationId.toString(),
                "resourceId" to UUID.randomUUID().toString(),
                "route" to "merchant/orders/detail",
                "eventType" to "pickup-order-placed",
            ),
        )
    }

    private class RecordingTransport(private val response: FcmHttpResponse) : FcmTransport {
        var projectId: String? = null
        var accessToken: String? = null
        var body: String? = null

        override fun send(projectId: String, accessToken: String, body: String): FcmHttpResponse {
            this.projectId = projectId
            this.accessToken = accessToken
            this.body = body
            return response
        }
    }
}
