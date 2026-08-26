package `in`.mypetnew.merchantops

import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class M4CatalogMediaSourceGuardContractTest {
    @Test
    fun `media endpoint requires catalog write and server-owned tenant listing identity`() {
        val controller = source("src/main/kotlin/in/mypetnew/application/web/MerchantCatalogMediaController.kt")
        assertTrue(controller.contains("MerchantPermission.CATALOG_WRITE"))
        assertTrue(controller.contains("providers.requireActiveOutlet"))
        assertTrue(controller.contains("catalog.getManagedListing(outlet.organizationId, outlet.id, listingId)"))
        assertTrue(controller.contains("listing.status != ListingStatus.ACTIVE"))
        assertTrue(controller.contains("actorId = principal.actorId"))
        assertFalse(controller.contains("organizationId: UUID"))
        assertFalse(controller.contains("objectKey"))
        assertFalse(controller.contains("publicUrl"))
    }

    @Test
    fun `jdbc finalization locks listing current authority and quota before atomic write`() {
        val jdbc = source("src/main/kotlin/in/mypetnew/catalog/infrastructure/JdbcCatalogMediaPersistence.kt")
        assertTrue(jdbc.contains("FOR UPDATE"))
        assertTrue(jdbc.contains("FOR SHARE OF s, a, o"))
        assertTrue(jdbc.contains("s.permission IN ('OWNER', 'CATALOG_WRITE')"))
        assertTrue(jdbc.contains("AND active = TRUE AND version = ?"))
        assertTrue(jdbc.contains("catalog_listing_image"))
        assertTrue(jdbc.contains("CatalogMediaService.MAX_MEDIA_PER_LISTING"))
    }

    @Test
    fun `storage is catalog-specific and server credential is redacted`() {
        val store = source("src/main/kotlin/in/mypetnew/catalog/infrastructure/SupabaseCatalogMediaObjectStore.kt")
        val service = source("src/main/kotlin/in/mypetnew/catalog/domain/CatalogMediaService.kt")
        assertTrue(store.contains("mypet.supabase.catalog-media"))
        assertTrue(store.contains("serviceKey=[REDACTED]"))
        assertTrue(store.contains("x-upsert"))
        assertFalse(store.contains("private-bucket"))
        assertTrue(service.contains("catalog/$organizationId/$outletId/$listingId/$mediaId"))
    }

    @Test
    fun `database migration binds canonical object path and five image ceiling`() {
        val migration = source("src/main/resources/db/migration/V27__catalog_media_lifecycle.sql")
        assertTrue(migration.contains("position >= 0 AND position < 5"))
        assertTrue(migration.contains("size_bytes > 0 AND size_bytes <= 5242880"))
        assertTrue(migration.contains("object_key = 'catalog/' || organization_id::text"))
        assertTrue(migration.contains("actor_id UUID NOT NULL"))
    }

    private fun source(relative: String): String {
        val backend = Path.of(System.getProperty("user.dir")).toAbsolutePath()
        val path = if (backend.fileName.toString() == "backend") backend.resolve(relative) else backend.resolve("backend").resolve(relative)
        return Files.readString(path)
    }
}
