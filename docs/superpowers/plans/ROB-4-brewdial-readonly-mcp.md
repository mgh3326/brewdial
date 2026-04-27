# ROB-4 — BrewDial read-only MCP server foundation

## Issue

Linear: ROB-4 — BrewDial: add read-only MCP server foundation

## Goal

Add a minimal TypeScript MCP server package to the BrewDial pnpm monorepo so agents can read BrewDial coffee context through stdio tools without changing stored data.

## Scope

Implement a read-only MCP server with two initial tools:

1. `brew.get_recent_context`
   - Optional input: `limit`
   - Uses the same semantics as the web context API:
     - missing / invalid -> 5
     - 0 or negative -> 1
     - above 20 -> 20
   - Returns the existing `ContextSummary` shape as structured JSON.

2. `brew.get_recipe_context`
   - Required input: `code`
   - Validates recipe code with existing shared validation.
   - Returns the existing `RecipeContext` shape as structured JSON.
   - For invalid code, returns a tool error with a clear message.
   - For not found, returns a structured `{ found: false, code }` style result or equivalent non-throwing result; do not crash the server.

## Preferred implementation shape

- Add `apps/mcp` as a new workspace package named `@brewdial/mcp`.
- Use `@modelcontextprotocol/sdk` for stdio transport.
- Keep it server-side/node-only.
- Reuse existing BrewDial CouchDB/context/repository logic where practical.
- If importing SvelteKit `$lib` aliases or `$env/static/private` from `apps/web` is awkward, extract shared server-side modules carefully into a package, but avoid large refactors.
- Prefer a small MCP-specific config loader reading `process.env` for:
  - `COUCHDB_URL`
  - `COUCHDB_DATABASE`
  - `COUCHDB_USERNAME`
  - `COUCHDB_PASSWORD`
- Never print or commit secret values.

## Non-goals

- No write tools.
- No LLM calls.
- No auth/session/rate limiting.
- No deployment or Cloudflare work.
- No CouchDB SDK addition.
- No Mango index changes.
- No changes to existing web API response shapes.
- No local `/Users/...` paths in committed docs.

## Expected files

Likely files, but implementer may adjust if a better minimal shape is required:

- `apps/mcp/package.json`
- `apps/mcp/tsconfig.json`
- `apps/mcp/src/index.ts`
- `apps/mcp/src/config.ts`
- `apps/mcp/src/tools.ts`
- `apps/mcp/src/tools.test.ts`
- root `package.json` scripts such as `mcp` or `mcp:dev` if useful
- README or docs update with generic local run command

## Validation

Run and report exact results:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
pnpm lint
```

Also smoke the MCP server startup/list-tools if practical using a script or MCP SDK client. If not practical, document what was tested and why.

## Acceptance criteria

- Monorepo checks pass.
- MCP server package builds/checks/tests pass.
- The server exposes exactly the planned read-only tools.
- Tools use the same context data behavior as existing web APIs.
- No secrets or local user-specific paths are committed.

## AoE markers

Planner status:

```text
AOE_STATUS: plan_ready
AOE_ISSUE: ROB-4
AOE_ROLE: planner
AOE_PLAN_PATH: docs/superpowers/plans/ROB-4-brewdial-readonly-mcp.md
AOE_NEXT: implementation_started_same_session
```

Implementer completion:

```text
AOE_STATUS: implementation_done
AOE_ISSUE: ROB-4
AOE_ROLE: implementer
AOE_AGENT: opencode
AOE_TESTS: <exact verification summary>
AOE_NEXT: request_plan_review
```

Reviewer completion:

```text
AOE_STATUS: review_passed
AOE_ISSUE: ROB-4
AOE_ROLE: reviewer
AOE_REPORT_PATH: docs/superpowers/plans/ROB-4-review-report.md
AOE_NEXT: create_pr
```
