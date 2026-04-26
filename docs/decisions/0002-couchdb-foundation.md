# 0002 — CouchDB Foundation

## Status

Accepted (PR2, CouchDB foundation).

## Context

BrewDial needs a persistent store that fits its document-shaped data
(`RecipeDoc`, `FeedbackDoc`, `PreferenceDoc`), works for both the SvelteKit
web app and the future MCP server, and stays operationally simple on a
single MacBook before any cloud deployment.

## Decision

### Why CouchDB

- The data model is naturally document-shaped — recipes carry nested params
  and steps, feedback carries nested ratings; relational decomposition would
  add ceremony without payoff at this scale.
- CouchDB exposes a stable HTTP API — any agent, the MCP server, and the web
  app speak the same protocol with no driver bridging.
- Conflict handling and `_rev`-based optimistic concurrency are first-class,
  which suits agent-driven writes that may collide with manual edits.
- PouchDB (a CouchDB-compatible browser store) opens a credible offline-sync
  path later without re-architecting the storage layer.

### Why direct `fetch` instead of an SDK

- The CouchDB API surface BrewDial actually uses is small (server info,
  ensure DB, get doc, put doc, list docs later). A hand-written client stays
  under ~200 lines.
- No new dependency means no audit, no version drift, no transitive surface.
- Tests can inject a mock `fetch` cleanly; SDK abstractions tend to make
  mocking awkward.
- If we ever outgrow this, adopting an SDK is a localized refactor in
  `apps/web/src/lib/server/couch.ts`.

### Why the browser does not connect to CouchDB directly yet

- Direct browser → CouchDB requires either user-scoped CouchDB accounts or a
  shared credential exposed to the client, neither of which fits PR2's scope
  (no auth in PR2).
- CORS configuration becomes an operational concern that's premature before
  there's a real client surface.
- All DB access flows through SvelteKit endpoints, which gives a stable
  audit point for the future agent API and MCP server.

### Why bootstrap is a script, not a public admin endpoint

- DB creation and seed writes are deliberate human (or operator) actions —
  exposing them as request-driven endpoints invites accidental or malicious
  re-init.
- Scripts can run with operator-level credentials that the running web
  process never sees.
- The same script is reusable from CI or a future deploy hook without
  contorting the HTTP surface.

## Non-goals (PR2)

- No full recipe / feedback CRUD UI.
- No MCP server.
- No Cloudflare or launchd deployment.
- No browser-direct CouchDB or PouchDB sync.
- No CouchDB SDK dependency.
- No auth, sessions, cookies, or rate limiting.
