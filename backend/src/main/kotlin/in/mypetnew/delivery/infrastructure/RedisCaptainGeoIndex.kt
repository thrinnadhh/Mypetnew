package `in`.mypetnew.delivery.infrastructure

import `in`.mypetnew.delivery.domain.CaptainGeoIndex
import `in`.mypetnew.delivery.domain.CaptainLocation
import org.springframework.data.geo.Distance
import org.springframework.data.geo.Metrics
import org.springframework.data.geo.Point
import org.springframework.data.redis.connection.RedisGeoCommands
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.domain.geo.GeoReference
import java.time.Duration
import java.time.Instant
import java.util.UUID

class RedisCaptainGeoIndex(
    private val redis: StringRedisTemplate,
    private val freshnessTtl: Duration = Duration.ofMinutes(2),
) : CaptainGeoIndex {
    override fun update(captainId: UUID, location: CaptainLocation) {
        redis.opsForGeo().add(GEO_KEY, Point(location.longitude, location.latitude), captainId.toString())
        redis.opsForValue().set(
            freshnessKey(captainId),
            location.observedAt.toEpochMilli().toString(),
            freshnessTtl,
        )
    }

    override fun remove(captainId: UUID) {
        redis.opsForGeo().remove(GEO_KEY, captainId.toString())
        redis.delete(freshnessKey(captainId))
    }

    override fun location(captainId: UUID): CaptainLocation? = runCatching {
        val observedAt = redis.opsForValue().get(freshnessKey(captainId))
            ?.toLongOrNull()
            ?.let(Instant::ofEpochMilli)
            ?: return@runCatching null
        val point = redis.opsForGeo().position(GEO_KEY, captainId.toString())?.firstOrNull() ?: return@runCatching null
        CaptainLocation(
            latitude = point.y,
            longitude = point.x,
            observedAt = observedAt,
        )
    }.getOrNull()

    override fun nearest(
        latitude: Double,
        longitude: Double,
        radiusKm: Double,
        limit: Int,
    ): List<UUID> = runCatching {
        val args = RedisGeoCommands.GeoSearchCommandArgs.newGeoSearchArgs().includeDistance().sortAscending()
        redis.opsForGeo().search(
            GEO_KEY,
            GeoReference.fromCoordinate(Point(longitude, latitude)),
            Distance(radiusKm, Metrics.KILOMETERS),
            args,
        )?.content
            ?.asSequence()
            ?.mapNotNull { result -> runCatching { UUID.fromString(result.content.name) }.getOrNull() }
            ?.filter { captainId -> redis.hasKey(freshnessKey(captainId)) }
            ?.take(limit)
            ?.toList()
            ?: emptyList()
    }.getOrDefault(emptyList())

    private fun freshnessKey(captainId: UUID): String = "$FRESHNESS_PREFIX$captainId"

    companion object {
        private const val GEO_KEY = "mypet:captains:geo"
        private const val FRESHNESS_PREFIX = "mypet:captains:fresh:"
    }
}
