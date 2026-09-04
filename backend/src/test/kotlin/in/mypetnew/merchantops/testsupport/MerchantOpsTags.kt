package `in`.mypetnew.merchantops.testsupport

import org.junit.jupiter.api.Tag

@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
@Tag("merchant-ops-contract")
annotation class MerchantOpsContract

@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
@Tag("merchant-ops-postgres")
annotation class MerchantOpsPostgres

@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
@Tag("merchant-ops-concurrency")
annotation class MerchantOpsConcurrency

@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
@Tag("connected-e2e")
annotation class ConnectedE2E
