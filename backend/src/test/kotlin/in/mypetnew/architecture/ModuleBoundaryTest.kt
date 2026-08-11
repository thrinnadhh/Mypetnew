package `in`.mypetnew.architecture

import com.tngtech.archunit.core.importer.ClassFileImporter
import com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses
import org.junit.jupiter.api.Test

class ModuleBoundaryTest {
    private val classes = ClassFileImporter().importPackages("in.mypetnew")

    @Test
    fun `domain modules do not depend on api or persistence adapters`() {
        noClasses()
            .that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().resideInAnyPackage("..api..", "..persistence..")
            .check(classes)
    }

    @Test
    fun `common kernel never depends on a business module`() {
        noClasses()
            .that().resideInAPackage("..common..")
            .should().dependOnClassesThat().resideInAnyPackage(
                "..identity..",
                "..provider..",
                "..catalog..",
                "..commerce..",
                "..pos..",
                "..loyalty..",
                "..engagement..",
            )
            .check(classes)
    }
}

