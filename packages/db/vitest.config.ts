import { defineConfig } from 'vitest/config'
// DB tests share the local brewdial_test database; run files serially so
// one file's writes (e.g. guard.test's identity-less app_users) cannot
// pollute another file's queries. Tests within a file may still run concurrently.
export default defineConfig({ test: { fileParallelism: false } })
