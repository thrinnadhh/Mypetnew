package `in`.mypetnew.application.web

import `in`.mypetnew.servicearea.domain.LaunchRequestResult
import `in`.mypetnew.servicearea.domain.ServiceRegion
import `in`.mypetnew.servicearea.domain.ServiceRegionService
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

data class ServiceRegionLaunchRequest(
    val cityName: String,
    val contactInfo: String,
)

@RestController
@RequestMapping("/api/v1/service-regions")
class ServiceRegionController(
    private val serviceRegions: ServiceRegionService,
) {
    @GetMapping("/active")
    fun active(): List<ServiceRegion> = serviceRegions.activeRegions()

    @PostMapping("/launch-requests")
    fun requestLaunch(@RequestBody request: ServiceRegionLaunchRequest): LaunchRequestResult =
        serviceRegions.registerLaunchRequest(request.cityName, request.contactInfo)
}
