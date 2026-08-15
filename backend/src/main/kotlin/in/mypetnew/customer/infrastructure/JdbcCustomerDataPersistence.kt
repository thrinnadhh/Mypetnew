package `in`.mypetnew.customer.infrastructure

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.customer.domain.CustomerAddress
import `in`.mypetnew.customer.domain.CustomerDataPersistence
import `in`.mypetnew.customer.domain.CustomerPet
import `in`.mypetnew.customer.domain.CustomerPetPage
import `in`.mypetnew.customer.domain.PetSpecies
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.transaction.support.TransactionTemplate
import java.sql.ResultSet
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

class JdbcCustomerDataPersistence(
    private val jdbc: JdbcClient,
    private val transaction: TransactionTemplate,
) : CustomerDataPersistence {
    override fun listPets(customerId: UUID, page: Int, pageSize: Int): CustomerPetPage {
        val rows = jdbc.sql(
            """
            SELECT id, customer_id, name, species, breed, date_of_birth, created_at, updated_at
            FROM mypet.customer_pet
            WHERE customer_id = :customer_id
            ORDER BY created_at DESC, id DESC
            LIMIT :limit OFFSET :offset
            """.trimIndent(),
        ).param("customer_id", customerId)
            .param("limit", pageSize + 1)
            .param("offset", page.toLong() * pageSize.toLong())
            .query(::mapPet)
            .list()
        return CustomerPetPage(rows.take(pageSize), rows.size > pageSize)
    }

    override fun getPet(customerId: UUID, petId: UUID): CustomerPet? = jdbc.sql(
        """
        SELECT id, customer_id, name, species, breed, date_of_birth, created_at, updated_at
        FROM mypet.customer_pet WHERE id = :id AND customer_id = :customer_id
        """.trimIndent(),
    ).param("id", petId).param("customer_id", customerId).query(::mapPet).optional().orElse(null)

    override fun createPet(pet: CustomerPet): CustomerPet {
        jdbc.sql(
            """
            INSERT INTO mypet.customer_pet(
                id, customer_id, name, species, breed, date_of_birth, created_at, updated_at
            ) VALUES (
                :id, :customer_id, :name, :species, :breed, :date_of_birth, :created_at, :updated_at
            )
            """.trimIndent(),
        ).param("id", pet.id)
            .param("customer_id", pet.customerId)
            .param("name", pet.name)
            .param("species", pet.species.name)
            .param("breed", pet.breed)
            .param("date_of_birth", pet.dateOfBirth)
            .param("created_at", pet.createdAt)
            .param("updated_at", pet.updatedAt)
            .update()
        return pet
    }

    override fun updatePet(pet: CustomerPet): CustomerPet? {
        val updated = jdbc.sql(
            """
            UPDATE mypet.customer_pet
            SET name = :name, species = :species, breed = :breed,
                date_of_birth = :date_of_birth, updated_at = :updated_at
            WHERE id = :id AND customer_id = :customer_id
            """.trimIndent(),
        ).param("name", pet.name)
            .param("species", pet.species.name)
            .param("breed", pet.breed)
            .param("date_of_birth", pet.dateOfBirth)
            .param("updated_at", pet.updatedAt)
            .param("id", pet.id)
            .param("customer_id", pet.customerId)
            .update()
        return if (updated == 1) getPet(pet.customerId, pet.id) else null
    }

    override fun deletePet(customerId: UUID, petId: UUID): Boolean = jdbc.sql(
        "DELETE FROM mypet.customer_pet WHERE id = :id AND customer_id = :customer_id",
    ).param("id", petId).param("customer_id", customerId).update() == 1

    override fun listAddresses(customerId: UUID): List<CustomerAddress> = jdbc.sql(
        """
        SELECT id, customer_id, label, recipient_name, phone_e164, line1, line2,
               city, state, pincode, is_default, created_at, updated_at
        FROM mypet.customer_address
        WHERE customer_id = :customer_id
        ORDER BY is_default DESC, updated_at DESC, id DESC
        """.trimIndent(),
    ).param("customer_id", customerId).query(::mapAddress).list()

    override fun getAddress(customerId: UUID, addressId: UUID): CustomerAddress? = jdbc.sql(
        """
        SELECT id, customer_id, label, recipient_name, phone_e164, line1, line2,
               city, state, pincode, is_default, created_at, updated_at
        FROM mypet.customer_address
        WHERE id = :id AND customer_id = :customer_id
        """.trimIndent(),
    ).param("id", addressId).param("customer_id", customerId).query(::mapAddress).optional().orElse(null)

    override fun createAddress(address: CustomerAddress): CustomerAddress = transaction.execute {
        lockCustomer(address.customerId)
        val existingCount = jdbc.sql(
            "SELECT COUNT(*) FROM mypet.customer_address WHERE customer_id = :customer_id",
        ).param("customer_id", address.customerId).query(Int::class.java).single()
        val shouldDefault = address.isDefault || existingCount == 0
        if (shouldDefault) clearDefaults(address.customerId, address.updatedAt)
        jdbc.sql(
            """
            INSERT INTO mypet.customer_address(
                id, customer_id, label, recipient_name, phone_e164, line1, line2,
                city, state, pincode, is_default, created_at, updated_at
            ) VALUES (
                :id, :customer_id, :label, :recipient_name, :phone_e164, :line1, :line2,
                :city, :state, :pincode, :is_default, :created_at, :updated_at
            )
            """.trimIndent(),
        ).param("id", address.id)
            .param("customer_id", address.customerId)
            .param("label", address.label)
            .param("recipient_name", address.recipientName)
            .param("phone_e164", address.phoneNumber)
            .param("line1", address.line1)
            .param("line2", address.line2)
            .param("city", address.city)
            .param("state", address.state)
            .param("pincode", address.pincode)
            .param("is_default", shouldDefault)
            .param("created_at", address.createdAt)
            .param("updated_at", address.updatedAt)
            .update()
        getAddress(address.customerId, address.id)!!
    }

    override fun updateAddress(address: CustomerAddress): CustomerAddress? = transaction.execute {
        lockCustomer(address.customerId)
        val current = lockAddress(address.customerId, address.id) ?: return@execute null
        val effectiveDefault = address.isDefault || current.isDefault
        if (address.isDefault) clearDefaults(address.customerId, address.updatedAt)
        val updated = jdbc.sql(
            """
            UPDATE mypet.customer_address
            SET label = :label, recipient_name = :recipient_name, phone_e164 = :phone_e164,
                line1 = :line1, line2 = :line2, city = :city, state = :state,
                pincode = :pincode, is_default = :is_default, updated_at = :updated_at
            WHERE id = :id AND customer_id = :customer_id
            """.trimIndent(),
        ).param("label", address.label)
            .param("recipient_name", address.recipientName)
            .param("phone_e164", address.phoneNumber)
            .param("line1", address.line1)
            .param("line2", address.line2)
            .param("city", address.city)
            .param("state", address.state)
            .param("pincode", address.pincode)
            .param("is_default", effectiveDefault)
            .param("updated_at", address.updatedAt)
            .param("id", address.id)
            .param("customer_id", address.customerId)
            .update()
        if (updated == 1) getAddress(address.customerId, address.id) else null
    }

    override fun deleteAddress(customerId: UUID, addressId: UUID, now: Instant): Boolean = transaction.execute {
        lockCustomer(customerId)
        val current = lockAddress(customerId, addressId) ?: return@execute false
        jdbc.sql("DELETE FROM mypet.customer_address WHERE id = :id AND customer_id = :customer_id")
            .param("id", addressId)
            .param("customer_id", customerId)
            .update()
        if (current.isDefault) {
            val replacement = jdbc.sql(
                """
                SELECT id FROM mypet.customer_address
                WHERE customer_id = :customer_id
                ORDER BY created_at ASC, id ASC LIMIT 1
                """.trimIndent(),
            ).param("customer_id", customerId).query(UUID::class.java).optional().orElse(null)
            if (replacement != null) {
                jdbc.sql(
                    "UPDATE mypet.customer_address SET is_default = TRUE, updated_at = :now WHERE id = :id",
                ).param("now", now).param("id", replacement).update()
            }
        }
        true
    }

    override fun eraseCustomerOwnedData(customerId: UUID) = transaction.executeWithoutResult {
        jdbc.sql("DELETE FROM mypet.customer_pet WHERE customer_id = :customer_id")
            .param("customer_id", customerId).update()
        jdbc.sql("DELETE FROM mypet.customer_address WHERE customer_id = :customer_id")
            .param("customer_id", customerId).update()
    }

    private fun lockCustomer(customerId: UUID) {
        val exists = jdbc.sql(
            """
            SELECT id FROM mypet.identity_account
            WHERE id = :customer_id AND role = 'CUSTOMER' AND status = 'ACTIVE'
            FOR UPDATE
            """.trimIndent(),
        ).param("customer_id", customerId).query(UUID::class.java).optional().isPresent
        if (!exists) throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
    }

    private fun lockAddress(customerId: UUID, addressId: UUID): CustomerAddress? = jdbc.sql(
        """
        SELECT id, customer_id, label, recipient_name, phone_e164, line1, line2,
               city, state, pincode, is_default, created_at, updated_at
        FROM mypet.customer_address
        WHERE id = :id AND customer_id = :customer_id
        FOR UPDATE
        """.trimIndent(),
    ).param("id", addressId).param("customer_id", customerId).query(::mapAddress).optional().orElse(null)

    private fun clearDefaults(customerId: UUID, now: Instant) {
        jdbc.sql(
            """
            UPDATE mypet.customer_address SET is_default = FALSE, updated_at = :now
            WHERE customer_id = :customer_id AND is_default = TRUE
            """.trimIndent(),
        ).param("now", now).param("customer_id", customerId).update()
    }

    private fun mapPet(rows: ResultSet, rowNumber: Int): CustomerPet {
        require(rowNumber >= 0)
        return CustomerPet(
            id = rows.getObject("id", UUID::class.java),
            customerId = rows.getObject("customer_id", UUID::class.java),
            name = rows.getString("name"),
            species = PetSpecies.valueOf(rows.getString("species")),
            breed = rows.getString("breed"),
            dateOfBirth = rows.getObject("date_of_birth", LocalDate::class.java),
            createdAt = rows.getTimestamp("created_at").toInstant(),
            updatedAt = rows.getTimestamp("updated_at").toInstant(),
        )
    }

    private fun mapAddress(rows: ResultSet, rowNumber: Int): CustomerAddress {
        require(rowNumber >= 0)
        return CustomerAddress(
            id = rows.getObject("id", UUID::class.java),
            customerId = rows.getObject("customer_id", UUID::class.java),
            label = rows.getString("label"),
            recipientName = rows.getString("recipient_name"),
            phoneNumber = rows.getString("phone_e164"),
            line1 = rows.getString("line1"),
            line2 = rows.getString("line2"),
            city = rows.getString("city"),
            state = rows.getString("state"),
            pincode = rows.getString("pincode"),
            isDefault = rows.getBoolean("is_default"),
            createdAt = rows.getTimestamp("created_at").toInstant(),
            updatedAt = rows.getTimestamp("updated_at").toInstant(),
        )
    }
}
