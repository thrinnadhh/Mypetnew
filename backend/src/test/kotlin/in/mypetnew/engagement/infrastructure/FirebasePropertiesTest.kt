package `in`.mypetnew.engagement.infrastructure

import org.junit.jupiter.api.Assertions.assertDoesNotThrow
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class FirebasePropertiesTest {
    @Test
    fun `staging Firebase properties validate without loading application credentials`() {
        assertDoesNotThrow {
            FirebaseProperties(projectId = "mypetnew-staging", environment = "staging")
        }
    }

    @Test
    fun `unsupported Firebase environment is rejected`() {
        assertThrows(IllegalArgumentException::class.java) {
            FirebaseProperties(projectId = "mypetnew-staging", environment = "sandbox")
        }
    }
}
