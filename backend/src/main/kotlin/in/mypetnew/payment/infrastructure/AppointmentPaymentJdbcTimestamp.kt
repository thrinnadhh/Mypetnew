package `in`.mypetnew.payment.infrastructure

import java.sql.Timestamp
import java.time.Instant

/**
 * Package-visible JDBC binding helper for appointment-payment persistence.
 *
 * JdbcPaymentPersistence keeps its own file-private helper; this helper exists
 * because JdbcAppointmentOnlinePaymentService must bind canonical instants as
 * JDBC timestamps without depending on another file's private declaration.
 */
internal fun Instant.jdbcTimestamp(): Timestamp = Timestamp.from(this)
