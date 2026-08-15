package `in`.mypetnew.application

import `in`.mypetnew.catalog.domain.CatalogPersistence
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.InventoryPersistence
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.commerce.domain.CustomerOrderQuery
import `in`.mypetnew.commerce.domain.OrderPersistence
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.QuotePersistence
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.commerce.infrastructure.JdbcCustomerOrderQuery
import `in`.mypetnew.commerce.infrastructure.JdbcOrderPersistence
import `in`.mypetnew.commerce.infrastructure.JdbcQuotePersistence
import `in`.mypetnew.customer.domain.CustomerDataPersistence
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.customer.infrastructure.JdbcCustomerDataPersistence
import `in`.mypetnew.loyalty.domain.LoyaltyPersistence
import `in`.mypetnew.loyalty.domain.LoyaltyService
import `in`.mypetnew.loyalty.infrastructure.JdbcLoyaltyPersistence
import `in`.mypetnew.pos.domain.CustomerAssociationChallengeService
import `in`.mypetnew.pos.domain.CustomerAssociationPersistence
import `in`.mypetnew.pos.domain.PosPersistence
import `in`.mypetnew.pos.domain.PosService
import `in`.mypetnew.pos.infrastructure.JdbcCustomerAssociationPersistence
import `in`.mypetnew.pos.infrastructure.JdbcPosPersistence
import `in`.mypetnew.provider.domain.ProviderPersistence
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.infrastructure.JdbcProviderPersistence
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.transaction.support.TransactionTemplate

@Configuration
@Profile("!test & !development")
class PersistenceConfiguration {
    @Bean
    fun providerPersistence(jdbc: JdbcTemplate, transactions: TransactionTemplate): ProviderPersistence =
        JdbcProviderPersistence(jdbc, transactions)

    @Bean
    fun productionProviderService(persistence: ProviderPersistence): ProviderService = ProviderService(persistence)

    @Bean
    fun catalogPersistence(jdbc: JdbcTemplate, transactions: TransactionTemplate): CatalogPersistence =
        JdbcCatalogPersistence(jdbc, transactions)

    @Bean
    fun productionCatalogService(persistence: CatalogPersistence): CatalogService = CatalogService(persistence)

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
    fun customerOrderQuery(jdbc: JdbcTemplate): CustomerOrderQuery = JdbcCustomerOrderQuery(jdbc)

    @Bean
    fun productionOrderService(inventory: InventoryService, persistence: OrderPersistence): OrderService =
        OrderService(inventory, persistence)

    @Bean
    fun customerDataPersistence(jdbc: JdbcClient, transactions: TransactionTemplate): CustomerDataPersistence =
        JdbcCustomerDataPersistence(jdbc, transactions)

    @Bean
    fun productionCustomerDataService(persistence: CustomerDataPersistence): CustomerDataService =
        CustomerDataService(persistence)

    @Bean
    fun loyaltyPersistence(jdbc: JdbcTemplate, transactions: TransactionTemplate): LoyaltyPersistence =
        JdbcLoyaltyPersistence(jdbc, transactions)

    @Bean
    fun productionLoyaltyService(persistence: LoyaltyPersistence): LoyaltyService = LoyaltyService(persistence)

    @Bean
    fun customerAssociationPersistence(
        jdbc: JdbcTemplate,
        transactions: TransactionTemplate,
    ): CustomerAssociationPersistence = JdbcCustomerAssociationPersistence(jdbc, transactions)

    @Bean
    fun productionCustomerAssociationService(
        persistence: CustomerAssociationPersistence,
    ): CustomerAssociationChallengeService = CustomerAssociationChallengeService(persistence = persistence)

    @Bean
    fun posPersistence(jdbc: JdbcTemplate, transactions: TransactionTemplate): PosPersistence =
        JdbcPosPersistence(jdbc, transactions)

    @Bean
    fun productionPosService(
        inventory: InventoryService,
        loyalty: LoyaltyService,
        persistence: PosPersistence,
    ): PosService = PosService(inventory, loyalty, persistence)
}
