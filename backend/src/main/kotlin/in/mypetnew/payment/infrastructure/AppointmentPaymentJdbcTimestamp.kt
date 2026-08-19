package `in`.mypetnew.payment.infrastructure

import java.sql.Timestamp
import java.time.Instant

/**
 * JDBC binding fallback for appointment-payment persistence.
 *
 * Product payment persistence has a file-private non-null Instant extension.
 * Keeping this fallback nullable makes that existing exact overload strictly
 * more specific while still supporting the appointment service's non-null and
 * safe-call timestamp bindings.
 */
internal fun Instant?.jdbcTimestamp(): Timestamp = Timestamp.from(requireNotNull(this))
