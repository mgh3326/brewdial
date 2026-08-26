# BrewDial Kotlin API

Run locally with a migrated PostgreSQL database:

```sh
DATABASE_URL=postgres://user:password@localhost:5432/brewdial_test ./gradlew bootRun
```

Run the test suite with:

```sh
DATABASE_URL=postgres://user:password@localhost:5432/brewdial_test ./gradlew test
```

This scaffold uses Spring Boot 4.1.1, Kotlin 2.3.21, Gradle 9.7.1, and Hibernate 7.4.5.Final. The versions come from the Spring Initializr GA-generated project. Hibernate is configured with `ddl-auto: validate` because the PostgreSQL schema is owned by the repository migrations.

Follow-up work is tracked in ROB-1316.
