package `in`.mypetnew.appointment

import `in`.mypetnew.appointment.domain.AppointmentPaymentMethod
import `in`.mypetnew.appointment.domain.AppointmentPaymentStatus
import `in`.mypetnew.appointment.domain.AppointmentStatus
import `in`.mypetnew.appointment.domain.CustomerAppointment
import `in`.mypetnew.appointment.infrastructure.JdbcAppointmentPersistence
import `in`.mypetnew.common.error.DomainException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.transaction.support.TransactionTemplate
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource

class JdbcAppointmentPersistenceConcurrencyTest {
    private val now = Instant.parse("2026-08-19T06:00:00Z")

    @Test
    fun `two persistence instances cannot acquire the same slot for different customers`() {
        val database = database()
        val serviceId = UUID.randomUUID()
        val slotId = UUID.randomUUID()
        insertSlot(database, serviceId, slotId, now.plusSeconds(3_600))
        val firstPersistence = persistence(database)
        val secondPersistence = persistence(database)
        val firstAppointment = appointment(UUID.randomUUID(), serviceId, slotId)
        val secondAppointment = appointment(UUID.randomUUID(), serviceId, slotId)

        val results = race(
            { firstPersistence.hold(firstAppointment, "hold-a", "fingerprint-a", now) },
            { secondPersistence.hold(secondAppointment, "hold-b", "fingerprint-b", now) },
        )

        val successes = results.mapNotNull { it.getOrNull() }
        val failures = results.mapNotNull { it.exceptionOrNull() }
        assertEquals(1, successes.size)
        assertEquals(1, failures.size)
        assertEquals("APPOINTMENT_SLOT_UNAVAILABLE", (failures.single() as DomainException).code)
        assertEquals(1, activeOccupancyCount(database, slotId))
    }

    @Test
    fun `concurrent same customer idempotency replay returns one stored appointment`() {
        val database = database()
        val serviceId = UUID.randomUUID()
        val slotId = UUID.randomUUID()
        insertSlot(database, serviceId, slotId, now.plusSeconds(3_600))
        val firstPersistence = persistence(database)
        val secondPersistence = persistence(database)
        val customerId = UUID.randomUUID()
        val firstAttempt = appointment(customerId, serviceId, slotId)
        val retryAttempt = appointment(customerId, serviceId, slotId)

        val results = race(
            { firstPersistence.hold(firstAttempt, "same-key", "same-fingerprint", now) },
            { secondPersistence.hold(retryAttempt, "same-key", "same-fingerprint", now) },
        )

        assertTrue(results.all { it.isSuccess }, results.map { it.exceptionOrNull() }.toString())
        assertEquals(1, results.mapNotNull { it.getOrNull()?.id }.toSet().size)
        assertEquals(1, appointmentCount(database, customerId, "same-key"))
        assertEquals(1, activeOccupancyCount(database, slotId))
    }

    @Test
    fun `expired JDBC hold releases slot and same key changed payload conflicts`() {
        val database = database()
        val serviceId = UUID.randomUUID()
        val slotId = UUID.randomUUID()
        insertSlot(database, serviceId, slotId, now.plusSeconds(3_600))
        val firstPersistence = persistence(database)
        val secondPersistence = persistence(database)
        val firstCustomer = UUID.randomUUID()
        val first = firstPersistence.hold(
            appointment(firstCustomer, serviceId, slotId),
            "stable-key",
            "fingerprint-original",
            now,
        )

        val mismatch = runCatching {
            secondPersistence.hold(
                appointment(firstCustomer, serviceId, slotId),
                "stable-key",
                "fingerprint-changed",
                now,
            )
        }.exceptionOrNull()
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", (mismatch as DomainException).code)

        val replacement = secondPersistence.hold(
            appointment(UUID.randomUUID(), serviceId, slotId, now.plusSeconds(601)),
            "replacement-key",
            "replacement-fingerprint",
            now.plusSeconds(601),
        )
        assertTrue(replacement.id != first.id)
        assertEquals(1, activeOccupancyCount(database, slotId))
        assertEquals(1, statusCount(database, slotId, "HOLD_EXPIRED"))
    }

    private fun race(
        first: () -> CustomerAppointment,
        second: () -> CustomerAppointment,
    ): List<Result<CustomerAppointment>> {
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)
        return try {
            val tasks = listOf(
                Callable {
                    ready.countDown()
                    check(start.await(5, TimeUnit.SECONDS))
                    runCatching(first)
                },
                Callable {
                    ready.countDown()
                    check(start.await(5, TimeUnit.SECONDS))
                    runCatching(second)
                },
            )
            val futures = tasks.map(executor::submit)
            assertTrue(ready.await(5, TimeUnit.SECONDS), "Both hold attempts must reach the start barrier")
            start.countDown()
            futures.map { it.get(10, TimeUnit.SECONDS) }
        } finally {
            executor.shutdownNow()
        }
    }

    private fun database(): DataSource {
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:p12-${UUID.randomUUID()};MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
            "sa",
            "",
        )
        JdbcTemplate(dataSource).execute(
            """
            CREATE SCHEMA mypet;
            CREATE TABLE mypet.service_slot(
                id UUID PRIMARY KEY,
                service_id UUID NOT NULL,
                starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
                ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
                active BOOLEAN NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE mypet.appointment(
                id UUID PRIMARY KEY,
                customer_id UUID NOT NULL,
                pet_id UUID NOT NULL,
                organization_id UUID NOT NULL,
                outlet_id UUID NOT NULL,
                service_id UUID NOT NULL,
                slot_id UUID NOT NULL,
                service_name VARCHAR(160) NOT NULL,
                outlet_name VARCHAR(160) NOT NULL,
                pet_name VARCHAR(120) NOT NULL,
                starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
                ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
                status VARCHAR(32) NOT NULL,
                payment_method VARCHAR(32) NOT NULL,
                payment_status VARCHAR(32) NOT NULL,
                price_paise BIGINT NOT NULL,
                currency VARCHAR(3) NOT NULL,
                notes VARCHAR(1000),
                hold_expires_at TIMESTAMP WITH TIME ZONE,
                idempotency_key VARCHAR(128) NOT NULL,
                request_fingerprint VARCHAR(128) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT uq_appointment_customer_idempotency UNIQUE(customer_id, idempotency_key)
            );
            CREATE TABLE mypet.appointment_history(
                id UUID PRIMARY KEY,
                appointment_id UUID NOT NULL,
                status VARCHAR(32) NOT NULL,
                actor_id UUID NOT NULL,
                note VARCHAR(500),
                occurred_at TIMESTAMP WITH TIME ZONE NOT NULL
            );
            """.trimIndent(),
        )
        return dataSource
    }

    private fun persistence(dataSource: DataSource): JdbcAppointmentPersistence = JdbcAppointmentPersistence(
        JdbcClient.create(dataSource),
        TransactionTemplate(DataSourceTransactionManager(dataSource)),
    )

    private fun insertSlot(dataSource: DataSource, serviceId: UUID, slotId: UUID, startsAt: Instant) {
        JdbcTemplate(dataSource).update(
            """
            INSERT INTO mypet.service_slot(id, service_id, starts_at, ends_at, active)
            VALUES (?, ?, ?, ?, TRUE)
            """.trimIndent(),
            slotId,
            serviceId,
            Timestamp.from(startsAt),
            Timestamp.from(startsAt.plusSeconds(1_800)),
        )
    }

    private fun appointment(
        customerId: UUID,
        serviceId: UUID,
        slotId: UUID,
        at: Instant = now,
    ): CustomerAppointment = CustomerAppointment(
        id = UUID.randomUUID(),
        customerId = customerId,
        petId = UUID.randomUUID(),
        organizationId = UUID.randomUUID(),
        outletId = UUID.randomUUID(),
        serviceId = serviceId,
        slotId = slotId,
        serviceName = "P12 concurrency service",
        outletName = "P12 provider",
        petName = "Milo",
        startsAt = now.plusSeconds(3_600),
        endsAt = now.plusSeconds(5_400),
        status = AppointmentStatus.HOLD,
        paymentMethod = AppointmentPaymentMethod.PAY_AT_PROVIDER,
        paymentStatus = AppointmentPaymentStatus.NOT_REQUIRED,
        pricePaise = 50_000,
        notes = null,
        holdExpiresAt = at.plusSeconds(600),
        createdAt = at,
        updatedAt = at,
    )

    private fun activeOccupancyCount(dataSource: DataSource, slotId: UUID): Int = JdbcTemplate(dataSource).queryForObject(
        """
        SELECT COUNT(*) FROM mypet.appointment
        WHERE slot_id = ? AND status IN ('HOLD','BOOKED','CONFIRMED','CHECKED_IN','IN_SERVICE')
        """.trimIndent(),
        Int::class.java,
        slotId,
    ) ?: 0

    private fun appointmentCount(dataSource: DataSource, customerId: UUID, key: String): Int = JdbcTemplate(dataSource).queryForObject(
        "SELECT COUNT(*) FROM mypet.appointment WHERE customer_id = ? AND idempotency_key = ?",
        Int::class.java,
        customerId,
        key,
    ) ?: 0

    private fun statusCount(dataSource: DataSource, slotId: UUID, status: String): Int = JdbcTemplate(dataSource).queryForObject(
        "SELECT COUNT(*) FROM mypet.appointment WHERE slot_id = ? AND status = ?",
        Int::class.java,
        slotId,
        status,
    ) ?: 0
}
