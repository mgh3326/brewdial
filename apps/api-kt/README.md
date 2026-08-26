# BrewDial Kotlin API

Run locally with a migrated PostgreSQL database:

```sh
DATABASE_URL=postgres://user:password@localhost:5432/brewdial_test ./gradlew bootRun
```

Run the test suite with:

```sh
DATABASE_URL=postgres://user:password@localhost:5432/brewdial_test ./gradlew test
```

Run Spring against the existing contract tests with `DATABASE_URL=postgres://mgh3326@localhost:5432/brewdial_test scripts/contract-test.sh apps/api/src/routes/health.test.ts`.
Pass any Vitest file paths or selectors after `scripts/contract-test.sh`; no Hono server is started.
The runner starts Spring on `127.0.0.1:3021`, polls `/api/db/health`, and always stops it on exit.

This scaffold uses Spring Boot 4.1.1, Kotlin 2.3.21, Gradle 9.7.1, and Hibernate 7.4.5.Final. The versions come from the Spring Initializr GA-generated project. Hibernate is configured with `ddl-auto: validate` because the PostgreSQL schema is owned by the repository migrations.

Follow-up work is tracked in ROB-1316.
