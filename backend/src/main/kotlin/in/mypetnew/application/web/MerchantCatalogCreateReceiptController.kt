package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.BarcodeNormalizer
import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderOutlet
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID

@RestController
@RequestMapping("/api/v1/merchant/sync/create-receipts")
class MerchantCatalogCreateReceiptController(
    private val providers: ProviderService,
    private val jdbc: JdbcTemplate,
) {
    @PostMapping("/resolve")
    fun resolveCreateReceipt(
        authentication: Authentication,
        @RequestBody request: ResolveReceiptRequest,
    ): ResolveReceiptResponse {
        val principal = authentication.domainPrincipal()
        Authorizer.requireRole(principal, Role.MERCHANT)
        if (request.commandType != "CATALOG_CREATE" || request.payloadSchemaVersion != 1) {
            throw DomainException("COMMAND_SCHEMA_UNSUPPORTED", "Unsupported catalog create command schema")
        }

        val payload = request.payload
        val outletId = parseUuid(payload["outletId"], "outletId")
        val outlet = requireOutletAccess(principal, outletId)
        val barcodeType = parseBarcodeType(payload["barcodeType"])
        val barcode = payload["barcode"] as? String ?: validation("Missing barcode")
        val normalizedBarcode = BarcodeNormalizer.normalize(barcodeType, barcode)
        val name = (payload["name"] as? String)?.trim() ?: validation("Missing name")
        val kind = parseListingKind(payload["kind"])
        val commerceMode = if (kind == ListingKind.MEDICINE) CommerceMode.VIEW_ONLY else CommerceMode.COMMERCE
        val mrpPaise = (payload["mrpPaise"] as? Number)?.toLong() ?: validation("Missing mrpPaise")
        val sellingPricePaise = (payload["sellingPricePaise"] as? Number)?.toLong() ?: validation("Missing sellingPricePaise")
        val category = (payload["category"] as? String)?.trim()?.lowercase() ?: validation("Missing category")
        val brand = cleanOptional(payload["brand"] as? String)
        val description = cleanOptional(payload["description"] as? String)
        val petType = cleanOptional(payload["petType"] as? String)
        val lifeStage = cleanOptional(payload["lifeStage"] as? String)
        val packLabel = cleanOptional(payload["packLabel"] as? String)
        val sku = cleanOptional(payload["sku"] as? String)

        val row = jdbc.query(
            """
            SELECT l.id, l.organization_id, l.outlet_id, l.create_request_fingerprint,
                   l.version, l.updated_at, h.actor_id
            FROM mypet.catalog_listing l
            LEFT JOIN mypet.catalog_listing_history h
              ON h.listing_id = l.id AND h.listing_version = 0 AND h.mutation_type = 'CREATE'
            WHERE l.outlet_id = ? AND l.create_idempotency_key = ?
            """.trimIndent(),
            { rs, _ ->
                CreateReceiptRow(
                    listingId = rs.getObject("id", UUID::class.java),
                    organizationId = rs.getObject("organization_id", UUID::class.java),
                    outletId = rs.getObject("outlet_id", UUID::class.java),
                    storedFingerprint = rs.getString("create_request_fingerprint"),
                    version = rs.getLong("version"),
                    updatedAt = rs.getTimestamp("updated_at").toInstant(),
                    actorId = rs.getObject("actor_id", UUID::class.java),
                )
            },
            outletId,
            request.idempotencyKey,
        ).firstOrNull() ?: throw DomainException("RESOURCE_NOT_FOUND", "No create receipt found for idempotency key")

        if (row.organizationId != outlet.organizationId || row.outletId != outlet.id) {
            throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "Stored create receipt partition mismatch")
        }
        if (row.actorId == null || row.actorId != principal.actorId) {
            throw DomainException("PERMISSION_DENIED", "Historical actor mismatch")
        }

        val expectedFingerprint = createFingerprint(
            organizationId = outlet.organizationId,
            outletId = outlet.id,
            barcodeType = barcodeType,
            normalizedBarcode = normalizedBarcode,
            name = name,
            kind = kind,
            commerceMode = commerceMode,
            mrpPaise = mrpPaise,
            sellingPricePaise = sellingPricePaise,
            category = category,
            brand = brand,
            description = description,
            petType = petType,
            lifeStage = lifeStage,
            packLabel = packLabel,
            sku = sku,
        )
        if (!MessageDigest.isEqual(
                row.storedFingerprint.toByteArray(Charsets.UTF_8),
                expectedFingerprint.toByteArray(Charsets.UTF_8),
            )
        ) {
            throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "Payload does not match historical create receipt")
        }

        return ResolveReceiptResponse(
            receiptId = row.listingId.toString(),
            commandType = "CATALOG_CREATE",
            entityId = row.listingId,
            resultingVersion = row.version,
            serverTimestamp = row.updatedAt.toString(),
        )
    }

    private fun requireOutletAccess(principal: Principal, outletId: UUID): ProviderOutlet {
        Authorizer.requireOutlet(principal, outletId)
        val outlet = providers.getOutlet(outletId)
        if (
            principal.organizationId == null ||
            outlet.organizationId != principal.organizationId ||
            outlet.status == ProviderStatus.SUSPENDED ||
            outlet.status == ProviderStatus.REJECTED
        ) {
            throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        }
        return outlet
    }

    private fun createFingerprint(
        organizationId: UUID,
        outletId: UUID,
        barcodeType: BarcodeType,
        normalizedBarcode: String,
        name: String,
        kind: ListingKind,
        commerceMode: CommerceMode,
        mrpPaise: Long,
        sellingPricePaise: Long,
        category: String,
        brand: String?,
        description: String?,
        petType: String?,
        lifeStage: String?,
        packLabel: String?,
        sku: String?,
    ): String {
        val out = ByteArrayOutputStream()
        val data = DataOutputStream(out)
        fun writeString(value: String?) {
            if (value == null) {
                data.writeInt(-1)
            } else {
                val bytes = value.toByteArray(StandardCharsets.UTF_8)
                data.writeInt(bytes.size)
                data.write(bytes)
            }
        }
        writeString(organizationId.toString())
        writeString(outletId.toString())
        writeString(barcodeType.name)
        writeString(normalizedBarcode)
        writeString(name)
        writeString(kind.name)
        writeString(commerceMode.name)
        data.writeLong(mrpPaise)
        data.writeLong(sellingPricePaise)
        writeString(category)
        writeString(brand)
        writeString(description)
        writeString(petType)
        writeString(lifeStage)
        writeString(packLabel)
        writeString(sku)
        data.writeInt(0) // M7 creates the canonical listing before media upload.
        data.flush()
        return MessageDigest.getInstance("SHA-256")
            .digest(out.toByteArray())
            .joinToString("") { "%02x".format(it) }
    }

    private fun parseUuid(value: Any?, field: String): UUID = try {
        UUID.fromString(value as? String ?: validation("Missing $field"))
    } catch (_: IllegalArgumentException) {
        validation("Invalid $field")
    }

    private fun parseBarcodeType(value: Any?): BarcodeType = try {
        BarcodeType.valueOf(value as? String ?: validation("Missing barcodeType"))
    } catch (_: IllegalArgumentException) {
        validation("Invalid barcodeType")
    }

    private fun parseListingKind(value: Any?): ListingKind = try {
        ListingKind.valueOf(value as? String ?: validation("Missing kind"))
    } catch (_: IllegalArgumentException) {
        validation("Invalid kind")
    }

    private fun cleanOptional(value: String?): String? = value?.trim()?.takeIf { it.isNotEmpty() }

    private fun validation(message: String): Nothing = throw DomainException("VALIDATION_ERROR", message)

    private data class CreateReceiptRow(
        val listingId: UUID,
        val organizationId: UUID,
        val outletId: UUID,
        val storedFingerprint: String,
        val version: Long,
        val updatedAt: java.time.Instant,
        val actorId: UUID?,
    )
}
