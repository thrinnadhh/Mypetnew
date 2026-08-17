package `in`.mypetnew.application

import org.junit.jupiter.api.Assertions.assertDoesNotThrow
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class StagingRuntimeConfigurationTest {
    @Test
    fun `isolated staging runtime accepts persistent sandbox configuration`() {
        assertDoesNotThrow {
            validateStagingRuntime(validSettings())
        }
    }

    @Test
    fun `staging can boot before Cashfree certification while retaining sandbox endpoint`() {
        assertDoesNotThrow {
            validateStagingRuntime(
                validSettings().copy(
                    cashfreeEnabled = false,
                    cashfreeReturnUrl = "",
                    cashfreeNotifyUrl = "",
                ),
            )
        }
    }

    @Test
    fun `staging cannot be combined with local or test profiles`() {
        listOf("development", "test", "device").forEach { incompatible ->
            assertThrows(IllegalArgumentException::class.java) {
                validateStagingRuntime(validSettings().copy(activeProfiles = setOf("staging", incompatible)))
            }
        }
    }

    @Test
    fun `staging refuses production Cashfree endpoint even before enablement`() {
        assertThrows(IllegalArgumentException::class.java) {
            validateStagingRuntime(
                validSettings().copy(
                    cashfreeEnabled = false,
                    cashfreeBaseUrl = "https://api.cashfree.com/pg",
                    cashfreeReturnUrl = "",
                    cashfreeNotifyUrl = "",
                ),
            )
        }
    }

    @Test
    fun `enabled Cashfree refuses placeholder and non-public callback hosts`() {
        val invalid = listOf(
            validSettings().copy(cashfreeReturnUrl = "https://staging.example.com/payments/cashfree/return"),
            validSettings().copy(cashfreeNotifyUrl = "http://127.0.0.1:8080/api/v1/webhooks/cashfree/payments"),
            validSettings().copy(cashfreeNotifyUrl = "https://api-staging.mypet.test/wrong-webhook"),
        )

        invalid.forEach { settings ->
            assertThrows(IllegalArgumentException::class.java) {
                validateStagingRuntime(settings)
            }
        }
    }

    @Test
    fun `staging refuses placeholder persistent infrastructure`() {
        val invalid = listOf(
            validSettings().copy(datasourceUrl = "jdbc:postgresql://db.example.supabase.co:5432/postgres"),
            validSettings().copy(supabaseUrl = "https://replace.supabase.co"),
        )

        invalid.forEach { settings ->
            assertThrows(IllegalArgumentException::class.java) {
                validateStagingRuntime(settings)
            }
        }
    }

    private fun validSettings() = StagingRuntimeSettings(
        activeProfiles = setOf("staging"),
        datasourceUrl = "jdbc:postgresql://db.petshop.supabase.co:5432/postgres?sslmode=require",
        supabaseUrl = "https://petshop.supabase.co",
        runtimeEnvironment = "staging",
        cashfreeEnabled = true,
        cashfreeBaseUrl = "https://sandbox.cashfree.com/pg",
        cashfreeReturnUrl = "https://staging.mypet.test/payments/cashfree/return",
        cashfreeNotifyUrl = "https://api-staging.mypet.test/api/v1/webhooks/cashfree/payments",
    )
}
