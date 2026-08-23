package `in`.mypetnew.merchantops.testsupport

import org.flywaydb.core.Flyway
import org.flywaydb.core.api.output.MigrateResult
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.testcontainers.postgresql.PostgreSQLContainer
import org.testcontainers.utility.DockerImageName
import javax.sql.DataSource

object PostgresTestDatabase {
    private val container: PostgreSQLContainer by lazy {
        PostgreSQLContainer(DockerImageName.parse("postgres:17.6-alpine"))
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
