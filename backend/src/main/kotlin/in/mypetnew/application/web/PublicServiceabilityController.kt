package `in`.mypetnew.application.web

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

enum class ServiceabilityMode { DELIVERY, PICKUP }

data class ServiceabilityResponse(
    val serviceable: Boolean,
    val fulfilmentMode: String,
    val reasonCode: String,
)

@RestController
@RequestMapping("/api/v1/public/outlets")
class PublicServiceabilityController(
    private val providers: ProviderService,
) {
    @GetMapping("/{outletId}/serviceability")
    fun serviceability(
        @PathVariable outletId: UUID,
        @RequestParam pincode: String,
        @RequestParam(defaultValue = "DELIVERY") mode: ServiceabilityMode,
    ): ServiceabilityResponse {
        if (!pincode.matches(Regex("[1-9][0-9]{5}"))) {
            throw DomainException("PIN_CODE_INVALID", "PIN code must contain exactly six digits")
        }
        val outlet = providers.getOutlet(outletId)
        if (outlet.status != ProviderStatus.ACTIVE) {
            return ServiceabilityResponse(false, mode.fulfilmentMode(), "OUTLET_INACTIVE")
        }
        return when (mode) {
            ServiceabilityMode.PICKUP -> {
                val available = outlet.pickupEnabled && ProviderCapability.PRODUCT_STORE in outlet.capabilities
                ServiceabilityResponse(
                    serviceable = available,
                    fulfilmentMode = mode.fulfilmentMode(),
                    reasonCode = if (available) "SERVICEABLE" else "PICKUP_NOT_ENABLED",
                )
            }

            ServiceabilityMode.DELIVERY -> {
                val productStore = ProviderCapability.PRODUCT_STORE in outlet.capabilities
                val pinSupported = pincode in outlet.servicePinCodes
                val dispatchOriginConfigured = outlet.latitude != null && outlet.longitude != null
                val available = productStore && pinSupported && dispatchOriginConfigured
                val reason = when {
                    !productStore -> "DELIVERY_NOT_ENABLED"
                    !pinSupported -> "PIN_NOT_SERVICEABLE"
                    !dispatchOriginConfigured -> "DELIVERY_ORIGIN_UNAVAILABLE"
                    else -> "SERVICEABLE"
                }
                ServiceabilityResponse(
                    serviceable = available,
                    fulfilmentMode = mode.fulfilmentMode(),
                    reasonCode = reason,
                )
            }
        }
    }

    private fun ServiceabilityMode.fulfilmentMode(): String = when (this) {
        ServiceabilityMode.PICKUP -> "STORE_PICKUP"
        ServiceabilityMode.DELIVERY -> "MYPET_CAPTAIN_DELIVERY"
    }
}
