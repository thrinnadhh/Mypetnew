package `in`.mypetnew.catalog.infrastructure

import `in`.mypetnew.catalog.domain.BarcodeResolutionLookup
import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import org.springframework.stereotype.Repository
import java.util.UUID

@Repository
@Profile("!test & !development")
class JdbcBarcodeResolutionLookup(
    private val jdbc: JdbcTemplate,
) : BarcodeResolutionLookup {
    override fun findListingId(
        organizationId: UUID,
        outletId: UUID,
        barcodeType: BarcodeType,
        normalizedBarcode: String,
    ): UUID? = jdbc.query(
        """
        SELECT id
        FROM mypet.catalog_listing
        WHERE organization_id = ?
          AND outlet_id = ?
          AND barcode_type = ?
          AND normalized_barcode = ?
        """.trimIndent(),
        { result, _ -> result.getObject("id", UUID::class.java) },
        organizationId,
        outletId,
        barcodeType.name,
        normalizedBarcode,
    ).singleOrNull()
}

@Component
@Profile("test", "development")
class InMemoryBarcodeResolutionLookup(
    private val catalog: CatalogService,
) : BarcodeResolutionLookup {
    override fun findListingId(
        organizationId: UUID,
        outletId: UUID,
        barcodeType: BarcodeType,
        normalizedBarcode: String,
    ): UUID? = catalog.allListings()
        .firstOrNull {
            it.organizationId == organizationId &&
                it.outletId == outletId &&
                it.barcodeType == barcodeType &&
                it.normalizedBarcode == normalizedBarcode
        }
        ?.id
}
