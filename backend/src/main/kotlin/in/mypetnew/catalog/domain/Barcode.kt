package `in`.mypetnew.catalog.domain

import `in`.mypetnew.common.error.DomainException

enum class BarcodeType(val digits: Int?) {
    GTIN_8(8),
    GTIN_12(12),
    GTIN_13(13),
    GTIN_14(14),
    INTERNAL(null),
}

object BarcodeNormalizer {
    private val internalPattern = Regex("[A-Z0-9][A-Z0-9._-]{0,31}")

    fun normalize(type: BarcodeType, raw: String): String {
        if (raw.isBlank() || raw.length > 64 || raw.any { it.code < 32 || it.code == 127 }) {
            invalid()
        }
        if (type == BarcodeType.INTERNAL) {
            val value = raw.trim().uppercase()
            if (!internalPattern.matches(value)) invalid()
            return value
        }

        if (raw.any { !it.isDigit() && it != ' ' && it != '-' }) invalid()
        val normalized = raw.filter(Char::isDigit)
        if (normalized.length != type.digits || !hasValidGtinCheckDigit(normalized)) invalid()
        return normalized
    }

    private fun hasValidGtinCheckDigit(value: String): Boolean {
        val expected = value.last().digitToInt()
        val sum = value.dropLast(1)
            .reversed()
            .mapIndexed { index, character -> character.digitToInt() * if (index % 2 == 0) 3 else 1 }
            .sum()
        return (10 - sum % 10) % 10 == expected
    }

    private fun invalid(): Nothing = throw DomainException("BARCODE_INVALID", "The barcode is not valid")
}

