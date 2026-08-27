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
        assertTrue(controller.contains("principal.actorId"))
        assertTrue(!controller.contains("@RequestParam organizationId"))
    }

    @Test
    fun `media upload requires durable idempotency current replay authority and payload binding`() {
        val controller = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/application/web/MerchantCatalogMediaController.kt"),
        )
        val service = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/catalog/domain/CatalogMediaService.kt"),
        )
        val persistence = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/catalog/infrastructure/JdbcCatalogMediaPersistence.kt"),
        )
        val historical = Files.readString(
            Path.of("src/main/resources/db/migration/V27__catalog_media_lifecycle.sql"),
        )
        val hardening = Files.readString(
            Path.of("src/main/resources/db/migration/V28__catalog_media_finalization_hardening.sql"),
        )
        assertTrue(controller.contains("@RequestHeader(\"Idempotency-Key\")"))
        assertTrue(service.contains("findAuthorizedReplay"))
        assertTrue(persistence.contains("requireCurrentAuthority"))
        assertTrue(persistence.contains("FOR SHARE OF s, a, o"))
        assertTrue(persistence.contains("requestFingerprint"))
        assertTrue(persistence.contains("idempotencyKey"))
        assertTrue(persistence.contains("replayed = true"))
        assertTrue(historical.contains("uq_catalog_media_idempotency"))
        assertTrue(historical.contains("request_fingerprint"))
        assertTrue(hardening.contains("actor_id"))
        assertTrue(hardening.contains("ck_catalog_media_canonical_object_key"))
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
    fun `database finalization binds media to tenant listing five image quota and durable cleanup`() {
        val persistence = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/catalog/infrastructure/JdbcCatalogMediaPersistence.kt"),
        )
        val migration = Files.readString(
            Path.of("src/main/resources/db/migration/V28__catalog_media_finalization_hardening.sql"),
        )
        val worker = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/catalog/infrastructure/CatalogMediaCleanupWorker.kt"),
        )
        listOf("organization_id = ?", "outlet_id = ?", "listing_id", "FOR UPDATE")
            .forEach { required -> assertTrue(persistence.contains(required), "Missing media ownership guard: $required") }
        assertTrue(persistence.contains("CatalogMediaService.MAX_MEDIA_PER_LISTING"))
        assertTrue(persistence.contains("version = version + 1"))
        assertTrue(persistence.contains("catalog_media_cleanup"))
        assertTrue(migration.contains("CREATE TABLE mypet.catalog_media_cleanup"))
        assertTrue(worker.contains("retryDueCleanup"))
        assertTrue(worker.contains("DELETE_FAILED"))
    }

    @Test
    fun `bounded upload scans the whole payload and never accepts a client object key`() {
        val service = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/catalog/domain/CatalogMediaService.kt"),
        )
        val controller = Files.readString(
            Path.of("src/main/kotlin/in/mypetnew/application/web/MerchantCatalogMediaController.kt"),
        )
        assertTrue(service.contains("String(bytes, StandardCharsets.ISO_8859_1)"))
        assertTrue(!service.contains("SCRIPT_PROBE_BYTES"))
        assertTrue(service.contains("catalog/$organizationId/$outletId/$listingId/$mediaId"))
        assertTrue(!controller.contains("objectKey:"))
        assertTrue(!controller.contains("publicUrl:"))
    }
}
