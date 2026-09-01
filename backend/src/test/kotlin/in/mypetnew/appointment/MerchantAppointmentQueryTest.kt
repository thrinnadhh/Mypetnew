package `in`.mypetnew.appointment

import `in`.mypetnew.appointment.domain.AppointmentPaymentMethod
import `in`.mypetnew.appointment.domain.AppointmentPaymentStatus
import `in`.mypetnew.appointment.domain.AppointmentStatus
import `in`.mypetnew.appointment.infrastructure.MerchantAppointmentQuery
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DriverManagerDataSource
import java.time.Instant
import java.util.UUID

class MerchantAppointmentQueryTest {
    private lateinit var jdbc: JdbcClient
    private lateinit var query: MerchantAppointmentQuery
    private lateinit var ownedOrganization: UUID
    private lateinit var foreignOrganization: UUID
    private lateinit var ownedOutlet: UUID
    private lateinit var foreignOutlet: UUID

    @BeforeEach
    fun setUp() {
        val database = "merchant-appointment-${UUID.randomUUID()}"
        val dataSource = DriverManagerDataSource("jdbc:h2:mem:$database;MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "")
        jdbc = JdbcClient.create(dataSource)
        jdbc.sql("CREATE SCHEMA mypet").update()
        jdbc.sql(
            """
            CREATE TABLE mypet.merchant_organization (
                id UUID PRIMARY KEY,
                status VARCHAR(32) NOT NULL
            )
            """.trimIndent(),
        ).update()
        jdbc.sql(
            """
            CREATE TABLE mypet.provider_outlet (
                id UUID PRIMARY KEY,
                organization_id UUID NOT NULL,
                status VARCHAR(32) NOT NULL
            )
            """.trimIndent(),
        ).update()
        jdbc.sql(
            """
            CREATE TABLE mypet.appointment (
                id UUID PRIMARY KEY,
                organization_id UUID NOT NULL,
                outlet_id UUID NOT NULL,
                service_id UUID NOT NULL,
                slot_id UUID NOT NULL,
                pet_name VARCHAR(80) NOT NULL,
                service_name VARCHAR(160) NOT NULL,
                starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
                ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
                status VARCHAR(32) NOT NULL,
                payment_method VARCHAR(32) NOT NULL,
                payment_status VARCHAR(32) NOT NULL,
                payment_mode VARCHAR(32) NOT NULL,
                payment_state VARCHAR(32) NOT NULL,
                price_paise BIGINT NOT NULL,
                notes VARCHAR(1000),
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
            """.trimIndent(),
        ).update()
        query = MerchantAppointmentQuery(jdbc)
        ownedOrganization = UUID.randomUUID()
        foreignOrganization = UUID.randomUUID()
        ownedOutlet = UUID.randomUUID()
        foreignOutlet = UUID.randomUUID()
        jdbc.sql("INSERT INTO mypet.merchant_organization(id, status) VALUES (:id, 'ACTIVE')")
            .param("id", ownedOrganization).update()
        jdbc.sql("INSERT INTO mypet.merchant_organization(id, status) VALUES (:id, 'ACTIVE')")
            .param("id", foreignOrganization).update()
        jdbc.sql(
            "INSERT INTO mypet.provider_outlet(id, organization_id, status) VALUES (:id, :organizationId, 'ACTIVE')",
        ).param("id", ownedOutlet).param("organizationId", ownedOrganization).update()
        jdbc.sql(
            "INSERT INTO mypet.provider_outlet(id, organization_id, status) VALUES (:id, :organizationId, 'ACTIVE')",
        ).param("id", foreignOutlet).param("organizationId", foreignOrganization).update()
    }

    @Test
    fun `pending inbox is outlet scoped status filtered and payment aware`() {
        val ownedPending = insert(
            ownedOutlet,
            AppointmentStatus.BOOKED,
            "Milo",
            "Full Spa",
            129_900,
            AppointmentPaymentMethod.ONLINE_PAYMENT,
            AppointmentPaymentStatus.PAID,
        )
        insert(ownedOutlet, AppointmentStatus.CONFIRMED, "Luna", "Vet consult", 50_000)
        insert(foreignOutlet, AppointmentStatus.BOOKED, "Rocky", "Foreign Spa", 99_000)

        val merchant = Principal(
            actorId = UUID.randomUUID(),
            role = Role.MERCHANT,
            organizationId = ownedOrganization,
            outletIds = setOf(ownedOutlet),
        )
        val page = query.list(merchant, AppointmentStatus.BOOKED, 0, 20)

        assertEquals(listOf(ownedPending), page.items.map { it.appointmentId })
        assertEquals("Milo", page.items.single().petName)
        assertEquals("Full Spa", page.items.single().serviceName)
        assertEquals(129_900, page.items.single().pricePaise)
        assertEquals(AppointmentPaymentMethod.ONLINE_PAYMENT, page.items.single().paymentMethod)
        assertEquals(AppointmentPaymentStatus.PAID, page.items.single().paymentStatus)
        assertEquals(false, page.hasNext)
    }

    @Test
    fun `inbox honors explicit authorized outlet selection`() {
        val secondOwnedOutlet = UUID.randomUUID()
        jdbc.sql(
            "INSERT INTO mypet.provider_outlet(id, organization_id, status) VALUES (:id, :organizationId, 'ACTIVE')",
        ).param("id", secondOwnedOutlet).param("organizationId", ownedOrganization).update()
        val first = insert(ownedOutlet, AppointmentStatus.BOOKED, "First", "Grooming", 10_000)
        val second = insert(
            secondOwnedOutlet,
            AppointmentStatus.BOOKED,
            "Second",
            "Vet",
            20_000,
            organizationId = ownedOrganization,
        )
        val merchant = Principal(
            UUID.randomUUID(),
            Role.MERCHANT,
            organizationId = ownedOrganization,
            outletIds = setOf(ownedOutlet, secondOwnedOutlet),
        )

        assertEquals(listOf(first), query.list(merchant, null, 0, 20, ownedOutlet).items.map { it.appointmentId })
        assertEquals(listOf(second), query.list(merchant, null, 0, 20, secondOwnedOutlet).items.map { it.appointmentId })
    }

    @Test
    fun `inbox hides transient holds and orders active work by scheduled time`() {
        val base = Instant.parse("2026-09-01T08:00:00Z")
        val later = insert(ownedOutlet, AppointmentStatus.BOOKED, "Later", "Later service", 10_000, startsAt = base.plusSeconds(7_200))
        val terminal = insert(ownedOutlet, AppointmentStatus.COMPLETED, "Done", "Completed service", 10_000, startsAt = base.minusSeconds(3_600))
        val sooner = insert(ownedOutlet, AppointmentStatus.CONFIRMED, "Sooner", "Sooner service", 10_000, startsAt = base.plusSeconds(3_600))
        insert(ownedOutlet, AppointmentStatus.HOLD, "Holding", "Pending payment", 10_000, startsAt = base.plusSeconds(1_800))
        insert(ownedOutlet, AppointmentStatus.HOLD_EXPIRED, "Expired", "Expired hold", 10_000, startsAt = base.minusSeconds(1_800))
        val merchant = Principal(
            UUID.randomUUID(),
            Role.MERCHANT,
            organizationId = ownedOrganization,
            outletIds = setOf(ownedOutlet),
        )

        assertEquals(
            listOf(sooner, later, terminal),
            query.list(merchant, null, 0, 20, ownedOutlet).items.map { it.appointmentId },
        )
    }

    @Test
    fun `inbox supports merchant pagination without leaking foreign outlets`() {
        repeat(3) { index -> insert(ownedOutlet, AppointmentStatus.BOOKED, "Pet $index", "Service $index", 10_000L + index) }
        repeat(2) { index -> insert(foreignOutlet, AppointmentStatus.BOOKED, "Foreign $index", "Foreign", 20_000) }
        val merchant = Principal(
            UUID.randomUUID(),
            Role.MERCHANT,
            organizationId = ownedOrganization,
            outletIds = setOf(ownedOutlet),
        )

        val first = query.list(merchant, AppointmentStatus.BOOKED, 0, 2)
        val second = query.list(merchant, AppointmentStatus.BOOKED, 1, 2)

        assertEquals(2, first.items.size)
        assertEquals(true, first.hasNext)
        assertEquals(1, second.items.size)
        assertEquals(false, second.hasNext)
        assertEquals(setOf(ownedOutlet), (first.items + second.items).map { it.outletId }.toSet())
    }

    @Test
    fun `inbox rejects invalid role and pagination`() {
        val merchant = Principal(
            UUID.randomUUID(),
            Role.MERCHANT,
            organizationId = ownedOrganization,
            outletIds = setOf(ownedOutlet),
        )
        val customer = Principal(UUID.randomUUID(), Role.CUSTOMER)

        assertEquals("PAGE_SIZE_INVALID", assertThrows(DomainException::class.java) {
            query.list(merchant, AppointmentStatus.BOOKED, -1, 20)
        }.code)
        assertEquals("PAGE_SIZE_INVALID", assertThrows(DomainException::class.java) {
            query.list(merchant, AppointmentStatus.BOOKED, 100_001, 1)
        }.code)
        assertThrows(DomainException::class.java) {
            query.list(customer, AppointmentStatus.BOOKED, 0, 20)
        }
    }

    @Test
    fun `list and detail require both canonical organization and outlet scope`() {
        val owned = insert(ownedOutlet, AppointmentStatus.BOOKED, "Milo", "Owned", 10_000)
        val corruptCrossTenant = insert(
            ownedOutlet,
            AppointmentStatus.BOOKED,
            "Foreign",
            "Foreign tenant",
            20_000,
            organizationId = foreignOrganization,
        )
        val foreign = insert(foreignOutlet, AppointmentStatus.BOOKED, "Foreign", "Foreign outlet", 30_000)
        val merchant = Principal(
            UUID.randomUUID(),
            Role.MERCHANT,
            organizationId = ownedOrganization,
            outletIds = setOf(ownedOutlet),
        )

        assertEquals(listOf(owned), query.list(merchant, AppointmentStatus.BOOKED, 0, 20).items.map { it.appointmentId })
        assertEquals(owned, query.get(merchant, owned)?.appointmentId)
        assertEquals(null, query.get(merchant, corruptCrossTenant))
        assertEquals(null, query.get(merchant, foreign))
    }

    @Test
    fun `list and detail fail closed when canonical outlet or organization is suspended`() {
        val appointment = insert(ownedOutlet, AppointmentStatus.BOOKED, "Milo", "Owned", 10_000)
        val merchant = Principal(
            UUID.randomUUID(),
            Role.MERCHANT,
            organizationId = ownedOrganization,
            outletIds = setOf(ownedOutlet),
        )

        jdbc.sql("UPDATE mypet.provider_outlet SET status = 'SUSPENDED' WHERE id = :id")
            .param("id", ownedOutlet).update()
        assertEquals(emptyList<UUID>(), query.list(merchant, AppointmentStatus.BOOKED, 0, 20).items.map { it.appointmentId })
        assertEquals(null, query.get(merchant, appointment))

        jdbc.sql("UPDATE mypet.provider_outlet SET status = 'ACTIVE' WHERE id = :id")
            .param("id", ownedOutlet).update()
        jdbc.sql("UPDATE mypet.merchant_organization SET status = 'SUSPENDED' WHERE id = :id")
            .param("id", ownedOrganization).update()
        assertEquals(emptyList<UUID>(), query.list(merchant, AppointmentStatus.BOOKED, 0, 20).items.map { it.appointmentId })
        assertEquals(null, query.get(merchant, appointment))
    }

    private fun insert(
        outletId: UUID,
        status: AppointmentStatus,
        petName: String,
        serviceName: String,
        pricePaise: Long,
        paymentMethod: AppointmentPaymentMethod = AppointmentPaymentMethod.PAY_AT_PROVIDER,
        paymentStatus: AppointmentPaymentStatus = AppointmentPaymentStatus.NOT_REQUIRED,
        organizationId: UUID = if (outletId == ownedOutlet) ownedOrganization else foreignOrganization,
        startsAt: Instant? = null,
    ): UUID {
        val id = UUID.randomUUID()
        val createdAt = Instant.parse("2026-08-16T06:00:00Z").plusMillis((Math.random() * 1_000).toLong())
        val scheduledStart = startsAt ?: createdAt.plusSeconds(3_600)
        jdbc.sql(
            """
            INSERT INTO mypet.appointment(
                id, organization_id, outlet_id, service_id, slot_id, pet_name, service_name,
                starts_at, ends_at, status, payment_method, payment_status,
                payment_mode, payment_state, price_paise, notes, created_at, updated_at
            ) VALUES (
                :id, :organization_id, :outlet_id, :service_id, :slot_id, :pet_name, :service_name,
                :starts_at, :ends_at, :status, 'PAY_AT_PROVIDER', 'NOT_REQUIRED',
                :payment_mode, :payment_state, :price_paise, :notes, :created_at, :created_at
            )
            """.trimIndent(),
        ).param("id", id)
            .param("organization_id", organizationId)
            .param("outlet_id", outletId)
            .param("service_id", UUID.randomUUID())
            .param("slot_id", UUID.randomUUID())
            .param("pet_name", petName)
            .param("service_name", serviceName)
            .param("starts_at", scheduledStart)
            .param("ends_at", scheduledStart.plusSeconds(1_800))
            .param("status", status.name)
            .param("payment_mode", paymentMethod.name)
            .param("payment_state", paymentStatus.name)
            .param("price_paise", pricePaise)
            .param("notes", "Handle gently")
            .param("created_at", createdAt)
            .update()
        return id
    }
}
