package `in`.mypetnew.application.web

import com.fasterxml.jackson.annotation.JsonProperty
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.customer.domain.CustomerAddress
import `in`.mypetnew.customer.domain.CustomerAddressInput
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.customer.domain.CustomerPet
import `in`.mypetnew.customer.domain.PetSpecies
import `in`.mypetnew.privacy.domain.PrivacyService
import org.springframework.http.HttpStatus
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

data class CustomerProfileResponse(
    val accountId: UUID,
    val name: String?,
    val mobile: String,
    val email: String?,
    val profileCompletion: Int,
)

data class CustomerProfilePatchRequest(
    val name: String? = null,
    val email: String? = null,
)

data class CustomerPetRequest(
    val name: String,
    val species: PetSpecies,
    val breed: String? = null,
    val dateOfBirth: LocalDate? = null,
)

data class CustomerPetResponse(
    val petId: UUID,
    val name: String,
    val species: PetSpecies,
    val breed: String?,
    val dateOfBirth: LocalDate?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class CustomerAddressRequest(
    val label: String,
    val recipientName: String,
    val phoneNumber: String,
    val line1: String,
    val line2: String? = null,
    val city: String,
    val state: String,
    val pincode: String,
    val isDefault: Boolean = false,
)

data class CustomerAddressResponse(
    val addressId: UUID,
    val label: String,
    val recipientName: String,
    val phoneNumber: String,
    val line1: String,
    val line2: String?,
    val city: String,
    val state: String,
    val pincode: String,
    @get:JsonProperty("isDefault")
    val isDefault: Boolean,
    val createdAt: Instant,
    val updatedAt: Instant,
)

@RestController
@RequestMapping("/api/v1/customer/profile")
class CustomerProfileApiController(
    private val privacy: PrivacyService,
) {
    @GetMapping
    fun get(authentication: Authentication): CustomerProfileResponse {
        val customerId = customer(authentication)
        return profile(customerId)
    }

    @PatchMapping
    fun update(
        authentication: Authentication,
        @RequestBody request: CustomerProfilePatchRequest,
    ): CustomerProfileResponse {
        val customerId = customer(authentication)
        val existing = privacy.summary(customerId).profile
        privacy.updateProfile(
            customerId = customerId,
            displayName = request.name ?: existing.displayName,
            email = request.email ?: existing.email,
            adultEligibilityAttested = false,
        )
        return profile(customerId)
    }

    private fun profile(customerId: UUID): CustomerProfileResponse {
        val summary = privacy.summary(customerId)
        val completion = if (summary.profile.displayName.isNullOrBlank()) 50 else 100
        return CustomerProfileResponse(
            accountId = customerId,
            name = summary.profile.displayName,
            mobile = summary.mobileE164,
            email = summary.profile.email,
            profileCompletion = completion,
        )
    }
}

@RestController
@RequestMapping("/api/v1/customer/pets")
class CustomerPetApiController(
    private val customerData: CustomerDataService,
) {
    @GetMapping
    fun list(
        authentication: Authentication,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") pageSize: Int,
    ): PageResponse<CustomerPetResponse> {
        val customerId = customer(authentication)
        PaginationHelper.validate(page, pageSize)
        val result = customerData.listPets(customerId, page, pageSize)
        return PageResponse(result.items.map(::petResponse), page, pageSize, result.hasNext)
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(
        authentication: Authentication,
        @RequestBody request: CustomerPetRequest,
    ): CustomerPetResponse {
        val customerId = customer(authentication)
        return petResponse(
            customerData.createPet(customerId, request.name, request.species, request.breed, request.dateOfBirth),
        )
    }

    @PatchMapping("/{petId}")
    fun update(
        authentication: Authentication,
        @PathVariable petId: UUID,
        @RequestBody request: CustomerPetRequest,
    ): CustomerPetResponse {
        val customerId = customer(authentication)
        return petResponse(
            customerData.updatePet(customerId, petId, request.name, request.species, request.breed, request.dateOfBirth),
        )
    }

    @DeleteMapping("/{petId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(authentication: Authentication, @PathVariable petId: UUID) {
        customerData.deletePet(customer(authentication), petId)
    }
}

@RestController
@RequestMapping("/api/v1/customer/addresses")
class CustomerAddressApiController(
    private val customerData: CustomerDataService,
) {
    @GetMapping
    fun list(authentication: Authentication): List<CustomerAddressResponse> =
        customerData.listAddresses(customer(authentication)).map(::addressResponse)

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(
        authentication: Authentication,
        @RequestBody request: CustomerAddressRequest,
    ): CustomerAddressResponse = addressResponse(
        customerData.createAddress(customer(authentication), request.toInput()),
    )

    @PatchMapping("/{addressId}")
    fun update(
        authentication: Authentication,
        @PathVariable addressId: UUID,
        @RequestBody request: CustomerAddressRequest,
    ): CustomerAddressResponse = addressResponse(
        customerData.updateAddress(customer(authentication), addressId, request.toInput()),
    )

    @DeleteMapping("/{addressId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(authentication: Authentication, @PathVariable addressId: UUID) {
        customerData.deleteAddress(customer(authentication), addressId)
    }
}

private fun customer(authentication: Authentication): UUID {
    val principal = authentication.domainPrincipal()
    Authorizer.requireRole(principal, Role.CUSTOMER)
    return principal.actorId
}

private fun petResponse(pet: CustomerPet) = CustomerPetResponse(
    petId = pet.id,
    name = pet.name,
    species = pet.species,
    breed = pet.breed,
    dateOfBirth = pet.dateOfBirth,
    createdAt = pet.createdAt,
    updatedAt = pet.updatedAt,
)

private fun CustomerAddressRequest.toInput() = CustomerAddressInput(
    label = label,
    recipientName = recipientName,
    phoneNumber = phoneNumber,
    line1 = line1,
    line2 = line2,
    city = city,
    state = state,
    pincode = pincode,
    isDefault = isDefault,
)

private fun addressResponse(address: CustomerAddress) = CustomerAddressResponse(
    addressId = address.id,
    label = address.label,
    recipientName = address.recipientName,
    phoneNumber = address.phoneNumber,
    line1 = address.line1,
    line2 = address.line2,
    city = address.city,
    state = address.state,
    pincode = address.pincode,
    isDefault = address.isDefault,
    createdAt = address.createdAt,
    updatedAt = address.updatedAt,
)
