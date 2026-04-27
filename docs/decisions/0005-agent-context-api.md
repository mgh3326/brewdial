# 0005 — Agent Context Summary API

## Status

Accepted (PR6, Agent Context Summary API).

## Context

PR4 landed the Recipe / Feedback JSON API and PR5 added a mobile UI on top of
it. Future agents (Hermes, OpenClaw, others) and a future MCP server will
need a compact, structured "what has the user been brewing lately" surface
before suggesting the next dial-in. PR6 ships that as a read-only HTTP API,
without committing to an LLM, an MCP server, auth, or any deployment story
yet.

## Decision

### Why a read-only context API comes before MCP

- Building MCP first would couple the protocol surface to whatever in-memory
  shape the model happened to want. Shipping an HTTP context contract first
  pins the data shape down and makes it agent-agnostic.
- An HTTP endpoint is testable today against mocked `fetch`; an MCP server
  pulls in a separate transport, schema language, and process-management
  story that the API does not need.
- Once the context shape is stable, an MCP server becomes a thin wrapper
  that re-exposes the same data via tool calls.

### Why deterministic structured context instead of an LLM

- The whole point of this PR is to give agents the raw material they already
  needed before suggesting a brew. Inserting an LLM here would just hide
  data behind a model hop and add a key-management story the project does
  not want.
- Deterministic guidance strings (no recipes yet / latest recipe lacks
  feedback / latest average overall is below 3) are reproducible, cheap to
  test, and safe to ship without auth.
- LLM-driven recommendation can live on top of this API later, in a
  separate component, without changing the contract.

### Why no auth in PR6

- BrewDial is still a single-user MacBook tool; the public domain
  (`coffee.robinco.dev`) is planned but not yet served.
- Adding auth now would lock in a session/identity shape we would have to
  redo when MCP / OAuth / agent identity lands.
- The CouchDB credentials in `apps/web/src/lib/server/config.ts` remain the
  only secret today; the new endpoints continue to redact configuration and
  raw errors from responses.

### Why no Mango indexes / `_design` docs in PR6

- `_all_docs` prefix ranges (the same approach PR4 chose) are still fast
  enough at MVP scale and require zero index management.
- A Mango index needs a `_design` document plus a migration story; deferring
  that to the first query that genuinely needs it keeps the PR small.
- The `/api/context` endpoint reads at most 20 recent recipes plus their
  feedback, so a sequential scan is fine for now.

## Non-goals (PR6)

- No LLM calls, prompts, or model wiring.
- No MCP server or package.
- No auth, sessions, cookies, or rate limiting.
- No PouchDB or offline sync.
- No deployment, launchd, or Cloudflare configuration.
- No new runtime validation libraries (no `zod`).
- No CouchDB SDK, Mango indexes, or `_design` docs.
- No UI pages for the context endpoints.
