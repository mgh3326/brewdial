# 0004 — Mobile UI MVP

## Status

Accepted (PR5, Mobile UI MVP).

## Context

PR4 landed the agent-agnostic Recipe / Feedback JSON API on top of CouchDB.
PR5 needs to add the first human-facing surface so the system is usable on a
phone next to the brewer, without committing to auth, offline sync, an MCP
server, or a deployment story yet.

## Decision

### Why mobile UI follows the API foundation

- The API already encodes the data contract (`CreateRecipeInput`,
  `CreateFeedbackInput`), so the UI can reuse repositories and validation
  helpers instead of inventing parallel shapes.
- Building a UI in the same monorepo as the API keeps types end-to-end and
  removes the "client out of date with server" failure mode at MVP scale.
- The API is testable today; layering a UI on top means humans (the user) can
  smoke-test full flows without invoking agents.

### Why server `load` / `actions` instead of client-side `fetch` for PR5

- Server-rendered loads call repository helpers directly, avoiding an
  unnecessary HTTP round-trip from the SvelteKit server back to its own API.
- Form `actions` keep the create-recipe / submit-feedback flow as a single
  POST with a server-side redirect — no client JS, no spinners, no XHR error
  handling, and forms still work on flaky mobile networks.
- It collapses the review surface: a reviewer reads one server file and one
  Svelte file per page, instead of also auditing client fetch wrappers.
- The same pages can later opt into client enhancement (`use:enhance`) without
  the UI changing — server-first is a strict superset.

### Why no component library / no Tailwind

- The whole UI is five short pages and three primitives. A component library
  would import more code than the entire app currently weighs.
- Plain CSS with a small set of utility classes (`.btn`, `.card`, `.field`,
  `.stack`, `.row`) is enough for a mobile-first dial-in tool and keeps the
  bundle and the build minimal.
- Avoiding Tailwind also avoids a config + content-scan + plugin story that we
  do not need until there are dozens of components.

### Why no auth in PR5

- BrewDial is a single-user MacBook tool today; the public domain
  (`coffee.robinco.dev`) is planned but not yet served.
- Adding auth before the data model and the UI are stable just locks in a
  session shape we would have to redo when MCP / OAuth / agent identity lands.
- The CouchDB credentials in `apps/web/src/lib/server/config.ts` are the only
  secret today; UI pages must continue to redact configuration values from
  responses and logs.

## Non-goals (PR5)

- No agent context summary API.
- No MCP server.
