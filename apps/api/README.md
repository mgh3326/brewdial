# API tests

Run in-process tests with `pnpm --filter @brewdial/api test`.

Run the Hono HTTP contract suite with `pnpm --filter @brewdial/api test:http`.
It builds the API, starts it on `127.0.0.1:3020`, waits for DB health, then stops it.

Set `API_TEST_BASE_URL` to run contract requests against a chosen base URL.
Only `localhost`, `127.0.0.1`, and `[::1]` are accepted by default.
Set `API_TEST_ALLOW_REMOTE=1` only when an intentional remote contract target is required.

The name is deliberately not `API_BASE_URL`: that variable can point to production in a
developer shell, while this test-only variable is guarded to prevent accidental remote calls.
