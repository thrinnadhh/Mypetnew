package `in`.mypetnew.catalog.domain

import java.time.Instant
import java.util.UUID

enum class SyncEntityType {
    CATALOG_ITEM,
    CATALOG_BARCODE,
    INVENTORY_BALANCE,
}

data class MerchantSyncChange(
    val sequenceNumber: Long,
    val organizationId: UUID,
    val outletId: UUID,
    val entityType: SyncEntityType,
    val entityId: UUID,
    val entityVersion: Long,
    val isTombstone: Boolean,
    val payload: String,
    val schemaVersion: Int,
    val createdAt: Instant,
)

data class MerchantSyncChangePage(
    val changes: List<MerchantSyncChange>,
    val nextCursor: String?,
    val hasMore: Boolean,
    val currentHighWaterCursor: String,
    val serverTime: Instant,
)

data class MerchantSyncBootstrapResponse(
    val highWaterCursor: String,
    val catalogItems: List<Listing>,
    val inventoryBalances: List<InventoryBalance>,
    val nextCursor: String? = null,
    val hasMore: Boolean = false,
    val serverTime: Instant = Instant.now(),
)

interface MerchantSyncPublisher {
    fun publishCatalogItemChange(
        listing: Listing,
        isTombstone: Boolean = false,
    )

    fun publishBarcodeChange(
        organizationId: UUID,
        outletId: UUID,
        listingId: UUID,
        barcodeType: BarcodeType,
        normalizedBarcode: String,
        isPrimary: Boolean = true,
        isTombstone: Boolean = false,
        updatedAt: Instant = Instant.now(),
    )

    fun publishInventoryBalanceChange(
        balance: InventoryBalance,
        isTombstone: Boolean = false,
    )
}

interface MerchantSyncFeedService {
    fun fetchChanges(
        organizationId: UUID,
        outletId: UUID,
        cursor: String?,
        limit: Int,
    ): MerchantSyncChangePage

    fun fetchBootstrap(
        organizationId: UUID,
        outletId: UUID,
        cursor: String? = null,
        limit: Int = 100,
    ): MerchantSyncBootstrapResponse

    fun currentHighWaterCursor(
        organizationId: UUID,
        outletId: UUID,
    ): String
}
