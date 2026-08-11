plugins {
    base
}

tasks.register("verify") {
    dependsOn(":backend:check")
}

