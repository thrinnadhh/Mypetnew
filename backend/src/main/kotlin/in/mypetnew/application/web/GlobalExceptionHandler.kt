package `in`.mypetnew.application.web

import `in`.mypetnew.common.error.DomainException
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.web.multipart.MaxUploadSizeExceededException
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.MissingRequestHeaderException
import org.springframework.web.bind.MissingServletRequestParameterException
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException
import org.springframework.web.servlet.resource.NoResourceFoundException
import java.time.Instant
import java.util.UUID

data class ApiErrorEnvelope(
    val code: String,
    val message: String,
    val traceId: String,
    val fieldErrors: Map<String, String>,
    val timestamp: Instant,
    val path: String,
)

@RestControllerAdvice
class GlobalExceptionHandler {
    @ExceptionHandler(DomainException::class)
    fun domain(error: DomainException, request: HttpServletRequest): ResponseEntity<ApiErrorEnvelope> {
        val status = when (error.code) {
            "RESOURCE_NOT_FOUND", "ORDER_NOT_FOUND", "CART_NOT_FOUND", "QUOTE_NOT_FOUND" -> HttpStatus.NOT_FOUND
            "FORBIDDEN", "ADMIN_PERMISSION_REQUIRED" -> HttpStatus.FORBIDDEN
            "OTP_RATE_LIMITED" -> HttpStatus.TOO_MANY_REQUESTS
            "IDEMPOTENCY_FINGERPRINT_MISMATCH", "ORDER_TRANSITION_INVALID", "INSUFFICIENT_STOCK" -> HttpStatus.CONFLICT
            else -> HttpStatus.BAD_REQUEST
        }
        return ResponseEntity.status(status).body(envelope(error.code, error.message, request))
    }

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun validation(error: MethodArgumentNotValidException, request: HttpServletRequest): ResponseEntity<ApiErrorEnvelope> {
        val fields = error.bindingResult.fieldErrors.associate { it.field to (it.defaultMessage ?: "invalid") }
        return ResponseEntity.badRequest().body(envelope("VALIDATION_FAILED", "Request validation failed", request, fields))
    }

    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun malformed(request: HttpServletRequest): ResponseEntity<ApiErrorEnvelope> =
        ResponseEntity.badRequest().body(envelope("MALFORMED_REQUEST", "The request body is malformed", request))

    @ExceptionHandler(
        MissingRequestHeaderException::class,
        MissingServletRequestParameterException::class,
        MethodArgumentTypeMismatchException::class,
    )
    fun binding(request: HttpServletRequest): ResponseEntity<ApiErrorEnvelope> =
        ResponseEntity.badRequest().body(envelope("VALIDATION_FAILED", "Request validation failed", request))

    @ExceptionHandler(NoResourceFoundException::class)
    fun noResource(request: HttpServletRequest): ResponseEntity<ApiErrorEnvelope> =
        ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(envelope("RESOURCE_NOT_FOUND", "The requested resource is unavailable", request))

    @ExceptionHandler(MaxUploadSizeExceededException::class)
    fun oversizedUpload(request: HttpServletRequest): ResponseEntity<ApiErrorEnvelope> =
        ResponseEntity.badRequest().body(envelope("DOCUMENT_INVALID", "The document cannot be accepted", request))

    @ExceptionHandler(Exception::class)
    fun unexpected(error: Exception, request: HttpServletRequest): ResponseEntity<ApiErrorEnvelope> =
        ResponseEntity.internalServerError().body(
            envelope("INTERNAL_ERROR", "The request could not be completed", request),
        )

    private fun envelope(
        code: String,
        message: String,
        request: HttpServletRequest,
        fieldErrors: Map<String, String> = emptyMap(),
    ) = ApiErrorEnvelope(
        code = code,
        message = message,
        traceId = request.getAttribute(TraceIdFilter.TRACE_ATTRIBUTE)?.toString() ?: UUID.randomUUID().toString(),
        fieldErrors = fieldErrors,
        timestamp = Instant.now(),
        path = request.requestURI,
    )
}
