package `in`.mypetnew.application

import `in`.mypetnew.appointment.domain.AppointmentPersistence
import `in`.mypetnew.appointment.domain.AppointmentService
import `in`.mypetnew.appointment.domain.InMemoryAppointmentPersistence
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.commerce.domain.CartService
import `in`.mypetnew.commerce.domain.InMemoryQueryableOrderPersistence
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.customer.domain.CustomerDataPersistence
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.customer.domain.CustomerFavouritePersistence
import `in`.mypetnew.customer.domain.CustomerFavouriteService
import `in`.mypetnew.customer.domain.InMemoryCustomerDataPersistence
import `in`.mypetnew.customer.domain.InMemoryCustomerFavouritePersistence
import `in`.mypetnew.delivery.domain.DeliveryPricingPolicy
import `in`.mypetnew.delivery.domain.DispatchService
import `in`.mypetnew.delivery.domain.InMemoryCaptainGeoIndex
import `in`.mypetnew.delivery.domain.InMemoryDispatchPersistence
import `in`.mypetnew.engagement.domain.DeviceRegistrationPersistence
import `in`.mypetnew.engagement.domain.DeviceRegistrationService
import `in`.mypetnew.engagement.domain.InMemoryNotificationRepository
import `in`.mypetnew.engagement.domain.NotificationRepository
import `in`.mypetnew.engagement.domain.NotificationService
import `in`.mypetnew.engagement.domain.SafeRoute
import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.InMemorySessionStore
import `in`.mypetnew.identity.domain.OtpProvider
import `in`.mypetnew.identity.domain.OtpService
import `in`.mypetnew.identity.domain.SessionStore
import `in`.mypetnew.identity.infrastructure.ConsoleOtpProvider
import `in`.mypetnew.identity.infrastructure.StagingUnavailableOtpProvider
import `in`.mypetnew.loyalty.domain.LoyaltyService
import `in`.mypetnew.payment.domain.FakePaymentGateway
import `in`.mypetnew.payment.domain.InMemoryPaymentPersistence
import `in`.mypetnew.payment.domain.PaymentService
import `in`.mypetnew.pos.domain.CustomerAssociationChallengeService
import `in`.mypetnew.pos.domain.PosService
import `in`.mypetnew.privacy.domain.InMemoryPrivacyRepository
import `in`.mypetnew.privacy.domain.PrivacyRepository
import `in`.mypetnew.privacy.domain.PrivacyService
import `in`.mypetnew.provider.domain.DocumentStore
import `in`.mypetnew.provider.domain.InMemoryPrivateDocumentStore
import `in`.mypetnew.provider.domain.ProviderService
import org.springframework.beans.factory.ObjectProvider
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile

@Configuration
class DomainConfiguration {
    @Bean
    @Profile("!staging & !device")
    fun otpProvider(): OtpProvider = InMemoryOtpProvider()

    @Bean
    @Profile("device")
    fun deviceOtpProvider(): OtpProvider = ConsoleOtpProvider()

    @Bean
    @Profile("staging")
    fun stagingOtpProvider(): OtpProvider = StagingUnavailableOtpProvider()

    @Bean fun otpService(provider: OtpProvider) = OtpService(provider)

    @Bean
    @Profile("test")
    fun testSessionStore(): SessionStore = InMemorySessionStore(acceptUnknownAccessSessions = true)

    @Bean
    @Profile("development")
    fun developmentSessionStore(): SessionStore = InMemorySessionStore()

    @Bean
    @Profile("test", "development")
    fun documentStore(): DocumentStore = InMemoryPrivateDocumentStore()

    @Bean
    @Profile("test", "development")
    fun notificationRepository(): NotificationRepository = InMemoryNotificationRepository()

    @Bean @Profile("test", "development") fun providerService() = ProviderService()
    @Bean @Profile("test", "development") fun catalogService() = CatalogService()
    @Bean @Profile("test", "development") fun inventoryService() = InventoryService()
    @Bean @Profile("test", "development") fun cartService() = CartService()
    @Bean @Profile("test", "development") fun quoteService() = QuoteService()
    @Bean @Profile("test", "development") fun inMemoryOrderPersistence() = InMemoryQueryableOrderPersistence()

    @Bean
    @Profile("test", "development")
    fun orderService(inventory: InventoryService, persistence: InMemoryQueryableOrderPersistence) =
        OrderService(inventory, persistence)

    @Bean
    @Profile("test", "development")
    fun inMemoryPaymentPersistence(orders: OrderService) = InMemoryPaymentPersistence(orders)

    @Bean @Profile("test", "development") fun fakePaymentGateway() = FakePaymentGateway()

    @Bean
    @Profile("test", "development")
    fun paymentService(persistence: InMemoryPaymentPersistence, gateway: FakePaymentGateway) =
        PaymentService(persistence, gateway)

    @Bean @Profile("test", "development") fun loyaltyService() = LoyaltyService()

    @Bean
    @Profile("test", "development")
    fun customerAssociationChallengeService() = CustomerAssociationChallengeService()

    @Bean
    @Profile("test", "development")
    fun posService(
        inventory: InventoryService,
        loyalty: LoyaltyService,
        customerAssociations: CustomerAssociationChallengeService,
    ) = PosService(inventory, loyalty, customerAssociations = customerAssociations)

    @Bean
    @Profile("test", "development")
    fun customerDataPersistence(): CustomerDataPersistence = InMemoryCustomerDataPersistence()

    @Bean
    @Profile("test", "development")
    fun customerDataService(persistence: CustomerDataPersistence) = CustomerDataService(persistence)

    @Bean
    @Profile("test", "development")
    fun appointmentPersistence(): AppointmentPersistence = InMemoryAppointmentPersistence()

    @Bean
    @Profile("test", "development")
    fun appointmentService(
        persistence: AppointmentPersistence,
        providers: ProviderService,
        customerData: CustomerDataService,
    ) = AppointmentService(persistence, providers, customerData)

    @Bean
    @Profile("test", "development")
    fun customerFavouritePersistence(): CustomerFavouritePersistence = InMemoryCustomerFavouritePersistence()

    @Bean
    @Profile("test", "development")
    fun customerFavouriteService(
        persistence: CustomerFavouritePersistence,
        catalog: CatalogService,
        providers: ProviderService,
    ) = CustomerFavouriteService(persistence, catalog, providers)

    @Bean
    fun deliveryPricingPolicy(
        @Value("\${mypet.delivery.base-fee-paise:0}") baseFeePaise: Long,
        @Value("\${mypet.delivery.eta-minutes:45}") etaMinutes: Int,
    ) = DeliveryPricingPolicy(baseFeePaise, etaMinutes)

    @Bean
    @Profile("test", "development")
    fun inMemoryDispatchPersistence() = InMemoryDispatchPersistence()

    @Bean
    @Profile("test", "development")
    fun inMemoryCaptainGeoIndex() = InMemoryCaptainGeoIndex()

    @Bean
    @Profile("test", "development")
    fun dispatchService(
        persistence: InMemoryDispatchPersistence,
        geoIndex: InMemoryCaptainGeoIndex,
        orders: OrderService,
        notifications: NotificationService,
    ) = DispatchService(
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
    fun deviceRegistrationService(persistence: ObjectProvider<DeviceRegistrationPersistence>) =
        DeviceRegistrationService(persistence.getIfAvailable())

    @Bean
    fun notificationService(repository: NotificationRepository) = NotificationService(repository)

    @Bean
    @Profile("test", "development")
    fun privacyRepository(): PrivacyRepository = InMemoryPrivacyRepository()

    @Bean
    @Profile("test", "development")
    fun inMemoryCaptainOnboardingPersistence(): `in`.mypetnew.delivery.domain.CaptainOnboardingPersistence =
        `in`.mypetnew.delivery.domain.InMemoryCaptainOnboardingPersistence()

    @Bean
    @Profile("test", "development")
    fun captainOnboardingService(persistence: `in`.mypetnew.delivery.domain.CaptainOnboardingPersistence) =
        `in`.mypetnew.delivery.domain.CaptainOnboardingService(persistence)

    @Bean
    @Profile("test", "development")
    fun inMemoryCaptainEarningsPersistence(dispatch: `in`.mypetnew.delivery.domain.InMemoryDispatchPersistence): `in`.mypetnew.delivery.domain.CaptainEarningsPersistence =
        `in`.mypetnew.delivery.domain.InMemoryCaptainEarningsPersistence(dispatch)

    @Bean
    @Profile("test", "development")
    fun captainEarningsService(persistence: `in`.mypetnew.delivery.domain.CaptainEarningsPersistence) =
        `in`.mypetnew.delivery.domain.CaptainEarningsService(persistence)

    @Bean
    @Profile("test", "development")
    fun inMemoryCaptainSupportPersistence(dispatch: `in`.mypetnew.delivery.domain.InMemoryDispatchPersistence): `in`.mypetnew.delivery.domain.CaptainSupportPersistence =
        `in`.mypetnew.delivery.domain.InMemoryCaptainSupportPersistence(dispatch)

    @Bean
    @Profile("test", "development")
    fun captainSupportService(persistence: `in`.mypetnew.delivery.domain.CaptainSupportPersistence) =
        `in`.mypetnew.delivery.domain.CaptainSupportService(persistence)

    @Bean
    fun privacyService(
        repository: PrivacyRepository,
        sessions: SessionStore,
        devices: DeviceRegistrationService,
    ) = PrivacyService(repository, sessions, devices)
}
