package `in`.mypetnew.application

import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.commerce.domain.CartService
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.engagement.domain.DeviceRegistrationService
import `in`.mypetnew.engagement.domain.NotificationService
import `in`.mypetnew.loyalty.domain.LoyaltyService
import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.OtpProvider
import `in`.mypetnew.identity.domain.OtpService
import `in`.mypetnew.pos.domain.CustomerAssociationChallengeService
import `in`.mypetnew.pos.domain.PosService
import `in`.mypetnew.provider.domain.ProviderService
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile

@Configuration
class DomainConfiguration {
    @Bean
    @Profile("test", "development")
    fun otpProvider(): OtpProvider = InMemoryOtpProvider()

    @Bean fun otpService(provider: OtpProvider) = OtpService(provider)
    @Bean fun providerService() = ProviderService()
    @Bean fun catalogService() = CatalogService()
    @Bean fun inventoryService() = InventoryService()
    @Bean fun cartService() = CartService()
    @Bean fun quoteService() = QuoteService()
    @Bean fun orderService(inventory: InventoryService) = OrderService(inventory)
    @Bean fun loyaltyService() = LoyaltyService()
    @Bean fun posService(inventory: InventoryService, loyalty: LoyaltyService) = PosService(inventory, loyalty)
    @Bean fun customerAssociationChallengeService() = CustomerAssociationChallengeService()
    @Bean fun deviceRegistrationService() = DeviceRegistrationService()
    @Bean fun notificationService(devices: DeviceRegistrationService) = NotificationService(devices)
}
