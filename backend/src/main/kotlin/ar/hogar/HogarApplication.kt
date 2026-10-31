package ar.hogar

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class HogarApplication

fun main(args: Array<String>) {
    runApplication<HogarApplication>(*args)
}
