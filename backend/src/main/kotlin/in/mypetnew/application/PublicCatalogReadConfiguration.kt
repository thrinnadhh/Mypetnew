package `in`.mypetnew.application

import `in`.mypetnew.catalog.domain.PublicCatalogReadRepository
import `in`.mypetnew.catalog.infrastructure.JdbcPublicCatalogReadRepository
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.JdbcTemplate

@Configuration
@Profile("!test & !development")
class PublicCatalogReadConfiguration {
    @Bean
    fun publicCatalogReadRepository(jdbc: JdbcTemplate): PublicCatalogReadRepository =
        JdbcPublicCatalogReadRepository(jdbc)
}
