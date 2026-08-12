package `in`.mypetnew.catalog.infrastructure

import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogPersistence
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.Listing
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.common.error.DomainException
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.sql.ResultSet
import java.util.UUID

class JdbcCatalogPersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
) : CatalogPersistence {
    override fun create(
        command: CreateListingCommand,
        normalizedBarcode: String,
        commerceMode: CommerceMode,
        actionKey: String,
        requestFingerprint: String,
    ): Listing {
        try {
            return transactions.execute {
                replay(command.outletId, actionKey, requestFingerprint)?.let { return@execute it }
                findByBarcode(command, normalizedBarcode)?.let { return@execute it }
                val listing = Listing(
                    id = UUID.randomUUID(),
                    organizationId = command.organizationId,
                    outletId = command.outletId,
                    barcodeType = command.barcodeType,
                    normalizedBarcode = normalizedBarcode,
                    name = command.name.trim(),
                    kind = command.kind,
                    commerceMode = commerceMode,
                    mrpPaise = command.mrpPaise,
                    sellingPricePaise = command.sellingPricePaise,
                )
                jdbc.update(
                    """
                    INSERT INTO mypet.catalog_listing (
                        id, organization_id, outlet_id, barcode_type, normalized_barcode,
                        raw_barcode_audit, name, listing_kind, commerce_mode, mrp_paise,
                        selling_price_paise, active, version, create_idempotency_key,
                        create_request_fingerprint
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, 0, ?, ?)
                    """.trimIndent(),
                    listing.id,
                    listing.organizationId,
                    listing.outletId,
                    listing.barcodeType.name,
                    listing.normalizedBarcode,
                    command.barcode.take(128),
                    listing.name,
                    listing.kind.name,
                    listing.commerceMode.name,
                    listing.mrpPaise,
                    listing.sellingPricePaise,
                    actionKey,
                    requestFingerprint,
                )
                listing
            }
        } catch (duplicate: DuplicateKeyException) {
            replay(command.outletId, actionKey, requestFingerprint)?.let { return it }
            findByBarcode(command, normalizedBarcode)?.let { return it }
            throw DomainException("CATALOG_CONFLICT", "The listing changed concurrently; refresh and retry")
        }
    }

    override fun get(listingId: UUID): Listing? = jdbc.query(
        """
        SELECT id, organization_id, outlet_id, barcode_type, normalized_barcode,
               name, listing_kind, commerce_mode, mrp_paise, selling_price_paise
        FROM mypet.catalog_listing
        WHERE id = ? AND active = TRUE
        """.trimIndent(),
        { result, _ -> listing(result) },
        listingId,
    ).singleOrNull()

    override fun all(): List<Listing> = jdbc.query(
        """
        SELECT id, organization_id, outlet_id, barcode_type, normalized_barcode,
               name, listing_kind, commerce_mode, mrp_paise, selling_price_paise
        FROM mypet.catalog_listing
        WHERE active = TRUE
        ORDER BY id
        """.trimIndent(),
    ) { result, _ -> listing(result) }

    private fun replay(outletId: UUID, actionKey: String, requestFingerprint: String): Listing? {
        val stored = jdbc.query(
            """
            SELECT id, organization_id, outlet_id, barcode_type, normalized_barcode,
                   name, listing_kind, commerce_mode, mrp_paise, selling_price_paise,
                   create_request_fingerprint
            FROM mypet.catalog_listing
            WHERE outlet_id = ? AND create_idempotency_key = ?
            """.trimIndent(),
            { result, _ -> listing(result) to result.getString("create_request_fingerprint") },
            outletId,
            actionKey,
        ).singleOrNull() ?: return null
        if (stored.second != requestFingerprint) {
            throw DomainException(
                "IDEMPOTENCY_FINGERPRINT_MISMATCH",
                "The idempotency key was already used for another request",
            )
        }
        return stored.first
    }

    private fun findByBarcode(command: CreateListingCommand, normalizedBarcode: String): Listing? = jdbc.query(
        """
        SELECT id, organization_id, outlet_id, barcode_type, normalized_barcode,
               name, listing_kind, commerce_mode, mrp_paise, selling_price_paise
        FROM mypet.catalog_listing
        WHERE organization_id = ? AND outlet_id = ? AND barcode_type = ? AND normalized_barcode = ?
        """.trimIndent(),
        { result, _ -> listing(result) },
        command.organizationId,
        command.outletId,
        command.barcodeType.name,
        normalizedBarcode,
    ).singleOrNull()

    private fun listing(result: ResultSet): Listing = Listing(
        id = result.getObject("id", UUID::class.java),
        organizationId = result.getObject("organization_id", UUID::class.java),
        outletId = result.getObject("outlet_id", UUID::class.java),
        barcodeType = BarcodeType.valueOf(result.getString("barcode_type")),
        normalizedBarcode = result.getString("normalized_barcode"),
        name = result.getString("name"),
        kind = ListingKind.valueOf(result.getString("listing_kind")),
        commerceMode = CommerceMode.valueOf(result.getString("commerce_mode")),
        mrpPaise = result.getLong("mrp_paise"),
        sellingPricePaise = result.getLong("selling_price_paise"),
    )
}
