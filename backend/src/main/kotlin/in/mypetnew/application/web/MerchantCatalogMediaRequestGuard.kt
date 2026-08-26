package `in`.mypetnew.application.web

import `in`.mypetnew.common.error.DomainException
import java.lang.reflect.Type
import org.springframework.core.MethodParameter
import org.springframework.http.HttpInputMessage
import org.springframework.http.converter.HttpMessageConverter
import org.springframework.web.bind.annotation.ControllerAdvice
import org.springframework.web.servlet.mvc.method.annotation.RequestBodyAdviceAdapter

@ControllerAdvice
class MerchantCatalogMediaRequestGuard : RequestBodyAdviceAdapter() {
    override fun supports(
        methodParameter: MethodParameter,
        targetType: Type,
        converterType: Class<out HttpMessageConverter<*>>,
    ): Boolean = targetType == CreateListingRequest::class.java

    override fun afterBodyRead(
        body: Any,
        inputMessage: HttpInputMessage,
        parameter: MethodParameter,
        targetType: Type,
        converterType: Class<out HttpMessageConverter<*>>,
    ): Any {
        if (body is CreateListingRequest && !body.imageUrls.isNullOrEmpty()) {
            throw DomainException(
                "CATALOG_MEDIA_MANAGED_REQUIRED",
                "Catalog images must be uploaded through the managed media endpoint",
            )
        }
        return body
    }
}
