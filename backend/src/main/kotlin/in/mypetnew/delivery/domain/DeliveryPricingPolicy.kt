package `in`.mypetnew.delivery.domain

import `in`.mypetnew.common.error.DomainException

data class DeliveryEstimate(
    val deliveryFeePaise: Long,
    val etaMinutes: Int,
)

class DeliveryPricingPolicy(
    private val baseFeePaise: Long,
    private val etaMinutes: Int,
) {
    init {
        if (baseFeePaise < 0) {
            throw DomainException("DELIVERY_FEE_INVALID", "The configured delivery fee is invalid")
        }
        if (etaMinutes !in 1..240) {
            throw DomainException("DELIVERY_ETA_INVALID", "The configured delivery ETA is invalid")
        }
    }

    fun estimate(): DeliveryEstimate = DeliveryEstimate(baseFeePaise, etaMinutes)
}
