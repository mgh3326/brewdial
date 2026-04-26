# 0001 — Initial Architecture

## Status

Accepted (PR1, project skeleton).

## Project

**BrewDial** — an agent-friendly coffee recipe and feedback dial-in system.

The system records brewing recipes, captures tasting feedback, and helps both
humans and agents iteratively improve a brew through repeated feedback rounds.

## Why agent-agnostic

BrewDial is built so that any compatible agent (Hermes, OpenClaw, or future
clients) can read and write recipes/feedback through a stable web API and,
later, an MCP server. Naming, schemas, and protocols therefore avoid any
single agent's vocabulary. Hermes is one possible client, not the canonical
one.

## Stack

- **Repository:** pnpm monorepo, single git repo on `git@github.com:mgh3326/brewdial`.
- **Language:** TypeScript across all packages.
- **Web app:** SvelteKit (`apps/web`, package `@brewdial/web`), plain CSS, mobile-first layout.
- **Shared types:** `packages/shared` (`@brewdial/shared`), source-imported by other workspaces.
- **Database (later):** CouchDB. Document model already drafted in `@brewdial/shared` (`RecipeDoc`, `FeedbackDoc`, `PreferenceDoc`).
- **Agent integration (later):** TypeScript MCP server in a future package.
- **Deployment (later):** macOS launchd locally, Cloudflare-fronted public service at `coffee.robinco.dev`.

## Architecture (planned)

```text
Mobile Web UI
  -> SvelteKit backend/API (apps/web)
    -> CouchDB

Hermes / OpenClaw / other agents
  -> BrewDial MCP server
    -> BrewDial web API
      -> CouchDB
```

In PR1 only the SvelteKit shell (with one `/api/health` endpoint) and the
shared type definitions exist. No CouchDB driver, no MCP server, no auth.

## Non-goals (PR1)

- No CouchDB integration or driver.
- No MCP server.
- No authentication or session management.
- No deployment configuration (launchd, Cloudflare).
- No CI configuration.
- No ESLint / Prettier / Vitest tooling (deferred to a later PR).

## Future PR roadmap

1. **PR2:** CouchDB integration — driver, document upserts, queries from `apps/web`.
2. **PR3:** Mobile recipe/feedback UI — viewer screens, feedback capture form, dial-in history.
3. **PR4:** Agent context API — endpoints that return summarized brew/feedback context for agents.
4. **PR5:** MCP server — TypeScript MCP that proxies the agent API.
5. **PR6:** Deployment — macOS launchd unit and Cloudflare config for `coffee.robinco.dev`.
