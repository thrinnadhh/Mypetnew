package `in`.mypetnew.common

import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.idempotency.IdempotencyStore
import `in`.mypetnew.common.money.Money
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.util.UUID

class CommonKernelContractTest {
    @Test
    fun `money is integer paise in INR and rejects negative values`() {
        assertEquals(1_000, Money.inr(1_000).paise)
        assertEquals("INR", Money.inr(1_000).currency.code)
        assertThrows(IllegalArgumentException::class.java) { Money.inr(-1) }
    }

    @Test
    fun `idempotency replay returns first result and mismatch fails`() {
        val store = IdempotencyStore<String>()

        val first = store.execute("checkout", "key-1", "fingerprint-a") { "order-1" }
        val replay = store.execute("checkout", "key-1", "fingerprint-a") { "order-2" }

        assertEquals("order-1", first)
        assertEquals(first, replay)
        val error = assertThrows(DomainException::class.java) {
            store.execute("checkout", "key-1", "fingerprint-b") { "order-3" }
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", error.code)
    }

    @Test
    fun `roles and admin permissions fail closed`() {
        val admin = Principal(UUID.randomUUID(), Role.ADMIN, permissions = setOf(AdminPermission.AUDIT_VIEW))
        val customer = Principal(UUID.randomUUID(), Role.CUSTOMER)

        assertThrows(DomainException::class.java) { Authorizer.requireRole(customer, Role.MERCHANT) }
        assertThrows(DomainException::class.java) {
            Authorizer.requireAdminPermission(admin, AdminPermission.PROVIDER_REVIEW)
        }
    }
}

