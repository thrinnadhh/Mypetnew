package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.BarcodeNormalizer
import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.Listing
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

data class OfflineCatalogDraftRequest(
    val tempListingId: String,
    val outletId: UUID,
    val barcodeType: BarcodeType,
    val barcode: String,
    val name: String,
    val kind: ListingKind,
    val mrpPaise: Long,
    val sellingPricePaise: Long,
    val category: String,
    val brand: String? = null,
    val description: String? = null,
    val petType: String? = null,
    val lifeStage: String? = null,
    val packLabel: String? = null,
    val sku: String? = null,
)

data class OfflineCatalogDraftReceipt(
    val status: String = "ACCEPTED",
    val receiptId: String,
    val commandType: String = "CATALOG_CREATE",
    val entityId: UUID,
    val resultingVersion: Long,
    val serverTimestamp: String,
    val outcome: String,
    val tempListingId: String,
    val canonicalListingId: UUID,
    val canonicalListing: Listing,
)

@RestController
@RequestMapping("/api/v1/merchant/sync/catalog/drafts")
class M7OfflineCatalogDraftController(
    private val providers: ProviderService,
    private val catalog: CatalogService,
    private val jdbc: JdbcTemplate,
) {
    @PostMapping("/reconcile")
    fun reconcile(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestHeader("X-MyPet-Command-Type") commandType: String,
        @RequestHeader("X-MyPet-Payload-Schema-Version") schemaVersion: String,
        @RequestBody request: OfflineCatalogDraftRequest,
    ): ResponseEntity<OfflineCatalogDraftReceipt> {
        requireSchema(commandType, schemaVersion)
        val cleaned = clean(request)
        requireKeyBinding(idempotencyKey, cleaned.tempListingId)
        val principal = authentication.domainPrincipal()
        val outlet = providers.requireActiveOutlet(principal, cleaned.outletId, MerchantPermission.CATALOG_WRITE)
        val normalizedBarcode = BarcodeNormalizer.normalize(cleaned.barcodeType, cleaned.barcode)
        val existingBefore = findByBarcode(outlet.organizationId, outlet.id, cleaned.barcodeType, normalizedBarcode)

        return try {
            val listing = catalog.createListing(
                createCommand(outlet.organizationId, outlet.capabilities, cleaned),
                idempotencyKey,
                principal.actorId,
            )
            val createKey = jdbc.queryForObject(
                "SELECT create_idempotency_key FROM mypet.catalog_listing WHERE id = ?",
                String::class.java,
                listing.id,
            )
            val outcome = if (createKey == idempotencyKey) "CREATED" else "EXISTING_LISTING"
            ResponseEntity.ok(receipt(cleaned.tempListingId, outcome, listing))
        } catch (error: DomainException) {
            if (error.code != "CATALOG_DUPLICATE") throw error
            val canonical = findByBarcode(outlet.organizationId, outlet.id, cleaned.barcodeType, normalizedBarcode)
                ?: existingBefore
                ?: throw error
            ResponseEntity.status(HttpStatus.CONFLICT)
                .body(receipt(cleaned.tempListingId, "CONFLICT", canonical))
        }
    }

    @PostMapping("/resolve")
    fun resolve(
        authentication: Authentication,
        @RequestHeader("X-MyPet-Command-Type") commandType: String,
        @RequestHeader("X-MyPet-Payload-Schema-Version") schemaVersion: String,
        @RequestBody request: ResolveReceiptRequest,
    ): OfflineCatalogDraftReceipt {
        requireSchema(commandType, schemaVersion)
        if (request.commandType != "CATALOG_CREATE" || request.payloadSchemaVersion != 1) {
            throw DomainException("COMMAND_SCHEMA_UNSUPPORTED", "Unsupported catalog-create receipt schema")
        }

        val principal = authentication.domainPrincipal()
        val cleaned = clean(payloadRequest(request.payload))
        requireKeyBinding(request.idempotencyKey, cleaned.tempListingId)

        val row = jdbc.query(
            """
            SELECT l.id, l.organization_id, l.outlet_id, l.create_request_fingerprint,
                   l.created_at, h.actor_id
            FROM mypet.catalog_listing l
            LEFT JOIN mypet.catalog_listing_history h
              ON h.listing_id = l.id AND h.listing_version = 0 AND h.mutation_type = 'CREATE'
            WHERE l.outlet_id = ? AND l.create_idempotency_key = ?
            """.trimIndent(),
            { rs, _ -> HistoricalCreate(
                id = rs.getObject("id", UUID::class.java),
                organizationId = rs.getObject("organization_id", UUID::class.java),
                outletId = rs.getObject("outlet_id", UUID::class.java),
                fingerprint = rs.getString("create_request_fingerprint"),
                createdAt = rs.getTimestamp("created_at").toInstant(),
                actorId = rs.getObject("actor_id", UUID::class.java),
            ) },
            cleaned.outletId,
            request.idempotencyKey,
        ).singleOrNull() ?: throw DomainException("RESOURCE_NOT_FOUND", "No receipt found for idempotency key")

        if (row.actorId == null || row.actorId != principal.actorId) {
            throw DomainException("PERMISSION_DENIED", "Historical actor mismatch")
        }
        if (row.outletId != cleaned.outletId) {
            throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "Receipt outlet does not match request")
        }

        val normalized = BarcodeNormalizer.normalize(cleaned.barcodeType, cleaned.barcode)
        val commerceMode = if (cleaned.kind == ListingKind.MEDICINE) CommerceMode.VIEW_ONLY else CommerceMode.COMMERCE
        val expected = createFingerprint(row.organizationId, cleaned, normalized, commerceMode)
        if (!MessageDigest.isEqual(row.fingerprint.toByteArray(Charsets.UTF_8), expected.toByteArray(Charsets.UTF_8))) {
            throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "Payload does not match historical receipt")
        }

        val listing = catalog.getManagedListing(row.organizationId, row.outletId, row.id)
        return receipt(cleaned.tempListingId, "CREATED", listing, row.createdAt)
    }

    private fun requireSchema(commandType: String, schemaVersion: String) {
        if (commandType != "CATALOG_CREATE" || schemaVersion != "1") {
            throw DomainException("COMMAND_SCHEMA_UNSUPPORTED", "Endpoint accepts CATALOG_CREATE schema version 1")
        }
    }

    private fun requireKeyBinding(idempotencyKey: String, tempListingId: String) {
        val localId = parseTempListingId(tempListingId)
        val expected = "catalog-create:$localId"
        if (!MessageDigest.isEqual(
                idempotencyKey.toByteArray(StandardCharsets.UTF_8),
                expected.toByteArray(StandardCharsets.UTF_8),
            )
        ) {
            throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "Idempotency key is not bound to temporary listing identity")
        }
    }

    private fun parseTempListingId(value: String): UUID {
        val trimmed = value.trim()
        if (!trimmed.startsWith("local_")) {
            throw DomainException("VALIDATION_ERROR", "Invalid temporary listing identity")
        }
        return runCatching { UUID.fromString(trimmed.removePrefix("local_")) }
            .getOrElse { throw DomainException("VALIDATION_ERROR", "Invalid temporary listing identity") }
    }

    private fun parseUuid(payload: Map<String, Any?>, field: String): UUID {
        val raw = payload[field] as? String
            ?: throw DomainException("VALIDATION_ERROR", "Missing $field")
        return runCatching { UUID.fromString(raw) }
            .getOrElse { throw DomainException("VALIDATION_ERROR", "Invalid $field") }
    }

    private inline fun <reified E : Enum<E>> parseEnum(payload: Map<String, Any?>, field: String): E {
        val raw = payload[field] as? String
            ?: throw DomainException("VALIDATION_ERROR", "Missing $field")
        return enumValues<E>().firstOrNull { it.name == raw }
            ?: throw DomainException("VALIDATION_ERROR", "Invalid $field")
    }

    private fun createCommand(
        organizationId: UUID,
        capabilities: Set<ProviderCapability>,
        request: OfflineCatalogDraftRequest,
    ) = CreateListingCommand(
        organizationId = organizationId,
        outletId = request.outletId,
        barcodeType = request.barcodeType,
        barcode = request.barcode,
        name = request.name,
        kind = request.kind,
        mrpPaise = request.mrpPaise,
        sellingPricePaise = request.sellingPricePaise,
        capabilities = capabilities,
        category = request.category,
        brand = request.brand,
        description = request.description,
        petType = request.petType,
        lifeStage = request.lifeStage,
        packLabel = request.packLabel,
        sku = request.sku,
        imageUrls = emptyList(),
    )

    private fun clean(request: OfflineCatalogDraftRequest): OfflineCatalogDraftRequest {
        val localId = parseTempListingId(request.tempListingId)
        return request.copy(
            tempListingId = "local_$localId",
            name = request.name.trim(),
            category = request.category.trim().lowercase(),
            brand = optional(request.brand),
            description = optional(request.description),
            petType = optional(request.petType),
            lifeStage = optional(request.lifeStage),
            packLabel = optional(request.packLabel),
            sku = optional(request.sku),
        )
    }

    private fun optional(value: String?): String? = value?.trim()?.takeIf(String::isNotEmpty)

    private fun findByBarcode(
        organizationId: UUID,
        outletId: UUID,
        barcodeType: BarcodeType,
        normalizedBarcode: String,
    ): Listing? {
        val id = jdbc.query(
            """
            SELECT id FROM mypet.catalog_listing
            WHERE organization_id = ? AND outlet_id = ? AND barcode_type = ? AND normalized_barcode = ?
            """.trimIndent(),
            { rs, _ -> rs.getObject("id", UUID::class.java) },
            organizationId,
            outletId,
            barcodeType.name,
            normalizedBarcode,
        ).singleOrNull() ?: return null
        return catalog.getManagedListing(organizationId, outletId, id)
    }

    private fun receipt(
        tempListingId: String,
        outcome: String,
        listing: Listing,
        timestamp: Instant = listing.createdAt,
    ) = OfflineCatalogDraftReceipt(
        receiptId = listing.id.toString(),
        entityId = listing.id,
        resultingVersion = listing.version,
        serverTimestamp = timestamp.toString(),
        outcome = outcome,
        tempListingId = tempListingId,
        canonicalListingId = listing.id,
        canonicalListing = listing,
    )

    private fun payloadRequest(payload: Map<String, Any?>) = OfflineCatalogDraftRequest(
        tempListingId = payload["tempListingId"] as? String
            ?: throw DomainException("VALIDATION_ERROR", "Missing tempListingId"),
        outletId = parseUuid(payload, "outletId"),
        barcodeType = parseEnum(payload, "barcodeType"),
        barcode = payload["barcode"] as? String ?: throw DomainException("VALIDATION_ERROR", "Missing barcode"),
        name = payload["name"] as? String ?: throw DomainException("VALIDATION_ERROR", "Missing name"),
        kind = parseEnum(payload, "kind"),
        mrpPaise = (payload["mrpPaise"] as? Number)?.toLong()
            ?: throw DomainException("VALIDATION_ERROR", "Missing mrpPaise"),
        sellingPricePaise = (payload["sellingPricePaise"] as? Number)?.toLong()
            ?: throw DomainException("VALIDATION_ERROR", "Missing sellingPricePaise"),
        category = payload["category"] as? String ?: throw DomainException("VALIDATION_ERROR", "Missing category"),
        brand = payload["brand"] as? String,
        description = payload["description"] as? String,
        petType = payload["petType"] as? String,
        lifeStage = payload["lifeStage"] as? String,
        packLabel = payload["packLabel"] as? String,
        sku = payload["sku"] as? String,
    )

    private fun createFingerprint(
        organizationId: UUID,
        request: OfflineCatalogDraftRequest,
        normalizedBarcode: String,
        commerceMode: CommerceMode,
    ): String {
        val out = ByteArrayOutputStream()
        val dos = DataOutputStream(out)
        fun writeString(value: String?) {
            if (value == null) dos.writeInt(-1)
            else {
                val bytes = value.toByteArray(StandardCharsets.UTF_8)
                dos.writeInt(bytes.size)
                dos.write(bytes)
            }
        }
        writeString(organizationId.toString())
        writeString(request.outletId.toString())
        writeString(request.barcodeType.name)
        writeString(normalizedBarcode)
        writeString(request.name)
        writeString(request.kind.name)
        writeString(commerceMode.name)
        dos.writeLong(request.mrpPaise)
        dos.writeLong(request.sellingPricePaise)
        writeString(request.category)
        writeString(request.brand)
        writeString(request.description)
        writeString(request.petType)
        writeString(request.lifeStage)
        writeString(request.packLabel)
        writeString(request.sku)
        dos.writeInt(0)
        dos.flush()
        return MessageDigest.getInstance("SHA-256").digest(out.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    private data class HistoricalCreate(
        val id: UUID,
        val organizationId: UUID,
        val outletId: UUID,
        val fingerprint: String,
        val createdAt: Instant,
        val actorId: UUID?,
    )
}
