package `in`.mypetnew.application

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication(scanBasePackages = ["in.mypetnew"])
class MyPetNewApplication

fun main(args: Array<String>) {
    runApplication<MyPetNewApplication>(*args)
}

