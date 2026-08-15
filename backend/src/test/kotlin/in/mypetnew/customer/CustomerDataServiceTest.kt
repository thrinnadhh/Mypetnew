package `in`.mypetnew.customer

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.customer.domain.CustomerAddressInput
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.customer.domain.InMemoryCustomerDataPersistence
import `in`.mypetnew.customer.domain.PetSpecies
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

class CustomerDataServiceTest {
    private val clock = Clock.fixed(Instant.parse("2026-08-15T00:00:00Z"), ZoneOffset.UTC)
    private val service = CustomerDataService(InMemoryCustomerDataPersistence(), clock)
    private val customerId = UUID.randomUUID()

    @Test
    fun `pet validation rejects future birth dates and invalid pagination`() {
        val future = assertThrows(DomainException::class.java) {
            service.createPet(customerId, "Bruno", PetSpecies.DOG, null, LocalDate.parse("2026-08-16"))
        }
        assertEquals("PET_INVALID", future.code)

        val page = assertThrows(DomainException::class.java) {
            service.listPets(customerId, page = -1, pageSize = 20)
        }
        assertEquals("PAGE_SIZE_INVALID", page.code)
    }

    @Test
    fun `address validation normalizes Indian mobile and rejects invalid phone or pin`() {
        val created = service.createAddress(
            customerId,
            address(phone = "98123 45678", pincode = "517501"),
        )
        assertEquals("+919812345678", created.phoneNumber)

        val badPhone = assertThrows(DomainException::class.java) {
            service.createAddress(customerId, address(phone = "12345", pincode = "517501"))
        }
        assertEquals("ADDRESS_INVALID", badPhone.code)

        val badPin = assertThrows(DomainException::class.java) {
            service.createAddress(customerId, address(phone = "9812345678", pincode = "012345"))
        }
        assertEquals("ADDRESS_INVALID", badPin.code)
    }

    private fun address(phone: String, pincode: String) = CustomerAddressInput(
        label = "Home",
        recipientName = "Customer",
        phoneNumber = phone,
        line1 = "Main Road",
        line2 = null,
        city = "Tirupati",
        state = "Andhra Pradesh",
        pincode = pincode,
        isDefault = true,
    )
}
