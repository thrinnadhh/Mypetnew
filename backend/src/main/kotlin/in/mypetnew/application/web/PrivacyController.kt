package `in`.mypetnew.application.web

import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.customer.domain.CustomerFavouriteService
import `in`.mypetnew.delivery.domain.DeliveryDataEraser
import `in`.mypetnew.privacy.domain.AccountDeletionReceipt
import `in`.mypetnew.privacy.domain.ConsentPurpose
import `in`.mypetnew.privacy.domain.ConsentRecord
import `in`.mypetnew.privacy.domain.ConsentSource
import `in`.mypetnew.privacy.domain.CustomerProfile
import `in`.mypetnew.privacy.domain.PersonalDataSummary
import `in`.mypetnew.privacy.domain.PrivacyService
import `in`.mypetnew.privacy.domain.RightsRequest
import `in`.mypetnew.privacy.domain.RightsRequestType
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

data class UpdateCustomerProfileRequest(
    val displayName: String?,
    val email: String?,
)

data class GrantConsentRequest(
    val noticeVersion: String,
    val source: ConsentSource,
)

data class CreateRightsRequest(
    val requestType: RightsRequestType,
    val details: String?,
)

data class CreateGrievanceRequest(val details: String)
data class CreateNominationRequest(val details: String?)
data class DeleteAccountRequest(val confirmation: String)
data class ConsentPage(val items: List<ConsentRecord>)
data class RightsRequestPage(val items: List<RightsRequest>)

@RestController
@RequestMapping("/api/v1/privacy")
class PrivacyController(
    private val privacy: PrivacyService,
    private val customerData: CustomerDataService,
    private val favourites: CustomerFavouriteService,
    private val deliveryData: DeliveryDataEraser,
) {
    @GetMapping("/me")
    fun summary(authentication: Authentication): PersonalDataSummary = withCustomer(authentication) { customerId ->
        privacy.summary(customerId)
    }

    @PatchMapping("/me")
    fun updateProfile(
        authentication: Authentication,
        @RequestBody request: UpdateCustomerProfileRequest,
    ): CustomerProfile = withCustomer(authentication) { customerId ->
        privacy.updateProfile(
            customerId,
            request.displayName,
            request.email,
            adultEligibilityAttested = false,
        )
    }

    @GetMapping("/consents")
    fun consents(authentication: Authentication): ConsentPage = withCustomer(authentication) { customerId ->
        ConsentPage(privacy.consents(customerId))
    }

    @PutMapping("/consents/{purpose}")
    fun grantConsent(
        authentication: Authentication,
        @PathVariable purpose: ConsentPurpose,
        @RequestBody request: GrantConsentRequest,
    ): ConsentRecord = withCustomer(authentication) { customerId ->
        if (request.source != ConsentSource.CUSTOMER_APP) {
            throw DomainException(
                "CONSENT_SOURCE_INVALID",
                "The consent source is invalid for this endpoint",
            )
        }
        privacy.grantConsent(customerId, purpose, request.noticeVersion, ConsentSource.CUSTOMER_APP)
    }

    @DeleteMapping("/consents/{purpose}")
    fun withdrawConsent(
        authentication: Authentication,
        @PathVariable purpose: ConsentPurpose,
    ): ConsentRecord = withCustomer(authentication) { customerId ->
        privacy.withdrawConsent(customerId, purpose)
    }

    @PostMapping("/rights-requests")
    fun createRightsRequest(
        authentication: Authentication,
        @RequestBody request: CreateRightsRequest,
    ): RightsRequest = withCustomer(authentication) { customerId ->
        privacy.createRightsRequest(customerId, request.requestType, request.details)
    }

    @GetMapping("/rights-requests")
    fun rightsRequests(authentication: Authentication): RightsRequestPage = withCustomer(authentication) { customerId ->
        RightsRequestPage(privacy.requests(customerId))
    }

    @GetMapping("/rights-requests/{requestId}")
    fun rightsRequest(
        authentication: Authentication,
        @PathVariable requestId: UUID,
    ): RightsRequest = withCustomer(authentication) { customerId ->
        privacy.request(customerId, requestId)
    }

    @PostMapping("/grievances")
    fun createGrievance(
        authentication: Authentication,
        @RequestBody request: CreateGrievanceRequest,
    ): RightsRequest = withCustomer(authentication) { customerId ->
        privacy.createRightsRequest(customerId, RightsRequestType.GRIEVANCE, request.details)
    }

    @PostMapping("/nomination")
    fun createNomination(
        authentication: Authentication,
        @RequestBody request: CreateNominationRequest,
    ): RightsRequest = withCustomer(authentication) { customerId ->
        privacy.createRightsRequest(customerId, RightsRequestType.NOMINATION, request.details)
    }

    @DeleteMapping("/account")
    fun deleteAccount(
        authentication: Authentication,
        @RequestBody request: DeleteAccountRequest,
    ): AccountDeletionReceipt = withCustomer(authentication) { customerId ->
        if (request.confirmation != "DELETE") {
            throw DomainException("ACCOUNT_DELETE_CONFIRMATION_INVALID", "Account deletion was not confirmed")
        }
        // Erase Customer-owned product data and delivery-only direct identifiers first. Each operation is idempotent
        // so retrying the privacy request remains safe if a later stage fails after an earlier erasure completed.
        customerData.eraseCustomerOwnedData(customerId)
        favourites.eraseAll(customerId)
        deliveryData.eraseCustomerDeliveryIdentifiers(customerId)
        privacy.deleteAccount(customerId, request.confirmation)
    }

    private fun <T> withCustomer(authentication: Authentication, action: (UUID) -> T): T {
        val principal = authentication.domainPrincipal()
        Authorizer.requireRole(principal, Role.CUSTOMER)
        return action(principal.actorId)
    }
}
