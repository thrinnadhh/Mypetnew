package `in`.mypetnew.common.error

class DomainException(
    val code: String,
    override val message: String,
) : RuntimeException(message)

