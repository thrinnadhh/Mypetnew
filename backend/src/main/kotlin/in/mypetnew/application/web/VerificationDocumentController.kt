package `in`.mypetnew.application.web

import `in`.mypetnew.provider.domain.DocumentPurpose
import `in`.mypetnew.provider.domain.DocumentStore
import `in`.mypetnew.provider.domain.PrivateObjectRef
import `in`.mypetnew.provider.domain.SignedDocumentAccess
import org.springframework.http.MediaType
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile
import java.util.UUID

data class PrivateDocumentResponse(val id: UUID)

@RestController
class VerificationDocumentController(private val documents: DocumentStore) {
    @PostMapping(
        "/api/v1/merchant/outlets/{outletId}/verification-documents",
        consumes = [MediaType.MULTIPART_FORM_DATA_VALUE],
    )
    fun upload(
        authentication: Authentication,
        @PathVariable outletId: UUID,
        @RequestParam purpose: DocumentPurpose,
        @RequestPart("file") file: MultipartFile,
    ): PrivateDocumentResponse {
        val ref = documents.put(
            authentication.domainPrincipal(),
            outletId,
            file.originalFilename ?: "document",
            file.contentType ?: MediaType.APPLICATION_OCTET_STREAM_VALUE,
            file.bytes,
            purpose,
        )
        return PrivateDocumentResponse(ref.value)
    }

    @GetMapping("/api/v1/documents/{documentId}/access")
    fun access(
        authentication: Authentication,
        @PathVariable documentId: UUID,
        @RequestParam purpose: DocumentPurpose,
    ): SignedDocumentAccess = documents.authorizeRead(
        authentication.domainPrincipal(),
        PrivateObjectRef(documentId),
        purpose,
    )
}
