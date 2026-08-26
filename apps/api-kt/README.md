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

## Container image and production runtime

The arm64 OCI image is built only in CI by `image-kt.yml` using `bootBuildImage`; a local Docker build is not required. Set `SPRING_PROFILES_ACTIVE=prod` in Kubernetes to enable graceful shutdown and Spring Boot JSON console logs.

| Variable | Default / source | Purpose |
| --- | --- | --- |
| `PORT` | `3021` | HTTP listener port. |
| `SPRING_PROFILES_ACTIVE` | ConfigMap: `prod` | Enables production runtime settings. |
| `DATABASE_URL` | Secret, required | PostgreSQL connection URL. |
| `AGENT_TOKEN` | Secret, required | Agent endpoint authentication token. |
| `JAVA_TOOL_OPTIONS` | ConfigMap | JVM memory, GC, and thread-stack tuning. |
| `GIT_SHA` | ConfigMap | Release identifier passed to Sentry. |
| `SENTRY_DSN` | ConfigMap, empty | Enables Sentry only when a DSN is supplied. |
