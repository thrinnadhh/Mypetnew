package `in`.mypetnew.application.web

import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.engagement.domain.AppKind
import `in`.mypetnew.engagement.domain.DeviceRegistration
import `in`.mypetnew.engagement.domain.DeviceRegistrationService
import `in`.mypetnew.engagement.domain.Notification
import `in`.mypetnew.engagement.domain.NotificationService
import `in`.mypetnew.engagement.domain.Platform
import `in`.mypetnew.privacy.domain.ConsentPurpose
import `in`.mypetnew.privacy.domain.PrivacyService
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

data class RegisterDeviceRequest(
    val appKind: AppKind,
    val environment: String,
    val installationId: UUID,
    val platform: Platform,
    val nativeToken: String,
    val permissionState: String,
)

data class NotificationPage(val items: List<Notification>)

@RestController
@RequestMapping("/api/v1")
class NotificationApiController(
    private val devices: DeviceRegistrationService,
    private val notifications: NotificationService,
    private val privacy: PrivacyService,
) {
    @PostMapping("/devices/registrations")
    fun register(authentication: Authentication, @RequestBody request: RegisterDeviceRequest): DeviceRegistration {
        val principal = authentication.domainPrincipal()
        val requiredRole = when (request.appKind) {
            AppKind.CUSTOMER -> Role.CUSTOMER
            AppKind.MERCHANT -> Role.MERCHANT
            AppKind.CAPTAIN -> Role.CAPTAIN
        }
        Authorizer.requireRole(principal, requiredRole)
        if (request.permissionState == "DENIED") {
            return devices.recordPermissionDenied(
                principal.actorId,
                request.appKind,
                request.platform,
                request.installationId,
                request.environment,
                principal.role,
                principal.sessionId,
            )
        }
        if (request.permissionState != "GRANTED" || request.nativeToken.isBlank()) {
            throw DomainException("DEVICE_REGISTRATION_INVALID", "The device registration is invalid")
        }
        if (request.appKind == AppKind.CUSTOMER) {
            privacy.requireActiveConsent(principal.actorId, ConsentPurpose.NOTIFICATIONS)
        }
        return devices.register(
            principal.actorId,
            request.appKind,
            request.platform,
            request.installationId,
            request.nativeToken,
            request.environment,
            principal.role,
            principal.sessionId,
        )
    }

    @GetMapping("/notifications")
    fun inbox(authentication: Authentication): NotificationPage {
        val principal = authentication.domainPrincipal()
        return NotificationPage(notifications.forRecipient(principal.actorId))
    }

    @DeleteMapping("/devices/registrations/{installationId}")
    fun unregister(
        authentication: Authentication,
        @PathVariable installationId: UUID,
        @RequestParam appKind: AppKind,
        @RequestParam environment: String,
    ) {
        val principal = authentication.domainPrincipal()
        val requiredRole = when (appKind) {
            AppKind.CUSTOMER -> Role.CUSTOMER
            AppKind.MERCHANT -> Role.MERCHANT
            AppKind.CAPTAIN -> Role.CAPTAIN
        }
        Authorizer.requireRole(principal, requiredRole)
        devices.unregister(principal.actorId, appKind, installationId, environment)
    }
}
