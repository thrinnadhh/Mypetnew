package `in`.mypetnew.merchantops

import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path

@MerchantOpsContract
class M4BarcodeResolutionSourceGuardContractTest {
    @Test
    fun `M4 barcode resolution remains outlet scoped and permission guarded`() {
        val controller = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/application/web/MerchantBarcodeResolutionController.kt"),
        )
        assertTrue(controller.contains("/api/v1/merchant/barcodes"))
        assertTrue(controller.contains("providers.requireActiveOutlet"))
        assertTrue(controller.contains("MerchantPermission.CATALOG_WRITE"))
        assertTrue(controller.contains("outlet.organizationId"))
        assertTrue(!controller.contains("@RequestParam organizationId"))
    }

    @Test
    fun `M4 production lookup keys barcode resolution by tenant outlet type and normalized value`() {
        val lookup = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/catalog/infrastructure/BarcodeResolutionLookups.kt"),
        )
        listOf("organization_id = ?", "outlet_id = ?", "barcode_type = ?", "normalized_barcode = ?")
            .forEach { required -> assertTrue(lookup.contains(required), "Missing scoped lookup predicate: $required") }
    }
}
