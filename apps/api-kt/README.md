# BrewDial Kotlin API

The API runs on **PostgreSQL or MySQL** through JPA/Hibernate. One setting
selects the database: the `DATABASE_URL` scheme (`postgres://…` or
`mysql://…`). It picks the JDBC driver, the Hibernate types and the Flyway
folder (`src/main/resources/db/migration/{postgresql,mysql}`, see the README
there). Flyway migrates on startup and Hibernate validates the result.

Run locally with PostgreSQL (an empty database is migrated by Flyway; a
node-pg-migrate database is baselined):

```sh
DATABASE_URL=postgres://user:password@localhost:5432/brewdial_test ./gradlew bootRun
```

Run the test suite with either database. CI runs both (`ci-kt.yml`):

```sh
DATABASE_URL=postgres://user:password@localhost:5432/brewdial_test ./gradlew test
DATABASE_URL=mysql://user:password@127.0.0.1:3306/brewdial_test ./gradlew test
```

The data copy between PostgreSQL and MySQL, in either direction (copy mode of
this app), is described in `docs/runbooks/oci-heatwave-cutover.md`.

## Dialect-neutral code

This is the only API after the HeatWave cutover, and it must be able to change
database through the ORM. Application code uses JPQL or criteria. Native SQL
belongs in the per-vendor Flyway folders. `NativeSqlGuardTest` fails on native
queries or raw JDBC in main code, unless `src/test/resources/native-sql-allowlist.txt`
lists the file with its exact count. The list marks what is existing debt, so
lower a count when you remove a use, and do not add to it without a reason.

Run Spring against the existing contract tests with `DATABASE_URL=postgres://mgh3326@localhost:5432/brewdial_test scripts/contract-test.sh apps/api/src/routes/health.test.ts`.
Pass any Vitest file paths or selectors after `scripts/contract-test.sh`; no Hono server is started.
The runner starts Spring on `127.0.0.1:3021`, polls `/api/db/health`, and always stops it on exit.

This scaffold uses Spring Boot 4.1.1, Kotlin 2.3.21, Gradle 9.7.1, and Hibernate 7.4.5.Final. The versions come from the Spring Initializr GA-generated project. Hibernate is configured with `ddl-auto: validate` because the schema is owned by the Flyway migrations.

## Intentional differences from Hono

- PostgreSQL timestamps retain microsecond precision here; Hono serializes them at millisecond precision.
- PostgreSQL `int8` and `numeric` values are JSON numbers here, rather than Hono's strings.
- Array request bodies on agent write routes return `400 {"error":"invalid body"}`.
- A write whose body holds a NUL character returns `400 {"error":"invalid body"}` on both databases. MySQL would store it and PostgreSQL refuses it, so the data could not move between them. A write body over 1 MiB returns `413 {"error":"body too large"}`.

Follow-up work is tracked in ROB-1316.

## Container image and production runtime

The arm64 OCI image is built only in CI by `image-kt.yml` using `bootBuildImage`; a local Docker build is not required. Set `SPRING_PROFILES_ACTIVE=prod` in Kubernetes to enable graceful shutdown and Spring Boot JSON console logs.

| Variable | Default / source | Purpose |
| --- | --- | --- |
| `PORT` | `3021` | HTTP listener port. |
| `SPRING_PROFILES_ACTIVE` | ConfigMap: `prod` | Enables production runtime settings. |
| `DATABASE_URL` | Secret / env file, required | `postgres://…` or `mysql://…`; selects the database vendor. |
| `AGENT_TOKEN` | Secret, required | Agent endpoint authentication token. |
| `JAVA_TOOL_OPTIONS` | ConfigMap | JVM memory, GC, and thread-stack tuning. |
| `GIT_SHA` | ConfigMap | Release identifier passed to Sentry. |
| `SENTRY_DSN` | ConfigMap, empty | Enables Sentry only when a DSN is supplied. |
