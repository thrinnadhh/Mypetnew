package `in`.mypetnew.delivery.infrastructure

import `in`.mypetnew.delivery.domain.CaptainSupportPersistence
import `in`.mypetnew.delivery.domain.CaptainSupportTicket
import org.springframework.jdbc.core.JdbcTemplate
import java.sql.Timestamp
import java.util.UUID

class JdbcCaptainSupportPersistence(private val jdbc: JdbcTemplate) : CaptainSupportPersistence {
    override fun create(ticket: CaptainSupportTicket): CaptainSupportTicket {
        jdbc.update(
            """
            INSERT INTO mypet.captain_support_ticket(
                id, captain_id, category, subject, description, job_id, order_reference, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            ticket.id,
            ticket.captainId,
            ticket.category,
            ticket.subject,
            ticket.description,
            ticket.jobId,
            ticket.orderReference,
            ticket.status.name,
            Timestamp.from(ticket.createdAt),
            Timestamp.from(ticket.updatedAt),
        )
        return ticket
    }

    override fun findJobOwner(jobId: UUID): UUID? = jdbc.query(
        """
        SELECT assigned_captain_id
        FROM mypet.dispatch_job
        WHERE id = ?
        """.trimIndent(),
        { rs, _ -> rs.getObject("assigned_captain_id", UUID::class.java) },
        jobId,
    ).singleOrNull()
}
