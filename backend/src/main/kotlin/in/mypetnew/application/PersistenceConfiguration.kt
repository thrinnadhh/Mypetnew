package `in`.mypetnew.application

import `in`.mypetnew.catalog.domain.InventoryPersistence
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
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
}
