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
            CREATE TABLE mypet.appointment (
                id UUID PRIMARY KEY,
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
        ownedOutlet = UUID.randomUUID()
        foreignOutlet = UUID.randomUUID()
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
            organizationId = UUID.randomUUID(),
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
    fun `inbox supports merchant pagination without leaking foreign outlets`() {
        repeat(3) { index -> insert(ownedOutlet, AppointmentStatus.BOOKED, "Pet $index", "Service $index", 10_000L + index) }
        repeat(2) { index -> insert(foreignOutlet, AppointmentStatus.BOOKED, "Foreign $index", "Foreign", 20_000) }
        val merchant = Principal(UUID.randomUUID(), Role.MERCHANT, outletIds = setOf(ownedOutlet))

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
        val merchant = Principal(UUID.randomUUID(), Role.MERCHANT, outletIds = setOf(ownedOutlet))
        val customer = Principal(UUID.randomUUID(), Role.CUSTOMER)

        assertEquals("PAGE_SIZE_INVALID", assertThrows(DomainException::class.java) {
            query.list(merchant, AppointmentStatus.BOOKED, -1, 20)
        }.code)
        assertThrows(DomainException::class.java) {
            query.list(customer, AppointmentStatus.BOOKED, 0, 20)
        }
    }

    private fun insert(
        outletId: UUID,
        status: AppointmentStatus,
        petName: String,
        serviceName: String,
        pricePaise: Long,
        paymentMethod: AppointmentPaymentMethod = AppointmentPaymentMethod.PAY_AT_PROVIDER,
        paymentStatus: AppointmentPaymentStatus = AppointmentPaymentStatus.NOT_REQUIRED,
    ): UUID {
        val id = UUID.randomUUID()
        val createdAt = Instant.parse("2026-08-16T06:00:00Z").plusMillis((Math.random() * 1_000).toLong())
        jdbc.sql(
            """
            INSERT INTO mypet.appointment(
                id, outlet_id, service_id, slot_id, pet_name, service_name,
                starts_at, ends_at, status, payment_method, payment_status,
                payment_mode, payment_state, price_paise, notes, created_at, updated_at
            ) VALUES (
                :id, :outlet_id, :service_id, :slot_id, :pet_name, :service_name,
                :starts_at, :ends_at, :status, 'PAY_AT_PROVIDER', 'NOT_REQUIRED',
                :payment_mode, :payment_state, :price_paise, :notes, :created_at, :created_at
            )
            """.trimIndent(),
        ).param("id", id)
            .param("outlet_id", outletId)
            .param("service_id", UUID.randomUUID())
            .param("slot_id", UUID.randomUUID())
            .param("pet_name", petName)
            .param("service_name", serviceName)
            .param("starts_at", createdAt.plusSeconds(3_600))
            .param("ends_at", createdAt.plusSeconds(5_400))
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
