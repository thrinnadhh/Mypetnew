package `in`.mypetnew.common.money

enum class Currency(val code: String) {
    INR("INR"),
}

class Money private constructor(
    val paise: Long,
    val currency: Currency,
) {
    init {
        require(paise >= 0) { "Money cannot be negative" }
    }

    companion object {
        fun inr(paise: Long): Money = Money(paise, Currency.INR)
    }
}
