package `in`.mypetnew.merchantops.testsupport

import org.flywaydb.core.Flyway
import org.flywaydb.core.api.output.MigrateResult
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.testcontainers.images.builder.ImageFromDockerfile
import org.testcontainers.postgresql.PostgreSQLContainer
import org.testcontainers.utility.DockerImageName
import javax.sql.DataSource

object PostgresTestDatabase {
    private val postgisImage: DockerImageName by lazy {
        val imageName = ImageFromDockerfile("mypetnew-postgres-postgis:17.6", false)
            .withDockerfileFromBuilder { builder ->
                builder
                    .from("postgres:17.6-alpine")
                    .run("apk add --no-cache postgis && cp /usr/lib/postgresql17/postgis-3.so /usr/local/lib/postgresql/ && cp /usr/share/postgresql17/extension/postgis* /usr/local/share/postgresql/extension/")
            }
            .get()
        DockerImageName.parse(imageName).asCompatibleSubstituteFor("postgres")
    }

    private val container: PostgreSQLContainer by lazy {
        PostgreSQLContainer(postgisImage)
            .withDatabaseName("mypetnew_contract")
            .withUsername("mypet_test")
            .withPassword("mypet_test")
            .also { it.start() }
    }

    fun dataSource(): DataSource = DriverManagerDataSource(
        container.jdbcUrl,
        container.username,
        container.password,
    )

    @Synchronized
    fun resetAndMigrate(): MigrateResult {
        val flyway = Flyway.configure()
            .dataSource(dataSource())
            .schemas("mypet")
            .defaultSchema("mypet")
            .createSchemas(true)
            .cleanDisabled(false)
            .locations("classpath:db/migration")
            .load()
        flyway.clean()
        return flyway.migrate()
    }
}
