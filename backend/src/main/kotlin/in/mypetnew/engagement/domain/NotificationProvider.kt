package `in`.mypetnew.engagement.domain

import `in`.mypetnew.common.error.DomainException
import java.util.UUID

data class PushDeliveryCommand(
    val registrationId: UUID,
    val environment: String,
    val nativeToken: String,
    val notificationId: UUID,
    val title: String,
    val body: String,
    val data: Map<String, String>,
) {
    init {
        val allowedKeys = setOf("notificationId", "resourceId", "route", "eventType")
        val safeRoutes = SafeRoute.entries.map(SafeRoute::wireValue).toSet()
        if (
            environment !in setOf("development", "staging", "production") ||
            nativeToken.isBlank() ||
            nativeToken.length > 4_096 ||
            title.length !in 1..80 ||
            body.length !in 1..240 ||
            data.keys != allowedKeys ||
            data.values.any { it.length > 160 } ||
            runCatching { UUID.fromString(data.getValue("notificationId")) }.isFailure ||
            data.getValue("notificationId") != notificationId.toString() ||
            runCatching { UUID.fromString(data.getValue("resourceId")) }.isFailure ||
            data.getValue("route") !in safeRoutes ||
            !data.getValue("eventType").matches(Regex("[a-z0-9-]{1,80}"))
        ) {
            throw DomainException("NOTIFICATION_DELIVERY_INVALID", "The notification cannot be delivered")
        }
    }

    override fun toString(): String =
        "PushDeliveryCommand(registrationId=$registrationId, environment=$environment, nativeToken=[REDACTED], " +
            "notificationId=$notificationId, title=$title, body=$body, data=$data)"
}

sealed interface ProviderDeliveryResult {
    data class Delivered(val providerReference: String) : ProviderDeliveryResult
    data class InvalidRegistration(val safeCode: String) : ProviderDeliveryResult
    data class TransientFailure(val safeCode: String) : ProviderDeliveryResult
    data class PermanentFailure(val safeCode: String) : ProviderDeliveryResult
}

fun interface NotificationProvider {
    fun send(command: PushDeliveryCommand): ProviderDeliveryResult
}
