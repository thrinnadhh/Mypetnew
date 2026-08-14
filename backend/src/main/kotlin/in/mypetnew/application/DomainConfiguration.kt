package `in`.mypetnew.application

import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.commerce.domain.CartService
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.engagement.domain.DeviceRegistrationService
import `in`.mypetnew.engagement.domain.DeviceRegistrationPersistence
import `in`.mypetnew.engagement.domain.NotificationService
import `in`.mypetnew.engagement.domain.NotificationRepository
import `in`.mypetnew.engagement.domain.InMemoryNotificationRepository
import `in`.mypetnew.loyalty.domain.LoyaltyService
import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.OtpProvider
import `in`.mypetnew.identity.domain.OtpService
import `in`.mypetnew.identity.domain.InMemorySessionStore
import `in`.mypetnew.identity.domain.SessionStore
import `in`.mypetnew.identity.infrastructure.ConsoleOtpProvider
import `in`.mypetnew.pos.domain.CustomerAssociationChallengeService
import `in`.mypetnew.pos.domain.PosService
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.DocumentStore
import `in`.mypetnew.provider.domain.InMemoryPrivateDocumentStore
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.beans.factory.ObjectProvider

@Configuration
class DomainConfiguration {
    @Bean
    @Profile("test", "development")
    fun otpProvider(): OtpProvider = InMemoryOtpProvider()

    @Bean
    @Profile("device")
    fun deviceOtpProvider(): OtpProvider = ConsoleOtpProvider()

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
    @Bean @Profile("test", "development") fun orderService(inventory: InventoryService) = OrderService(inventory)
    @Bean @Profile("test", "development") fun loyaltyService() = LoyaltyService()
    @Bean @Profile("test", "development")
    fun posService(inventory: InventoryService, loyalty: LoyaltyService) = PosService(inventory, loyalty)

    @Bean @Profile("test", "development")
    fun customerAssociationChallengeService() = CustomerAssociationChallengeService()
    @Bean
    fun deviceRegistrationService(persistence: ObjectProvider<DeviceRegistrationPersistence>) =
        DeviceRegistrationService(persistence.getIfAvailable())
    @Bean
    fun notificationService(repository: NotificationRepository) = NotificationService(repository)
}
