package `in`.mypetnew.merchantops

import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

@MerchantOpsContract
class M4CatalogMediaSourceGuardContractTest {
    @Test
    fun `managed media upload remains tenant outlet and catalog write guarded`() {
        val controller = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/application/web/MerchantCatalogMediaController.kt"),
        )
        assertTrue(controller.contains("/api/v1/merchant/listings/{listingId}/media"))
        assertTrue(controller.contains("providers.requireActiveOutlet"))
        assertTrue(controller.contains("MerchantPermission.CATALOG_WRITE"))
        assertTrue(controller.contains("catalog.getManagedListing"))
        assertTrue(controller.contains("outlet.organizationId"))
        assertTrue(!controller.contains("@RequestParam organizationId"))
    }

    @Test
    fun `media upload requires durable idempotency and payload binding`() {
        val controller = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/application/web/MerchantCatalogMediaController.kt"),
        )
        val persistence = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/catalog/infrastructure/JdbcCatalogMediaPersistence.kt"),
        )
        val migration = Files.readString(
            Path.of("src/main/resources/db/migration/V27__catalog_media_lifecycle.sql"),
        )
        assertTrue(controller.contains("@RequestHeader(\"Idempotency-Key\")"))
        assertTrue(persistence.contains("requestFingerprint"))
        assertTrue(persistence.contains("idempotencyKey"))
        assertTrue(persistence.contains("replayed = true"))
        assertTrue(migration.contains("uq_catalog_media_idempotency"))
        assertTrue(migration.contains("request_fingerprint"))
    }

    @Test
    fun `legacy arbitrary image urls are rejected at merchant request boundary`() {
        val guard = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/application/web/MerchantCatalogMediaRequestGuard.kt"),
        )
        assertTrue(guard.contains("CreateListingRequest"))
        assertTrue(guard.contains("!body.imageUrls.isNullOrEmpty()"))
        assertTrue(guard.contains("CATALOG_MEDIA_MANAGED_REQUIRED"))
    }

    @Test
    fun `catalog media uses an isolated public bucket instead of provider verification storage`() {
        val catalogStore = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/catalog/infrastructure/SupabaseCatalogMediaObjectStore.kt"),
        )
        val privateStore = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/provider/infrastructure/SupabasePrivateDocumentStore.kt"),
        )
        assertTrue(catalogStore.contains("mypet.supabase.catalog-media"))
        assertTrue(catalogStore.contains("/storage/v1/object/public/"))
        assertTrue(catalogStore.contains("catalog-media"))
        assertTrue(privateStore.contains("provider-verification/"))
        assertTrue(privateStore.contains("privateBucket"))
    }

    @Test
    fun `database finalization binds media to tenant listing and five image quota`() {
        val persistence = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/catalog/infrastructure/JdbcCatalogMediaPersistence.kt"),
        )
        listOf("organization_id = ?", "outlet_id = ?", "listing_id", "FOR UPDATE")
            .forEach { required -> assertTrue(persistence.contains(required), "Missing media ownership guard: $required") }
        assertTrue(persistence.contains("CatalogMediaService.MAX_MEDIA_PER_LISTING"))
        assertTrue(persistence.contains("version = version + 1"))
    }
}
