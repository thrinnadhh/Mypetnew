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
        if (page < 0 || pageSize !in 1..100 || page.toLong() * pageSize.toLong() > 100_000L) {
            throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        }
        val organizationId = merchant.organizationId ?: return MerchantAppointmentRequestPage(emptyList(), false)
        if (merchant.outletIds.isEmpty()) return MerchantAppointmentRequestPage(emptyList(), false)

        val rows = jdbc.sql(
            """
            SELECT a.id, a.outlet_id, a.service_id, a.slot_id, a.pet_name, a.service_name,
                   a.starts_at, a.ends_at, a.status,
                   a.payment_mode AS payment_method,
                   a.payment_state AS payment_status,
                   a.price_paise, a.notes, a.created_at, a.updated_at
            FROM mypet.appointment a
            JOIN mypet.provider_outlet o
              ON o.id = a.outlet_id
             AND o.organization_id = a.organization_id
             AND o.status = 'ACTIVE'
            JOIN mypet.merchant_organization organization
              ON organization.id = a.organization_id
             AND organization.status = 'ACTIVE'
            WHERE a.organization_id = :organization_id
              AND a.outlet_id IN (:outlet_ids)
              AND a.status = COALESCE(:status, a.status)
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT :limit OFFSET :offset
            """.trimIndent(),
        ).param("organization_id", organizationId)
            .param("outlet_ids", merchant.outletIds)
            .param("status", status?.name)
            .param("limit", pageSize + 1)
            .param("offset", page.toLong() * pageSize.toLong())
            .query(::mapRequest)
            .list()

        return MerchantAppointmentRequestPage(rows.take(pageSize), rows.size > pageSize)
    }

    fun get(merchant: Principal, appointmentId: UUID): MerchantAppointmentRequestView? {
        Authorizer.requireRole(merchant, Role.MERCHANT)
        val organizationId = merchant.organizationId ?: return null
        if (merchant.outletIds.isEmpty()) return null
        return jdbc.sql(
            """
            SELECT a.id, a.outlet_id, a.service_id, a.slot_id, a.pet_name, a.service_name,
                   a.starts_at, a.ends_at, a.status,
                   a.payment_mode AS payment_method,
                   a.payment_state AS payment_status,
                   a.price_paise, a.notes, a.created_at, a.updated_at
            FROM mypet.appointment a
            JOIN mypet.provider_outlet o
              ON o.id = a.outlet_id
             AND o.organization_id = a.organization_id
             AND o.status = 'ACTIVE'
            JOIN mypet.merchant_organization organization
              ON organization.id = a.organization_id
             AND organization.status = 'ACTIVE'
            WHERE a.id = :appointmentId
              AND a.organization_id = :organizationId
              AND a.outlet_id IN (:outletIds)
            """.trimIndent(),
        ).param("appointmentId", appointmentId)
            .param("organizationId", organizationId)
            .param("outletIds", merchant.outletIds)
            .query(::mapRequest).optional().orElse(null)
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
