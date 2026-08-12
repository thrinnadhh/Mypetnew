package `in`.mypetnew.application

import `in`.mypetnew.catalog.domain.InventoryPersistence
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.commerce.domain.OrderPersistence
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.QuotePersistence
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.commerce.infrastructure.JdbcOrderPersistence
import `in`.mypetnew.commerce.infrastructure.JdbcQuotePersistence
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate

@Configuration
@Profile("!test & !development")
class PersistenceConfiguration {
    @Bean
    fun inventoryPersistence(jdbc: JdbcTemplate, transactions: TransactionTemplate): InventoryPersistence =
        JdbcInventoryPersistence(jdbc, transactions)

    @Bean
    fun productionInventoryService(persistence: InventoryPersistence): InventoryService = InventoryService(persistence)

    @Bean
    fun quotePersistence(jdbc: JdbcTemplate, transactions: TransactionTemplate): QuotePersistence =
        JdbcQuotePersistence(jdbc, transactions)

    @Bean
    fun productionQuoteService(persistence: QuotePersistence): QuoteService = QuoteService(persistence = persistence)

    @Bean
    fun orderPersistence(jdbc: JdbcTemplate, transactions: TransactionTemplate): OrderPersistence =
        JdbcOrderPersistence(jdbc, transactions)

    @Bean
    fun productionOrderService(inventory: InventoryService, persistence: OrderPersistence): OrderService =
        OrderService(inventory, persistence)
}
