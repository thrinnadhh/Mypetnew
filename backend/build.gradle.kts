import org.gradle.api.tasks.testing.Test

plugins {
    kotlin("jvm") version "2.3.21"
    kotlin("plugin.spring") version "2.3.21"
    id("org.springframework.boot") version "4.1.0"
    jacoco
}

group = "in.mypetnew"
version = "0.1.0-SNAPSHOT"

kotlin {
    jvmToolchain(21)
    compilerOptions {
        allWarningsAsErrors.set(true)
        freeCompilerArgs.add("-Xjsr305=strict")
    }
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:4.1.0"))
    testImplementation(platform("org.springframework.boot:spring-boot-dependencies:4.1.0"))
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.flywaydb:flyway-database-postgresql")
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("com.google.auth:google-auth-library-oauth2-http:1.36.0")
    runtimeOnly("org.postgresql:postgresql")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.boot:spring-boot-webmvc-test")
    testImplementation("org.springframework.security:spring-security-test")
    testImplementation("com.h2database:h2")
    testImplementation("com.tngtech.archunit:archunit-junit5:1.4.1")
    testImplementation(platform("org.testcontainers:testcontainers-bom:2.0.5"))
    testImplementation("org.testcontainers:testcontainers-junit-jupiter")
    testImplementation("org.testcontainers:testcontainers-postgresql")
    testImplementation("org.xerial:sqlite-jdbc:3.48.0.0")
}

tasks.withType<Test> {
    environment("MYPET_SYNC_CURSOR_SECRET", "test-sync-cursor-secret-at-least-32-chars-long")
}

tasks.test {
    useJUnitPlatform()
    finalizedBy(tasks.jacocoTestReport)
}

val merchantOperationsTestSourceSet = sourceSets.named("test")

tasks.register<Test>("merchantOpsContractTest") {
    description = "Runs Merchant Operations contract tests."
    group = "verification"
    testClassesDirs = merchantOperationsTestSourceSet.get().output.classesDirs
    classpath = merchantOperationsTestSourceSet.get().runtimeClasspath
    useJUnitPlatform { includeTags("merchant-ops-contract") }
}

tasks.register<Test>("merchantOpsPostgresTest") {
    description = "Runs real-PostgreSQL Merchant Operations tests."
    group = "verification"
    testClassesDirs = merchantOperationsTestSourceSet.get().output.classesDirs
    classpath = merchantOperationsTestSourceSet.get().runtimeClasspath
    useJUnitPlatform { includeTags("merchant-ops-postgres") }
}

tasks.register<Test>("merchantOpsConcurrencyTest") {
    description = "Runs Merchant Operations concurrency certification tests."
    group = "verification"
    testClassesDirs = merchantOperationsTestSourceSet.get().output.classesDirs
    classpath = merchantOperationsTestSourceSet.get().runtimeClasspath
    useJUnitPlatform { includeTags("merchant-ops-concurrency") }
}

tasks.jacocoTestReport {
    dependsOn(tasks.test)
    classDirectories.setFrom(
        files(classDirectories.files.map { classes ->
            fileTree(classes) { exclude("**/infrastructure/**") }
        }),
    )
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
}

tasks.jacocoTestCoverageVerification {
    classDirectories.setFrom(
        files(classDirectories.files.map { classes ->
            fileTree(classes) { exclude("**/infrastructure/**") }
        }),
    )
    violationRules {
        rule {
            limit { minimum = "0.80".toBigDecimal() }
        }
    }
}

tasks.check {
    dependsOn(tasks.jacocoTestCoverageVerification)
}
