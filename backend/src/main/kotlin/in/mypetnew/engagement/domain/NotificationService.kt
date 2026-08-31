package `in`.mypetnew.engagement.domain

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.auth.Role
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

enum class AppKind { CUSTOMER, MERCHANT, CAPTAIN }

enum class Platform { ANDROID, IOS }

enum class RegistrationStatus { ACTIVE, ROTATED, DISABLED, REVOKED, INVALID, STALE }

enum class SafeRoute(val wireValue: String) {
    CUSTOMER_LOYALTY("customer/loyalty"),
    CUSTOMER_ORDER("customer/orders/detail"),
    CUSTOMER_APPOINTMENT("customer/appointments/detail"),
    MERCHANT_ORDER("merchant/orders/detail"),
    MERCHANT_APPOINTMENT("merchant/appointments/detail"),
    MERCHANT_CATALOG("merchant/catalog/detail"),
    MERCHANT_INVENTORY("merchant/inventory/detail"),
    CAPTAIN_OFFER("captain/dispatch/offer"),
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

interface DeviceRegistrationPersistence {
    fun register(
        userId: UUID,
        role: Role,
        sessionId: UUID,
        appKind: AppKind,
        platform: Platform,
        installationId: UUID,
        token: String,
        environment: String,
    ): DeviceRegistration

    fun recordPermissionDenied(
        userId: UUID,
        role: Role,
        sessionId: UUID,
        appKind: AppKind,
        platform: Platform,
        installationId: UUID,
        environment: String,
    ): DeviceRegistration

    fun activeFor(userId: UUID): List<DeviceRegistration>
    fun revoke(
        userId: UUID,
        appKind: AppKind,
        installationId: UUID,
        environment: String,
    ): Boolean

    fun revokeAll(userId: UUID)
}

class DeviceRegistrationService(private val persistence: DeviceRegistrationPersistence? = null) {
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
        role: Role = roleFor(appKind),
        sessionId: UUID = UUID.randomUUID(),
    ): DeviceRegistration {
        if (token.isBlank() || token.length > 4_096 || environment !in setOf("development", "staging", "production")) {
            throw DomainException("DEVICE_REGISTRATION_INVALID", "The device registration is invalid")
        }
        persistence?.let {
            return it.register(userId, role, sessionId, appKind, platform, installationId, token, environment)
        }
        requireInstallationOwner(userId, appKind, installationId, environment)
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
            registrations[activated.id] = existing.copy(public = activated, protectedToken = token)
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
    fun recordPermissionDenied(
        userId: UUID,
        appKind: AppKind,
        platform: Platform,
        installationId: UUID,
        environment: String,
        role: Role = roleFor(appKind),
        sessionId: UUID = UUID.randomUUID(),
    ): DeviceRegistration {
        if (environment !in setOf("development", "staging", "production")) {
            throw DomainException("DEVICE_REGISTRATION_INVALID", "The device registration is invalid")
        }
        persistence?.let {
            return it.recordPermissionDenied(
                userId,
                role,
                sessionId,
                appKind,
                platform,
                installationId,
                environment,
            )
        }
        requireInstallationOwner(userId, appKind, installationId, environment)
        registrations.replaceAll { _, stored ->
            if (
                stored.public.installationId == installationId &&
                stored.public.appKind == appKind &&
                stored.public.environment == environment
            ) {
                stored.copy(
                    public = stored.public.copy(status = RegistrationStatus.DISABLED),
                    protectedToken = "",
                )
            } else {
                stored
            }
        }
        val existing = registrations.values.firstOrNull {
            it.public.userId == userId &&
                it.public.installationId == installationId &&
                it.public.appKind == appKind &&
                it.public.environment == environment &&
                it.public.tokenFingerprint == "permission-denied"
        }
        if (existing != null) {
            val refreshed = existing.public.copy(lastSeenAt = Instant.now())
            registrations[refreshed.id] = existing.copy(public = refreshed)
            return refreshed
        }
        val disabled = DeviceRegistration(
            id = UUID.randomUUID(),
            userId = userId,
            appKind = appKind,
            platform = platform,
            installationId = installationId,
            environment = environment,
            tokenFingerprint = "permission-denied",
            status = RegistrationStatus.DISABLED,
            lastSeenAt = Instant.now(),
        )
        registrations[disabled.id] = StoredRegistration(disabled, "")
        return disabled
    }

    @Synchronized
    fun activeFor(userId: UUID): List<DeviceRegistration> = persistence?.activeFor(userId)
        ?: registrations.values.map(StoredRegistration::public)
            .filter { it.userId == userId && it.status == RegistrationStatus.ACTIVE }

    @Synchronized
    fun revoke(
        userId: UUID,
        appKind: AppKind,
        installationId: UUID,
        environment: String,
    ): Boolean {
        if (environment !in setOf("development", "staging", "production")) {
            throw DomainException("DEVICE_REGISTRATION_INVALID", "The device registration is invalid")
        }
        persistence?.let {
            return it.revoke(userId, appKind, installationId, environment)
        }
        requireInstallationOwner(userId, appKind, installationId, environment)
        var revokedAny = false
        registrations.replaceAll { _, stored ->
            if (
                stored.public.userId == userId &&
                stored.public.installationId == installationId &&
                stored.public.appKind == appKind &&
                stored.public.environment == environment &&
                stored.public.status != RegistrationStatus.REVOKED
            ) {
                revokedAny = true
                stored.copy(
                    public = stored.public.copy(status = RegistrationStatus.REVOKED),
                    protectedToken = "",
                )
            } else {
                stored
            }
        }
        return revokedAny
    }

    @Synchronized
    fun revokeAll(userId: UUID) {
        persistence?.let {
            it.revokeAll(userId)
            return
        }
        registrations.replaceAll { _, stored ->
            if (stored.public.userId == userId) {
                stored.copy(
                    public = stored.public.copy(status = RegistrationStatus.REVOKED),
                    protectedToken = "",
                )
            } else {
                stored
            }
        }
    }

    private fun requireInstallationOwner(
        userId: UUID,
        appKind: AppKind,
        installationId: UUID,
        environment: String,
    ) {
        val belongsToAnotherUser = registrations.values.any {
            it.public.userId != userId &&
                it.public.installationId == installationId &&
                it.public.appKind == appKind &&
                it.public.environment == environment &&
                it.public.status != RegistrationStatus.REVOKED
        }
        if (belongsToAnotherUser) {
            throw DomainException("DEVICE_REGISTRATION_INVALID", "The device registration is invalid")
        }
    }

    private fun fingerprint(token: String): String = MessageDigest.getInstance("SHA-256")
        .digest(token.toByteArray(StandardCharsets.UTF_8))
        .take(8)
        .joinToString("") { "%02x".format(it) }

    companion object {
        private fun roleFor(appKind: AppKind): Role = when (appKind) {
            AppKind.CUSTOMER -> Role.CUSTOMER
            AppKind.MERCHANT -> Role.MERCHANT
            AppKind.CAPTAIN -> Role.CAPTAIN
        }
    }
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

interface NotificationRepository {
    fun putIfAbsent(notification: Notification): Notification
    fun forRecipient(recipientId: UUID): List<Notification>
}

class InMemoryNotificationRepository : NotificationRepository {
    private data class DedupeKey(
        val sourceEventId: UUID,
        val recipientId: UUID,
        val templateVersion: String,
    )

    private val notifications = mutableMapOf<DedupeKey, Notification>()

    @Synchronized
    override fun putIfAbsent(notification: Notification): Notification {
        val key = DedupeKey(notification.sourceEventId, notification.recipientId, notification.templateVersion)
        return notifications.getOrPut(key) { notification }
    }

    @Synchronized
    override fun forRecipient(recipientId: UUID): List<Notification> = notifications.values
        .filter { it.recipientId == recipientId }
        .sortedByDescending(Notification::createdAt)
}

class NotificationService(private val repository: NotificationRepository = InMemoryNotificationRepository()) {
    fun enqueue(
        sourceEventId: UUID,
        recipientId: UUID,
        templateVersion: String,
        title: String,
        body: String,
        route: SafeRoute,
        resourceId: UUID,
    ): Notification {
        val eventType = templateVersion.substringBefore("-v")
        if (
            title.length !in 1..80 ||
            body.length !in 1..240 ||
            templateVersion.length !in 1..80 ||
            !eventType.matches(Regex("[a-z0-9-]{1,80}"))
        ) {
            throw DomainException("NOTIFICATION_TEMPLATE_INVALID", "The notification content is invalid")
        }
        if (RESTRICTED_NOTIFICATION_CONTENT.containsMatchIn("$title $body")) {
            throw DomainException("NOTIFICATION_CONTENT_RESTRICTED", "The notification content is not lock-screen safe")
        }
        val approved = APPROVED_LOCK_SCREEN_TEMPLATES[templateVersion]
            ?: throw DomainException("NOTIFICATION_TEMPLATE_INVALID", "The notification template is not approved")
        if (approved.title != title || approved.body != body || approved.route != route) {
            throw DomainException("NOTIFICATION_CONTENT_RESTRICTED", "The notification content is not lock-screen safe")
        }
        val notificationId = UUID.randomUUID()
        val candidate = Notification(
            id = notificationId,
            sourceEventId = sourceEventId,
            recipientId = recipientId,
            templateVersion = templateVersion,
            resourceId = resourceId,
            title = title,
            body = body,
            payload = mapOf(
                "notificationId" to notificationId.toString(),
                "resourceId" to resourceId.toString(),
                "route" to route.wireValue,
                "eventType" to eventType,
            ),
            createdAt = Instant.now(),
        )
        return repository.putIfAbsent(candidate)
    }

    fun forRecipient(recipientId: UUID): List<Notification> = repository.forRecipient(recipientId)

    companion object {
        private data class ApprovedTemplate(val title: String, val body: String, val route: SafeRoute)

        private val APPROVED_LOCK_SCREEN_TEMPLATES = mapOf(
            "pickup-order-placed-v1" to ApprovedTemplate(
                "New pickup order",
                "Open MyPet Merchant to review a new pickup order.",
                SafeRoute.MERCHANT_ORDER,
            ),
            "delivery-order-placed-v1" to ApprovedTemplate(
                "New delivery order",
                "Open MyPet Merchant to review a new Captain-delivery order.",
                SafeRoute.MERCHANT_ORDER,
            ),
            "pos-star-v1" to ApprovedTemplate(
                "You earned a loyalty star",
                "Open MyPet to view your merchant loyalty activity.",
                SafeRoute.CUSTOMER_LOYALTY,
            ),
            "captain-dispatch-offer-v1" to ApprovedTemplate(
                "New delivery assignment",
                "Open MyPet Captain to review an available delivery.",
                SafeRoute.CAPTAIN_OFFER,
            ),
            "customer-order-accepted-v1" to ApprovedTemplate(
                "Order accepted",
                "The store accepted your order and is preparing it.",
                SafeRoute.CUSTOMER_ORDER,
            ),
            "customer-order-ready-v1" to ApprovedTemplate(
                "Order ready",
                "Your order is ready at the store counter.",
                SafeRoute.CUSTOMER_ORDER,
            ),
            "customer-order-out-for-delivery-v1" to ApprovedTemplate(
                "Order on the way",
                "A Captain picked up your order. Follow live tracking in MyPet.",
                SafeRoute.CUSTOMER_ORDER,
            ),
            "customer-order-delivered-v1" to ApprovedTemplate(
                "Order delivered",
                "Your order was delivered. Thank you for shopping with MyPet.",
                SafeRoute.CUSTOMER_ORDER,
            ),
            "customer-order-cancelled-v1" to ApprovedTemplate(
                "Order update",
                "Your order was cancelled by the store. Open MyPet for details.",
                SafeRoute.CUSTOMER_ORDER,
            ),
            "merchant-appointment-booked-v1" to ApprovedTemplate(
                "New appointment request",
                "Open MyPet Merchant to review a new appointment request.",
                SafeRoute.MERCHANT_APPOINTMENT,
            ),
            "merchant-appointment-cancelled-v1" to ApprovedTemplate(
                "Appointment cancelled",
                "A customer cancelled an appointment. Open MyPet Merchant for details.",
                SafeRoute.MERCHANT_APPOINTMENT,
            ),
            "customer-appointment-confirmed-v1" to ApprovedTemplate(
                "Appointment confirmed",
                "The provider confirmed your booking request.",
                SafeRoute.CUSTOMER_APPOINTMENT,
            ),
            "customer-appointment-declined-v1" to ApprovedTemplate(
                "Appointment update",
                "The provider could not accept your booking request. Open MyPet for details.",
                SafeRoute.CUSTOMER_APPOINTMENT,
            ),
        )
        private val RESTRICTED_NOTIFICATION_CONTENT = Regex(
            "(?i)(\\+91[6-9][0-9]{9}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}|\\b(otp|cvv|cvc|upi[ _-]?pin|bank[ _-]?password|card[ _-]?number|prescription|diagnosis)\\b|\\b(latitude|longitude)\\s*[:=])",
        )
    }
}
