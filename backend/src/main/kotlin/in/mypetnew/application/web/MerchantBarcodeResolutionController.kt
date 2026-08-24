package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.BarcodeResolutionLookup
import `in`.mypetnew.catalog.domain.BarcodeResolutionResult
import `in`.mypetnew.catalog.domain.BarcodeResolutionService
import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.provider.domain.ProviderService
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
@RequestMapping("/api/v1/merchant/barcodes")
class MerchantBarcodeResolutionController(
    private val providers: ProviderService,
    catalog: CatalogService,
    lookup: BarcodeResolutionLookup,
) {
    private val resolver = BarcodeResolutionService(catalog, lookup)

    @GetMapping("/resolve")
    fun resolve(
        authentication: Authentication,
        @RequestParam outletId: UUID,
        @RequestParam barcodeType: BarcodeType,
        @RequestParam barcode: String,
    ): BarcodeResolutionResult {
        val principal = authentication.domainPrincipal()
        val outlet = providers.requireActiveOutlet(
            principal,
            outletId,
            MerchantPermission.CATALOG_WRITE,
        )
        return resolver.resolve(
            organizationId = outlet.organizationId,
            outletId = outlet.id,
            barcodeType = barcodeType,
            rawBarcode = barcode,
        )
    }
}
