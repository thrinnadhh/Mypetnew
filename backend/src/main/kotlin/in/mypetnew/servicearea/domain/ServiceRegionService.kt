package `in`.mypetnew.servicearea.domain

import `in`.mypetnew.common.error.DomainException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

data class ServiceRegionFeatureFlags(
    val allowProducts: Boolean,
    val allowGrooming: Boolean,
    val allowVet: Boolean,
    val allowOwnDelivery: Boolean,
    val allow3pDelivery: Boolean,
    val allowCod: Boolean,
    val allowOnlinePayment: Boolean,
)

data class ServiceRegion(
    val id: UUID,
    val cityIdentity: String,
    val displayName: String,
    val state: String,
    val country: String,
    val centerLatitude: Double,
    val centerLongitude: Double,
    val radiusKm: Double,
    val pincodes: List<String>,
    val featureFlags: ServiceRegionFeatureFlags,
)

enum class LaunchRequestStatus {
    REGISTERED,
    ALREADY_REGISTERED,
}

data class LaunchRequestResult(val status: LaunchRequestStatus)

interface ServiceRegionPersistence {
    fun activeRegions(): List<ServiceRegion>
    fun registerLaunchRequest(cityName: String, contactInfo: String): LaunchRequestResult
}

class InMemoryServiceRegionPersistence : ServiceRegionPersistence {
    private val requests = ConcurrentHashMap.newKeySet<String>()

    override fun activeRegions(): List<ServiceRegion> = listOf(DEFAULT_TIRUPATI_REGION)

    override fun registerLaunchRequest(cityName: String, contactInfo: String): LaunchRequestResult {
        val key = "${cityName.lowercase()}|${contactInfo.lowercase()}"
        return if (requests.add(key)) {
            LaunchRequestResult(LaunchRequestStatus.REGISTERED)
        } else {
            LaunchRequestResult(LaunchRequestStatus.ALREADY_REGISTERED)
        }
    }

    companion object {
        val DEFAULT_TIRUPATI_REGION = ServiceRegion(
            id = UUID.fromString("81111111-1111-1111-1111-111111111111"),
            cityIdentity = "tirupati",
            displayName = "Tirupati",
            state = "Andhra Pradesh",
            country = "India",
            centerLatitude = 13.6288,
            centerLongitude = 79.4192,
            radiusKm = 25.0,
            pincodes = listOf("517501", "517502", "517507"),
            featureFlags = ServiceRegionFeatureFlags(
                allowProducts = true,
                allowGrooming = true,
                allowVet = true,
                allowOwnDelivery = true,
                allow3pDelivery = true,
                allowCod = true,
                allowOnlinePayment = true,
            ),
        )
    }
}

class ServiceRegionService(private val persistence: ServiceRegionPersistence) {
    fun activeRegions(): List<ServiceRegion> = persistence.activeRegions()

    fun registerLaunchRequest(cityName: String, contactInfo: String): LaunchRequestResult {
        val city = cityName.trim().replace(Regex("\\s+"), " ")
        val contact = contactInfo.trim()
        if (city.length !in 2..120 || !CITY_PATTERN.matches(city)) {
            throw DomainException("SERVICE_REGION_REQUEST_INVALID", "City name is invalid")
        }
        if (contact.length !in 5..254 || (!EMAIL_PATTERN.matches(contact) && !MOBILE_PATTERN.matches(contact))) {
            throw DomainException("SERVICE_REGION_REQUEST_INVALID", "A valid email address or mobile number is required")
        }
        return persistence.registerLaunchRequest(city, contact)
    }

    companion object {
        private val CITY_PATTERN = Regex("[A-Za-z][A-Za-z .'-]{1,119}")
        private val EMAIL_PATTERN = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")
        private val MOBILE_PATTERN = Regex("^\\+?[0-9][0-9 -]{7,18}[0-9]$")
    }
}
