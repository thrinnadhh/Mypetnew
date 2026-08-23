package `in`.mypetnew.delivery.domain

import `in`.mypetnew.common.error.DomainException
import java.time.Clock
import java.time.Instant
import java.util.UUID

enum class SupportTicketStatus {
    OPEN,
    RESOLVED,
    CLOSED,
}

data class CaptainSupportTicket(
    val id: UUID,
    val captainId: UUID,
    val category: String,
    val subject: String,
    val description: String,
    val jobId: UUID? = null,
    val orderReference: String? = null,
    val status: SupportTicketStatus = SupportTicketStatus.OPEN,
    val createdAt: Instant = Instant.now(),
    val updatedAt: Instant = Instant.now(),
)

data class CreateSupportTicketCommand(
    val category: String,
    val subject: String,
    val description: String,
    val jobId: UUID? = null,
    val orderReference: String? = null,
)

interface CaptainSupportPersistence {
    fun create(ticket: CaptainSupportTicket): CaptainSupportTicket
    fun findJobOwner(jobId: UUID): UUID?
}

class InMemoryCaptainSupportPersistence(
    private val dispatchPersistence: DispatchPersistence? = null,
) : CaptainSupportPersistence {
    private val tickets = mutableMapOf<UUID, CaptainSupportTicket>()

    @Synchronized
    override fun create(ticket: CaptainSupportTicket): CaptainSupportTicket {
        tickets[ticket.id] = ticket
        return ticket
    }

    @Synchronized
    override fun findJobOwner(jobId: UUID): UUID? = dispatchPersistence?.getJob(jobId)?.assignedCaptainId
}

class CaptainSupportService(
    private val persistence: CaptainSupportPersistence,
    private val clock: Clock = Clock.systemUTC(),
) {
    fun createTicket(captainId: UUID, command: CreateSupportTicketCommand): CaptainSupportTicket {
        val trimmedSubject = command.subject.trim()
        val trimmedDesc = command.description.trim()

        if (trimmedSubject.length !in 3..160) {
            throw DomainException("SUPPORT_SUBJECT_INVALID", "Support ticket subject must be between 3 and 160 characters")
        }
        if (trimmedDesc.length !in 5..2000) {
            throw DomainException("SUPPORT_DESCRIPTION_INVALID", "Support ticket description must be between 5 and 2000 characters")
        }

        if (command.jobId != null) {
            val jobOwner = persistence.findJobOwner(command.jobId)
            if (jobOwner == null || jobOwner != captainId) {
                throw DomainException("RESOURCE_NOT_FOUND", "The referenced delivery job is invalid or not assigned to you")
            }
        }

        val now = clock.instant()
        val ticket = CaptainSupportTicket(
            id = UUID.randomUUID(),
            captainId = captainId,
            category = command.category,
            subject = trimmedSubject,
            description = trimmedDesc,
            jobId = command.jobId,
            orderReference = command.orderReference?.trim()?.takeIf { it.isNotBlank() },
            status = SupportTicketStatus.OPEN,
            createdAt = now,
            updatedAt = now,
        )
        return persistence.create(ticket)
    }
}
