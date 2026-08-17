package `in`.mypetnew.servicearea.infrastructure

import `in`.mypetnew.servicearea.domain.LaunchRequestResult
import `in`.mypetnew.servicearea.domain.LaunchRequestStatus
import `in`.mypetnew.servicearea.domain.ServiceRegion
import `in`.mypetnew.servicearea.domain.ServiceRegionFeatureFlags
import `in`.mypetnew.servicearea.domain.ServiceRegionPersistence
import org.springframework.jdbc.core.JdbcTemplate
import java.util.Locale
import java.util.UUID

class JdbcServiceRegionPersistence(
    private val jdbc: JdbcTemplate,
) : ServiceRegionPersistence {
    override fun activeRegions(): List<ServiceRegion> = jdbc.query(
        """
        SELECT id, city_identity, display_name, state_name, country_name,
               center_latitude, center_longitude, radius_km,
               allow_products, allow_grooming, allow_vet,
               allow_own_delivery, allow_3p_delivery, allow_cod, allow_online_payment
          FROM mypet.service_region
         WHERE status = 'ACTIVE'
         ORDER BY display_name, id
        """.trimIndent(),
    ) { rs, _ ->
        val id = rs.getObject("id", UUID::class.java)
        ServiceRegion(
            id = id,
            cityIdentity = rs.getString("city_identity"),
            displayName = rs.getString("display_name"),
            state = rs.getString("state_name"),
            country = rs.getString("country_name"),
            centerLatitude = rs.getDouble("center_latitude"),
            centerLongitude = rs.getDouble("center_longitude"),
            radiusKm = rs.getDouble("radius_km"),
            pincodes = jdbc.queryForList(
                """
                SELECT pincode
                  FROM mypet.service_region_pincode
                 WHERE service_region_id = ? AND active = TRUE
                 ORDER BY pincode
                """.trimIndent(),
                String::class.java,
                id,
            ).filterNotNull(),
            featureFlags = ServiceRegionFeatureFlags(
                allowProducts = rs.getBoolean("allow_products"),
                allowGrooming = rs.getBoolean("allow_grooming"),
                allowVet = rs.getBoolean("allow_vet"),
                allowOwnDelivery = rs.getBoolean("allow_own_delivery"),
                allow3pDelivery = rs.getBoolean("allow_3p_delivery"),
                allowCod = rs.getBoolean("allow_cod"),
                allowOnlinePayment = rs.getBoolean("allow_online_payment"),
            ),
        )
    }

    override fun registerLaunchRequest(cityName: String, contactInfo: String): LaunchRequestResult {
        val inserted = jdbc.update(
            """
            INSERT INTO mypet.service_region_launch_request
                (id, city_name, city_name_normalized, contact_info, contact_normalized, created_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (city_name_normalized, contact_normalized) DO NOTHING
            """.trimIndent(),
            UUID.randomUUID(),
            cityName,
            cityName.lowercase(Locale.ROOT),
            contactInfo,
            contactInfo.lowercase(Locale.ROOT),
        )
        return LaunchRequestResult(
            if (inserted == 1) LaunchRequestStatus.REGISTERED else LaunchRequestStatus.ALREADY_REGISTERED,
        )
    }
}
