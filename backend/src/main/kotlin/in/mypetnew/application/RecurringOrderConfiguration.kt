package `in`.mypetnew.application

import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.commerce.domain.CustomerOrderQuery
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.recurring.domain.InMemoryRecurringOrderPersistence
import `in`.mypetnew.recurring.domain.RecurringOrderPersistence
import `in`.mypetnew.recurring.domain.RecurringOrderService
import `in`.mypetnew.recurring.infrastructure.JdbcRecurringOrderPersistence
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.simple.JdbcClient

@Configuration
class RecurringOrderConfiguration {
    @Bean
    @Profile("test", "development")
    fun inMemoryRecurringOrderPersistence(): RecurringOrderPersistence = InMemoryRecurringOrderPersistence()

    @Bean
    @Profile("!test & !development")
    fun jdbcRecurringOrderPersistence(jdbc: JdbcClient): RecurringOrderPersistence = JdbcRecurringOrderPersistence(jdbc)

    @Bean
    fun recurringOrderService(
        persistence: RecurringOrderPersistence,
        orders: CustomerOrderQuery,
        catalog: CatalogService,
        providers: ProviderService,
        customerData: CustomerDataService,
    ) = RecurringOrderService(persistence, orders, catalog, providers, customerData)
}
