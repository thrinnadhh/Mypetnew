package `in`.mypetnew.customer.domain

import `in`.mypetnew.common.error.DomainException
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

enum class PetSpecies { DOG, CAT, OTHER }

data class CustomerPet(
    val id: UUID,
    val customerId: UUID,
    val name: String,
    val species: PetSpecies,
    val breed: String?,
    val dateOfBirth: LocalDate?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class CustomerPetPage(
    val items: List<CustomerPet>,
    val hasNext: Boolean,
)

data class CustomerAddress(
    val id: UUID,
    val customerId: UUID,
    val label: String,
    val recipientName: String,
    val phoneNumber: String,
    val line1: String,
    val line2: String?,
    val city: String,
    val state: String,
    val pincode: String,
    val isDefault: Boolean,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class CustomerAddressInput(
    val label: String,
    val recipientName: String,
    val phoneNumber: String,
    val line1: String,
    val line2: String?,
    val city: String,
    val state: String,
    val pincode: String,
    val isDefault: Boolean,
)

interface CustomerDataPersistence {
    fun listPets(customerId: UUID, page: Int, pageSize: Int): CustomerPetPage
    fun getPet(customerId: UUID, petId: UUID): CustomerPet?
    fun createPet(pet: CustomerPet): CustomerPet
    fun updatePet(pet: CustomerPet): CustomerPet?
    fun deletePet(customerId: UUID, petId: UUID): Boolean

    fun listAddresses(customerId: UUID): List<CustomerAddress>
    fun getAddress(customerId: UUID, addressId: UUID): CustomerAddress?
    fun createAddress(address: CustomerAddress): CustomerAddress
    fun updateAddress(address: CustomerAddress): CustomerAddress?
    fun deleteAddress(customerId: UUID, addressId: UUID, now: Instant): Boolean

    fun eraseCustomerOwnedData(customerId: UUID)
}

class InMemoryCustomerDataPersistence : CustomerDataPersistence {
    private val pets = mutableMapOf<UUID, CustomerPet>()
    private val addresses = mutableMapOf<UUID, CustomerAddress>()

    @Synchronized
    override fun listPets(customerId: UUID, page: Int, pageSize: Int): CustomerPetPage {
        val ordered = pets.values
            .filter { it.customerId == customerId }
            .sortedWith(compareByDescending<CustomerPet> { it.createdAt }.thenByDescending { it.id.toString() })
        val offset = page.toLong() * pageSize.toLong()
        if (offset >= ordered.size.toLong()) return CustomerPetPage(emptyList(), false)
        val candidates = ordered.drop(offset.toInt()).take(pageSize + 1)
        return CustomerPetPage(candidates.take(pageSize), candidates.size > pageSize)
    }

    @Synchronized
    override fun getPet(customerId: UUID, petId: UUID): CustomerPet? = pets[petId]?.takeIf { it.customerId == customerId }

    @Synchronized
    override fun createPet(pet: CustomerPet): CustomerPet = pet.also { pets[it.id] = it }

    @Synchronized
    override fun updatePet(pet: CustomerPet): CustomerPet? {
        val current = pets[pet.id]?.takeIf { it.customerId == pet.customerId } ?: return null
        pets[pet.id] = pet.copy(createdAt = current.createdAt)
        return pets[pet.id]
    }

    @Synchronized
    override fun deletePet(customerId: UUID, petId: UUID): Boolean {
        if (pets[petId]?.customerId != customerId) return false
        pets.remove(petId)
        return true
    }

    @Synchronized
    override fun listAddresses(customerId: UUID): List<CustomerAddress> = addresses.values
        .filter { it.customerId == customerId }
        .sortedWith(
            compareByDescending<CustomerAddress> { it.isDefault }
                .thenByDescending { it.updatedAt }
                .thenByDescending { it.id.toString() },
        )

    @Synchronized
    override fun getAddress(customerId: UUID, addressId: UUID): CustomerAddress? =
        addresses[addressId]?.takeIf { it.customerId == customerId }

    @Synchronized
    override fun createAddress(address: CustomerAddress): CustomerAddress {
        val existing = addresses.values.filter { it.customerId == address.customerId }
        val shouldDefault = address.isDefault || existing.isEmpty()
        if (shouldDefault) clearDefaults(address.customerId)
        val stored = address.copy(isDefault = shouldDefault)
        addresses[stored.id] = stored
        return stored
    }

    @Synchronized
    override fun updateAddress(address: CustomerAddress): CustomerAddress? {
        val current = addresses[address.id]?.takeIf { it.customerId == address.customerId } ?: return null
        if (address.isDefault) clearDefaults(address.customerId)
        val stored = address.copy(
            createdAt = current.createdAt,
            isDefault = address.isDefault || current.isDefault,
        )
        addresses[address.id] = stored
        return stored
    }

    @Synchronized
    override fun deleteAddress(customerId: UUID, addressId: UUID, now: Instant): Boolean {
        val current = addresses[addressId]?.takeIf { it.customerId == customerId } ?: return false
        addresses.remove(addressId)
        if (current.isDefault) {
            addresses.values
                .filter { it.customerId == customerId }
                .minByOrNull(CustomerAddress::createdAt)
                ?.let { replacement -> addresses[replacement.id] = replacement.copy(isDefault = true, updatedAt = now) }
        }
        return true
    }

    @Synchronized
    override fun eraseCustomerOwnedData(customerId: UUID) {
        pets.entries.removeIf { it.value.customerId == customerId }
        addresses.entries.removeIf { it.value.customerId == customerId }
    }

    private fun clearDefaults(customerId: UUID) {
        addresses.replaceAll { _, current ->
            if (current.customerId == customerId && current.isDefault) current.copy(isDefault = false) else current
        }
    }
}

class CustomerDataService(
    private val persistence: CustomerDataPersistence,
    private val clock: Clock = Clock.systemUTC(),
) {
    fun listPets(customerId: UUID, page: Int, pageSize: Int): CustomerPetPage {
        validatePagination(page, pageSize)
        return persistence.listPets(customerId, page, pageSize)
    }

    fun getPet(customerId: UUID, petId: UUID): CustomerPet = persistence.getPet(customerId, petId) ?: unavailable()

    fun createPet(
        customerId: UUID,
        name: String,
        species: PetSpecies,
        breed: String?,
        dateOfBirth: LocalDate?,
    ): CustomerPet {
        val values = validatePet(name, breed, dateOfBirth)
        val now = clock.instant()
        return persistence.createPet(
            CustomerPet(
                id = UUID.randomUUID(),
                customerId = customerId,
                name = values.first,
                species = species,
                breed = values.second,
                dateOfBirth = dateOfBirth,
                createdAt = now,
                updatedAt = now,
            ),
        )
    }

    fun updatePet(
        customerId: UUID,
        petId: UUID,
        name: String,
        species: PetSpecies,
        breed: String?,
        dateOfBirth: LocalDate?,
    ): CustomerPet {
        val current = getPet(customerId, petId)
        val values = validatePet(name, breed, dateOfBirth)
        return persistence.updatePet(
            current.copy(
                name = values.first,
                species = species,
                breed = values.second,
                dateOfBirth = dateOfBirth,
                updatedAt = clock.instant(),
            ),
        ) ?: unavailable()
    }

    fun deletePet(customerId: UUID, petId: UUID) {
        if (!persistence.deletePet(customerId, petId)) unavailable()
    }

    fun listAddresses(customerId: UUID): List<CustomerAddress> = persistence.listAddresses(customerId)

    fun getAddress(customerId: UUID, addressId: UUID): CustomerAddress =
        persistence.getAddress(customerId, addressId) ?: unavailable()

    fun createAddress(customerId: UUID, input: CustomerAddressInput): CustomerAddress {
        val validated = validateAddress(input)
        val now = clock.instant()
        return persistence.createAddress(
            CustomerAddress(
                id = UUID.randomUUID(),
                customerId = customerId,
                label = validated.label,
                recipientName = validated.recipientName,
                phoneNumber = validated.phoneNumber,
                line1 = validated.line1,
                line2 = validated.line2,
                city = validated.city,
                state = validated.state,
                pincode = validated.pincode,
                isDefault = validated.isDefault,
                createdAt = now,
                updatedAt = now,
            ),
        )
    }

    fun updateAddress(customerId: UUID, addressId: UUID, input: CustomerAddressInput): CustomerAddress {
        val current = getAddress(customerId, addressId)
        val validated = validateAddress(input)
        return persistence.updateAddress(
            current.copy(
                label = validated.label,
                recipientName = validated.recipientName,
                phoneNumber = validated.phoneNumber,
                line1 = validated.line1,
                line2 = validated.line2,
                city = validated.city,
                state = validated.state,
                pincode = validated.pincode,
                isDefault = validated.isDefault,
                updatedAt = clock.instant(),
            ),
        ) ?: unavailable()
    }

    fun deleteAddress(customerId: UUID, addressId: UUID) {
        if (!persistence.deleteAddress(customerId, addressId, clock.instant())) unavailable()
    }

    fun eraseCustomerOwnedData(customerId: UUID) = persistence.eraseCustomerOwnedData(customerId)

    private fun validatePet(name: String, breed: String?, dateOfBirth: LocalDate?): Pair<String, String?> {
        val cleanedName = name.trim()
        val cleanedBreed = breed?.trim()?.takeUnless(String::isEmpty)
        if (cleanedName.length !in 1..80 || (cleanedBreed != null && cleanedBreed.length > 120)) invalidPet()
        if (dateOfBirth != null && dateOfBirth.isAfter(LocalDate.now(clock))) invalidPet()
        return cleanedName to cleanedBreed
    }

    private fun validateAddress(input: CustomerAddressInput): CustomerAddressInput {
        val cleaned = input.copy(
            label = input.label.trim(),
            recipientName = input.recipientName.trim(),
            phoneNumber = normalizePhone(input.phoneNumber),
            line1 = input.line1.trim(),
            line2 = input.line2?.trim()?.takeUnless(String::isEmpty),
            city = input.city.trim(),
            state = input.state.trim(),
            pincode = input.pincode.trim(),
        )
        if (
            cleaned.label.length !in 1..40 ||
            cleaned.recipientName.length !in 1..120 ||
            cleaned.line1.length !in 3..240 ||
            (cleaned.line2 != null && cleaned.line2.length > 240) ||
            cleaned.city.length !in 2..120 ||
            cleaned.state.length !in 2..120 ||
            !cleaned.pincode.matches(Regex("[1-9][0-9]{5}"))
        ) invalidAddress()
        return cleaned
    }

    private fun normalizePhone(value: String): String {
        val digits = value.filter(Char::isDigit)
        val normalized = when {
            digits.length == 10 && digits.firstOrNull() in '6'..'9' -> "+91$digits"
            digits.length == 12 && digits.startsWith("91") && digits[2] in '6'..'9' -> "+$digits"
            else -> invalidAddress()
        }
        return normalized
    }

    private fun validatePagination(page: Int, pageSize: Int) {
        if (page < 0 || pageSize !in 1..100) {
            throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        }
    }

    private fun invalidPet(): Nothing = throw DomainException("PET_INVALID", "The pet details are invalid")
    private fun invalidAddress(): Nothing = throw DomainException("ADDRESS_INVALID", "The address details are invalid")
    private fun unavailable(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
}
