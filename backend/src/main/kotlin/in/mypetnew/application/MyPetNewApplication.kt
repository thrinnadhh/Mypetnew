package `in`.mypetnew.application

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration
import org.springframework.boot.runApplication

@SpringBootApplication(
    scanBasePackages = ["in.mypetnew"],
    exclude = [UserDetailsServiceAutoConfiguration::class],
)
class MyPetNewApplication

fun main(args: Array<String>) {
    runApplication<MyPetNewApplication>(*args)
}

