package `in`.mypetnew.engagement.domain

import `in`.mypetnew.common.error.DomainException
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

enum class AppKind { CUSTOMER, MERCHANT, CAPTAIN }

enum class Platform { ANDROID, IOS }

enum class RegistrationStatus { ACTIVE, ROTATED, DISABLED, REVOKED, INVALID, STALE }

enum class SafeRoute(val wireValue: String) {
    CUSTOMER_LOYALTY("customer/loyalty"),
    MERCHANT_ORDER("merchant/orders/detail"),
    INBOX("inbox"),
}

data class DeviceRegistration(
    val id: UUID,
    val userId: UUID,
    val appKind: AppKind,
    val platform: Platform,
    val installationId: UUID,
    val environment: String,
    val tokenFingerprint: String,
    val status: RegistrationStatus,
    val lastSeenAt: Instant,
)

class DeviceRegistrationService {
    private data class StoredRegistration(
        val public: DeviceRegistration,
        val protectedToken: String,
    )

    private val registrations = mutableMapOf<UUID, StoredRegistration>()

    @Synchronized
    fun register(
        userId: UUID,
        appKind: AppKind,
        platform: Platform,
        installationId: UUID,
        token: String,
        environment: String,
    ): DeviceRegistration {
        if (token.isBlank() || token.length > 4_096 || environment !in setOf("dev", "staging", "production")) {
            throw DomainException("DEVICE_REGISTRATION_INVALID", "The device registration is invalid")
        }
        registrations.replaceAll { _, stored ->
            if (
                stored.public.installationId == installationId &&
                stored.public.appKind == appKind &&
                stored.public.environment == environment &&
                stored.public.status == RegistrationStatus.ACTIVE
            ) {
                stored.copy(public = stored.public.copy(status = RegistrationStatus.ROTATED))
            } else {
                stored
            }
        }
        val fingerprint = fingerprint(token)
        val existing = registrations.values.firstOrNull {
            it.public.userId == userId &&
                it.public.installationId == installationId &&
                it.public.appKind == appKind &&
                it.public.environment == environment &&
                it.public.tokenFingerprint == fingerprint
        }
        if (existing != null) {
            val activated = existing.public.copy(status = RegistrationStatus.ACTIVE, lastSeenAt = Instant.now())
            registrations[activated.id] = existing.copy(public = activated)
            return activated
        }
        val registration = DeviceRegistration(
            id = UUID.randomUUID(),
            userId = userId,
            appKind = appKind,
            platform = platform,
            installationId = installationId,
            environment = environment,
            tokenFingerprint = fingerprint,
            status = RegistrationStatus.ACTIVE,
            lastSeenAt = Instant.now(),
        )
        registrations[registration.id] = StoredRegistration(registration, token)
        return registration
    }

    @Synchronized
    fun activeFor(userId: UUID): List<DeviceRegistration> = registrations.values
        .map(StoredRegistration::public)
        .filter { it.userId == userId && it.status == RegistrationStatus.ACTIVE }

    private fun fingerprint(token: String): String = MessageDigest.getInstance("SHA-256")
        .digest(token.toByteArray(StandardCharsets.UTF_8))
        .take(8)
        .joinToString("") { "%02x".format(it) }
}

data class Notification(
    val id: UUID,
    val sourceEventId: UUID,
    val recipientId: UUID,
    val templateVersion: String,
    val resourceId: UUID,
    val title: String,
    val body: String,
    val payload: Map<String, String>,
    val createdAt: Instant,
)

class NotificationService(private val devices: DeviceRegistrationService) {
    private data class DedupeKey(
        val sourceEventId: UUID,
        val recipientId: UUID,
        val templateVersion: String,
        val channel: String = "PUSH",
    )

    private val notifications = mutableMapOf<DedupeKey, Notification>()

    @Synchronized
    fun enqueue(
        sourceEventId: UUID,
        recipientId: UUID,
        templateVersion: String,
        title: String,
        body: String,
        route: SafeRoute,
        resourceId: UUID,
    ): Notification {
        if (title.length > 80 || body.length > 240 || templateVersion.length > 80) {
            throw DomainException("NOTIFICATION_TEMPLATE_INVALID", "The notification content is invalid")
        }
        val key = DedupeKey(sourceEventId, recipientId, templateVersion)
        return notifications[key] ?: Notification(
            id = UUID.randomUUID(),
            sourceEventId = sourceEventId,
            recipientId = recipientId,
            templateVersion = templateVersion,
            resourceId = resourceId,
            title = title,
            body = body,
            payload = mapOf(
                "notificationId" to UUID.randomUUID().toString(),
                "resourceId" to resourceId.toString(),
                "route" to route.wireValue,
                "eventType" to templateVersion.substringBefore("-v"),
            ),
            createdAt = Instant.now(),
        ).also { notification ->
            notifications[key] = notification
            devices.activeFor(recipientId)
        }
    }

    @Synchronized
    fun forRecipient(recipientId: UUID): List<Notification> = notifications.values
        .filter { it.recipientId == recipientId }
        .sortedByDescending(Notification::createdAt)
}
