package `in`.mypetnew.application

import `in`.mypetnew.appointment.domain.AppointmentPersistence
import `in`.mypetnew.appointment.domain.AppointmentService
import `in`.mypetnew.appointment.infrastructure.JdbcAppointmentPersistence
import `in`.mypetnew.appointment.infrastructure.OnlineAwareJdbcAppointmentPersistence
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
import `in`.mypetnew.customer.domain.CustomerFavouritePersistence
import `in`.mypetnew.customer.domain.CustomerFavouriteService
import `in`.mypetnew.customer.infrastructure.JdbcCustomerDataPersistence
import `in`.mypetnew.customer.infrastructure.JdbcCustomerFavouritePersistence
import `in`.mypetnew.delivery.domain.CaptainGeoIndex
import `in`.mypetnew.delivery.domain.DispatchPersistence
import `in`.mypetnew.delivery.domain.DispatchService
import `in`.mypetnew.delivery.infrastructure.JdbcDispatchPersistence
import `in`.mypetnew.delivery.infrastructure.RedisCaptainGeoIndex
import `in`.mypetnew.engagement.domain.NotificationService
import `in`.mypetnew.engagement.domain.SafeRoute
import `in`.mypetnew.loyalty.domain.LoyaltyPersistence
import `in`.mypetnew.loyalty.domain.LoyaltyService
import `in`.mypetnew.loyalty.infrastructure.JdbcLoyaltyPersistence
import `in`.mypetnew.payment.domain.PaymentGateway
import `in`.mypetnew.payment.domain.PaymentPersistence
import `in`.mypetnew.payment.domain.PaymentService
import `in`.mypetnew.payment.domain.TerminalAppointmentPaymentProjection
import `in`.mypetnew.payment.domain.TerminalOrderPaymentProjection
import `in`.mypetnew.payment.infrastructure.JdbcAppointmentOnlinePaymentService
import `in`.mypetnew.payment.infrastructure.JdbcPaymentPersistence
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
import org.springframework.data.redis.core.StringRedisTemplate
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
    fun catalogPersistence(
        jdbc: JdbcTemplate,
        transactions: TransactionTemplate,
        syncFeed: `in`.mypetnew.catalog.infrastructure.JdbcMerchantSyncFeed,
    ): CatalogPersistence =
        JdbcCatalogPersistence(jdbc, transactions, syncFeed)

    @Bean
    fun productionCatalogService(persistence: CatalogPersistence): CatalogService = CatalogService(persistence)

    @Bean
    fun inventoryPersistence(
        jdbc: JdbcTemplate,
        transactions: TransactionTemplate,
        syncFeed: `in`.mypetnew.catalog.infrastructure.JdbcMerchantSyncFeed,
    ): InventoryPersistence =
        JdbcInventoryPersistence(jdbc, transactions, syncFeed)

    @Bean
    fun productionInventoryService(persistence: InventoryPersistence): InventoryService = InventoryService(persistence)

    @Bean
    fun quotePersistence(jdbc: JdbcTemplate, transactions: TransactionTemplate): QuotePersistence =
        JdbcQuotePersistence(jdbc, transactions)

    @Bean
    fun productionQuoteService(persistence: QuotePersistence, gateway: PaymentGateway): QuoteService =
        QuoteService(persistence = persistence, onlinePaymentAvailable = { gateway.available })

    @Bean
    fun paymentPersistence(
        jdbc: JdbcTemplate,
        transactions: TransactionTemplate,
        inventory: InventoryService,
    ): JdbcPaymentPersistence = JdbcPaymentPersistence(jdbc, transactions, inventory)

    @Bean
    fun appointmentOnlinePaymentService(
        jdbc: JdbcTemplate,
        transactions: TransactionTemplate,
        gateway: PaymentGateway,
    ): JdbcAppointmentOnlinePaymentService = JdbcAppointmentOnlinePaymentService(jdbc, transactions, gateway)

    @Bean
    fun terminalOrderPaymentProjection(persistence: JdbcPaymentPersistence): TerminalOrderPaymentProjection =
        TerminalOrderPaymentProjection(persistence::projectTerminalOrder)

    @Bean
    fun terminalAppointmentPaymentProjection(
        payments: JdbcAppointmentOnlinePaymentService,
    ): TerminalAppointmentPaymentProjection = TerminalAppointmentPaymentProjection(payments::projectTerminalAppointment)

    @Bean
    fun orderPersistence(
        jdbc: JdbcTemplate,
        transactions: TransactionTemplate,
        terminalPayments: TerminalOrderPaymentProjection,
    ): OrderPersistence = JdbcOrderPersistence(jdbc, transactions, terminalPayments)

    @Bean
    fun customerOrderQuery(jdbc: JdbcTemplate): CustomerOrderQuery = JdbcCustomerOrderQuery(jdbc)

    @Bean
    fun productionOrderService(inventory: InventoryService, persistence: OrderPersistence): OrderService =
        OrderService(inventory, persistence)

    @Bean
    fun productionPaymentService(persistence: PaymentPersistence, gateway: PaymentGateway): PaymentService =
        PaymentService(persistence, gateway)

    @Bean
    fun dispatchPersistence(jdbc: JdbcTemplate, transactions: TransactionTemplate): DispatchPersistence =
        JdbcDispatchPersistence(jdbc, transactions)

    @Bean
    fun captainGeoIndex(redis: StringRedisTemplate): CaptainGeoIndex = RedisCaptainGeoIndex(redis)

    @Bean
    fun productionDispatchService(
        persistence: DispatchPersistence,
        geoIndex: CaptainGeoIndex,
        orders: OrderService,
        notifications: NotificationService,
    ): DispatchService = DispatchService(
        persistence,
        geoIndex,
        orders,
        offerNotifier = { offer ->
            notifications.enqueue(
                sourceEventId = offer.id,
                recipientId = offer.captainId,
                templateVersion = "captain-dispatch-offer-v1",
                title = "New delivery assignment",
                body = "Open MyPet Captain to review an available delivery.",
                route = SafeRoute.CAPTAIN_OFFER,
                resourceId = offer.id,
            )
        },
    )

    @Bean
    fun customerDataPersistence(jdbc: JdbcClient, transactions: TransactionTemplate): CustomerDataPersistence =
        JdbcCustomerDataPersistence(jdbc, transactions)

    @Bean
    fun productionCustomerDataService(persistence: CustomerDataPersistence): CustomerDataService =
        CustomerDataService(persistence)

    @Bean
    fun appointmentPersistence(
        jdbcClient: JdbcClient,
        transactions: TransactionTemplate,
        terminalPayments: TerminalAppointmentPaymentProjection,
    ): AppointmentPersistence = OnlineAwareJdbcAppointmentPersistence(
        JdbcAppointmentPersistence(jdbcClient, transactions),
        jdbcClient,
        terminalPayments,
    )

    @Bean
    fun productionAppointmentService(
        persistence: AppointmentPersistence,
        providers: ProviderService,
        customerData: CustomerDataService,
    ): AppointmentService = AppointmentService(persistence, providers, customerData)

    @Bean
    fun customerFavouritePersistence(jdbc: JdbcClient): CustomerFavouritePersistence =
        JdbcCustomerFavouritePersistence(jdbc)

    @Bean
    fun productionCustomerFavouriteService(
        persistence: CustomerFavouritePersistence,
        catalog: CatalogService,
        providers: ProviderService,
    ): CustomerFavouriteService = CustomerFavouriteService(persistence, catalog, providers)

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

    @Bean
    fun captainOnboardingPersistence(jdbc: JdbcTemplate, transactions: TransactionTemplate): `in`.mypetnew.delivery.domain.CaptainOnboardingPersistence =
        `in`.mypetnew.delivery.infrastructure.JdbcCaptainOnboardingPersistence(jdbc, transactions)

    @Bean
    fun productionCaptainOnboardingService(persistence: `in`.mypetnew.delivery.domain.CaptainOnboardingPersistence): `in`.mypetnew.delivery.domain.CaptainOnboardingService =
        `in`.mypetnew.delivery.domain.CaptainOnboardingService(persistence)

    @Bean
    fun captainEarningsPersistence(jdbc: JdbcTemplate): `in`.mypetnew.delivery.domain.CaptainEarningsPersistence =
        `in`.mypetnew.delivery.infrastructure.JdbcCaptainEarningsPersistence(jdbc)

    @Bean
    fun productionCaptainEarningsService(persistence: `in`.mypetnew.delivery.domain.CaptainEarningsPersistence): `in`.mypetnew.delivery.domain.CaptainEarningsService =
        `in`.mypetnew.delivery.domain.CaptainEarningsService(persistence)

    @Bean
    fun captainSupportPersistence(jdbc: JdbcTemplate): `in`.mypetnew.delivery.domain.CaptainSupportPersistence =
        `in`.mypetnew.delivery.infrastructure.JdbcCaptainSupportPersistence(jdbc)

    @Bean
    fun productionCaptainSupportService(persistence: `in`.mypetnew.delivery.domain.CaptainSupportPersistence): `in`.mypetnew.delivery.domain.CaptainSupportService =
        `in`.mypetnew.delivery.domain.CaptainSupportService(persistence)
}
