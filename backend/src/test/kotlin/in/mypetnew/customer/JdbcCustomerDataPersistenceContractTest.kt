package `in`.mypetnew.customer

import `in`.mypetnew.customer.domain.CustomerAddress
import `in`.mypetnew.customer.domain.CustomerPet
import `in`.mypetnew.customer.domain.PetSpecies
import `in`.mypetnew.customer.infrastructure.JdbcCustomerDataPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

class JdbcCustomerDataPersistenceContractTest {
    @Test
    fun `jdbc persistence scopes pets and keeps exactly one application default address`() {
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:customerdata-${UUID.randomUUID()};MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
            "sa",
            "",
        )
        val jdbcTemplate = JdbcTemplate(dataSource)
        jdbcTemplate.execute("CREATE SCHEMA mypet")
        jdbcTemplate.execute("CREATE TABLE mypet.identity_account(id UUID PRIMARY KEY, role VARCHAR(24), status VARCHAR(24))")
        jdbcTemplate.execute(
            """
            CREATE TABLE mypet.customer_pet(
                id UUID PRIMARY KEY, customer_id UUID NOT NULL, name VARCHAR(80) NOT NULL,
                species VARCHAR(16) NOT NULL, breed VARCHAR(120), date_of_birth DATE,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL, updated_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
            """.trimIndent(),
        )
        jdbcTemplate.execute(
            """
            CREATE TABLE mypet.customer_address(
                id UUID PRIMARY KEY, customer_id UUID NOT NULL, label VARCHAR(40) NOT NULL,
                recipient_name VARCHAR(120) NOT NULL, phone_e164 VARCHAR(16) NOT NULL,
                line1 VARCHAR(240) NOT NULL, line2 VARCHAR(240), city VARCHAR(120) NOT NULL,
                state VARCHAR(120) NOT NULL, pincode VARCHAR(6) NOT NULL, is_default BOOLEAN NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL, updated_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
            """.trimIndent(),
        )

        val customerA = UUID.randomUUID()
        val customerB = UUID.randomUUID()
        jdbcTemplate.update("INSERT INTO mypet.identity_account(id, role, status) VALUES (?, 'CUSTOMER', 'ACTIVE')", customerA)
        jdbcTemplate.update("INSERT INTO mypet.identity_account(id, role, status) VALUES (?, 'CUSTOMER', 'ACTIVE')", customerB)

        val persistence = JdbcCustomerDataPersistence(
            JdbcClient.create(dataSource),
            TransactionTemplate(DataSourceTransactionManager(dataSource)),
        )
        val now = Instant.parse("2026-08-15T05:00:00Z")
        val petId = UUID.randomUUID()
        persistence.createPet(
            CustomerPet(petId, customerA, "Bruno", PetSpecies.DOG, "Indie", LocalDate.parse("2024-01-10"), now, now),
        )
        assertEquals(petId, persistence.listPets(customerA, 0, 20).items.single().id)
        assertNull(persistence.getPet(customerB, petId))

        val firstId = UUID.randomUUID()
        val first = persistence.createAddress(address(firstId, customerA, "Home", false, now))
        assertTrue(first.isDefault)
        val secondId = UUID.randomUUID()
        val second = persistence.createAddress(address(secondId, customerA, "Work", false, now.plusSeconds(1)))
        assertFalse(second.isDefault)

        val promoted = persistence.updateAddress(second.copy(isDefault = true, updatedAt = now.plusSeconds(2)))!!
        assertTrue(promoted.isDefault)
        val afterPromote = persistence.listAddresses(customerA)
        assertEquals(secondId, afterPromote.first().id)
        assertFalse(afterPromote.first { it.id == firstId }.isDefault)
        assertTrue(persistence.listAddresses(customerB).isEmpty())

        assertTrue(persistence.deleteAddress(customerA, secondId, now.plusSeconds(3)))
        assertTrue(persistence.listAddresses(customerA).single().isDefault)

        persistence.eraseCustomerOwnedData(customerA)
        assertTrue(persistence.listPets(customerA, 0, 20).items.isEmpty())
        assertTrue(persistence.listAddresses(customerA).isEmpty())
    }

    private fun address(
        id: UUID,
        customerId: UUID,
        label: String,
        isDefault: Boolean,
        at: Instant,
    ) = CustomerAddress(
        id = id,
        customerId = customerId,
        label = label,
        recipientName = "Customer",
        phoneNumber = "+919812345678",
        line1 = "Main Road",
        line2 = null,
        city = "Tirupati",
        state = "Andhra Pradesh",
        pincode = "517501",
        isDefault = isDefault,
        createdAt = at,
        updatedAt = at,
    )
}
