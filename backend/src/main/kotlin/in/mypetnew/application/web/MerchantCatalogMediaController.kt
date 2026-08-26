package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.CatalogMediaAttachment
import `in`.mypetnew.catalog.domain.CatalogMediaService
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.provider.domain.ProviderService
import java.util.UUID
import org.springframework.http.MediaType
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile

@RestController
@RequestMapping("/api/v1/merchant/listings/{listingId}/media")
class MerchantCatalogMediaController(
    private val providers: ProviderService,
    private val catalog: CatalogService,
    private val media: CatalogMediaService,
) {
    @PostMapping(consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun upload(
        authentication: Authentication,
        @PathVariable listingId: UUID,
        @RequestParam outletId: UUID,
        @RequestParam expectedVersion: Long,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestPart("file") file: MultipartFile,
    ): CatalogMediaAttachment {
        val principal = authentication.domainPrincipal()
        val outlet = providers.requireActiveOutlet(
            principal,
            outletId,
            MerchantPermission.CATALOG_WRITE,
        )
        catalog.getManagedListing(outlet.organizationId, outlet.id, listingId)
        return media.uploadAndAttach(
            organizationId = outlet.organizationId,
            outletId = outlet.id,
            listingId = listingId,
            expectedVersion = expectedVersion,
            filename = file.originalFilename ?: "upload",
            contentType = file.contentType.orEmpty(),
            bytes = file.bytes,
            idempotencyKey = idempotencyKey,
        )
    }
}
