package `in`.mypetnew.application

import `in`.mypetnew.appointment.domain.AppointmentPersistence
import `in`.mypetnew.appointment.domain.AppointmentService
import `in`.mypetnew.appointment.domain.InMemoryAppointmentPersistence
import `in`.mypetnew.appointment.infrastructure.JdbcAppointmentPersistence
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate

@Configuration
class AppointmentConfiguration {
    @Bean
    @Profile("test", "development")
    fun inMemoryAppointmentPersistence(): AppointmentPersistence = InMemoryAppointmentPersistence()

    @Bean
    @Profile("!test & !development")
    fun jdbcAppointmentPersistence(
        jdbc: JdbcTemplate,
        transactions: TransactionTemplate,
    ): AppointmentPersistence = JdbcAppointmentPersistence(jdbc, transactions)

    @Bean
    fun appointmentService(persistence: AppointmentPersistence) = AppointmentService(persistence)
}
