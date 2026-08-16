package `in`.mypetnew.appointment.infrastructure

import `in`.mypetnew.appointment.domain.AppointmentPaymentMethod
import `in`.mypetnew.appointment.domain.AppointmentPaymentStatus
import `in`.mypetnew.appointment.domain.AppointmentStatus
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

data class MerchantAppointmentRequestView(
    val appointmentId: UUID,
    val outletId: UUID,
    val serviceId: UUID,
    val slotId: UUID,
    val petName: String,
    val serviceName: String,
    val startsAt: Instant,
    val endsAt: Instant,
    val status: AppointmentStatus,
    val paymentMethod: AppointmentPaymentMethod,
    val paymentStatus: AppointmentPaymentStatus,
    val pricePaise: Long,
    val notes: String?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class MerchantAppointmentRequestPage(
    val items: List<MerchantAppointmentRequestView>,
    val hasNext: Boolean,
)

@Component
class MerchantAppointmentQuery(
    private val jdbc: JdbcClient,
) {
    fun list(
        merchant: Principal,
        status: AppointmentStatus?,
        page: Int,
        pageSize: Int,
    ): MerchantAppointmentRequestPage {
        Authorizer.requireRole(merchant, Role.MERCHANT)
        if (page < 0 || pageSize !in 1..100) {
            throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        }
        if (merchant.outletIds.isEmpty()) return MerchantAppointmentRequestPage(emptyList(), false)

        val rows = jdbc.sql(
            """
            SELECT id, outlet_id, service_id, slot_id, pet_name, service_name,
                   starts_at, ends_at, status,
                   payment_mode AS payment_method,
                   payment_state AS payment_status,
                   price_paise, notes, created_at, updated_at
            FROM mypet.appointment
            WHERE outlet_id IN (:outlet_ids)
              AND (:status IS NULL OR status = :status)
            ORDER BY created_at DESC, id DESC
            LIMIT :limit OFFSET :offset
            """.trimIndent(),
        ).param("outlet_ids", merchant.outletIds)
            .param("status", status?.name)
            .param("limit", pageSize + 1)
            .param("offset", page.toLong() * pageSize.toLong())
            .query(::mapRequest)
            .list()

        return MerchantAppointmentRequestPage(rows.take(pageSize), rows.size > pageSize)
    }

    private fun mapRequest(row: ResultSet, @Suppress("UNUSED_PARAMETER") rowNum: Int) = MerchantAppointmentRequestView(
        appointmentId = row.getObject("id", UUID::class.java),
        outletId = row.getObject("outlet_id", UUID::class.java),
        serviceId = row.getObject("service_id", UUID::class.java),
        slotId = row.getObject("slot_id", UUID::class.java),
        petName = row.getString("pet_name"),
        serviceName = row.getString("service_name"),
        startsAt = row.instant("starts_at"),
        endsAt = row.instant("ends_at"),
        status = AppointmentStatus.valueOf(row.getString("status")),
        paymentMethod = AppointmentPaymentMethod.valueOf(row.getString("payment_method")),
        paymentStatus = AppointmentPaymentStatus.valueOf(row.getString("payment_status")),
        pricePaise = row.getLong("price_paise"),
        notes = row.getString("notes"),
        createdAt = row.instant("created_at"),
        updatedAt = row.instant("updated_at"),
    )
}

private fun ResultSet.instant(column: String): Instant =
    getObject(column, Timestamp::class.java).toInstant()
