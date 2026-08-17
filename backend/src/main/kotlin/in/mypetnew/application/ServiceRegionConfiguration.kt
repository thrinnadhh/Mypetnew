package `in`.mypetnew.application

import `in`.mypetnew.servicearea.domain.InMemoryServiceRegionPersistence
import `in`.mypetnew.servicearea.domain.ServiceRegionPersistence
import `in`.mypetnew.servicearea.domain.ServiceRegionService
import `in`.mypetnew.servicearea.infrastructure.JdbcServiceRegionPersistence
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.JdbcTemplate

@Configuration
class ServiceRegionConfiguration {
    @Bean
    @Profile("test", "development")
    fun inMemoryServiceRegionPersistence(): ServiceRegionPersistence = InMemoryServiceRegionPersistence()

    @Bean
    @Profile("!test & !development")
    fun jdbcServiceRegionPersistence(jdbc: JdbcTemplate): ServiceRegionPersistence =
        JdbcServiceRegionPersistence(jdbc)

    @Bean
    fun serviceRegionService(persistence: ServiceRegionPersistence): ServiceRegionService =
        ServiceRegionService(persistence)
}
