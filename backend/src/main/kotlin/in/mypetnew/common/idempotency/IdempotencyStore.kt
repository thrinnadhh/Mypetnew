package `in`.mypetnew.common.idempotency

import `in`.mypetnew.common.error.DomainException

class IdempotencyStore<T> {
    private data class Record<T>(val fingerprint: String, val result: T)

    private val records = mutableMapOf<Pair<String, String>, Record<T>>()

    @Synchronized
    fun execute(scope: String, key: String, fingerprint: String, operation: () -> T): T {
        require(key.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) { "Invalid idempotency key" }
        val recordKey = scope to key
        val existing = records[recordKey]
        if (existing != null) {
            if (existing.fingerprint != fingerprint) {
                throw DomainException(
                    "IDEMPOTENCY_FINGERPRINT_MISMATCH",
                    "The idempotency key was already used for another request",
                )
            }
            return existing.result
        }
        val result = operation()
        records[recordKey] = Record(fingerprint, result)
        return result
    }
}

