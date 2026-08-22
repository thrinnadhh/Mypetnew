package `in`.mypetnew.merchantops

import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path

@MerchantOpsContract
class M3InventorySourceGuardContractTest {
    @Test
    fun `M3-INV-001 production stock writes stay behind canonical inventory persistence and ledger remains append only`() {
        val sourceRoot = Path.of("src/main/kotlin")
        val files = Files.walk(sourceRoot).use { paths ->
            paths.filter { Files.isRegularFile(it) && it.fileName.toString().endsWith(".kt") }.toList()
        }
        val violations = mutableListOf<String>()
        val balanceUpdate = Regex("UPDATE\\s+mypet\\.inventory_balance", RegexOption.IGNORE_CASE)
        val movementMutation = Regex(
            "(?:UPDATE\\s+mypet\\.inventory_movement|DELETE\\s+FROM\\s+mypet\\.inventory_movement)",
            RegexOption.IGNORE_CASE,
        )
        val directStockApis = listOf(
            Regex("\\bupdateStock\\s*\\("),
            Regex("\\bsetOnHand\\s*\\("),
            Regex("\\.stock\\s*="),
            Regex("\\binventoryBalance\\s*="),
        )

        files.forEach { path ->
            val text = Files.readString(path)
            if (balanceUpdate.containsMatchIn(text) && path.fileName.toString() != "JdbcInventoryPersistence.kt") {
                violations += "$path updates inventory_balance outside JdbcInventoryPersistence"
            }
            if (movementMutation.containsMatchIn(text)) {
                violations += "$path mutates inventory_movement instead of appending"
            }
            if (path.fileName.toString() != "InventoryService.kt" && directStockApis.any { it.containsMatchIn(text) }) {
                violations += "$path contains a direct mutable-stock API pattern"
            }
        }

        assertTrue(
            violations.isEmpty(),
            "M3 canonical stock authority violations:\n${violations.joinToString("\n")}",
        )
    }
}
