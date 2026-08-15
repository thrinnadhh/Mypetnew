package `in`.mypetnew.delivery.domain

import org.springframework.context.annotation.Profile
import org.springframework.stereotype.Component
import java.util.UUID

fun interface DeliveryDataEraser {
    fun eraseCustomerDeliveryIdentifiers(customerId: UUID)
}

@Component
@Profile("test", "development")
class InMemoryDeliveryDataEraser : DeliveryDataEraser {
    override fun eraseCustomerDeliveryIdentifiers(customerId: UUID) = Unit
}
