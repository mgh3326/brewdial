# 0003 — Recipe / Feedback API Foundation

## Status

Accepted (PR4, Recipe / Feedback API).

## Context

PR3 landed the CouchDB foundation: server-only config loader, fetch-based
client, DB health endpoint, bootstrap script, and a global preferences
repository. PR4 needs to add the first real read/write surface — recipes and
feedback — without committing to a UI, agent context API, or MCP server yet.

## Decision

### Why the API foundation comes before the mobile UI

- A stable, agent-agnostic JSON surface unblocks both the future mobile UI and
  the future MCP server in parallel.
- Repositories + routes are testable today against mocked `fetch`; a UI built
  on top of a churning API would mostly serve to document the churn.
- It keeps the public contract (`CreateRecipeInput`, `CreateFeedbackInput`,
  response shapes) reviewable in isolation before any client locks in
  assumptions.

### Why manual validation instead of `zod` for PR4

- The validation surface is small (two creators) and the schemas are visible
  beside the type definitions in `@brewdial/shared`.
- Adding `zod` (or any runtime validator) costs an audit, version drift, and
  ~30KB of bundle weight that the agent path doesn't need yet.
- Hand-written helpers force us to keep the data contract narrow — every
  accepted field has to be named explicitly, which makes "permissive top-level,
  copy known fields only" the natural shape.
- If validation grows beyond what's reviewable in one file, switching to `zod`
  is a localized refactor inside `packages/shared/src/validation.ts`.

### Why `_all_docs` prefix ranges instead of Mango indexes for PR4

- `_all_docs` is always available, requires zero index management, and is fast
  enough at MVP scale (single MacBook, dozens to hundreds of docs).
- Document IDs already encode the natural prefix (`recipe:COF-…`,
  `feedback:COF-NNNN:…`), so prefix ranges express the queries we actually need
  without designing a secondary index.
- Mango indexes need a `_design` doc plus a migration story; deferring that to
  the first query that genuinely needs it keeps PR4 small.

### Why recipe codes use `counter:recipe`

- A single CouchDB document is the simplest source of truth for "the next
  recipe number" — no UUIDs to humanize, no separate sequence service.
- `_rev`-based optimistic concurrency is built in; we retry on 409 a small
  number of times rather than introducing an explicit lock.
- Codes (`COF-0001`) stay short, human-quotable, and stable across sync
  scenarios (PouchDB later) because they're embedded in the document ID.

## Non-goals (PR4)

- No mobile UI.
- No agent context summary API.
- No MCP server.
- No auth / sessions / rate limiting.
- No PouchDB / offline sync.
- No `zod` or other runtime validation library.
- No CouchDB SDK.
- No Mango indexes or `_design` docs.
