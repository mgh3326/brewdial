# PR1 — Project Skeleton Design

**Date:** 2026-04-26
**Status:** Approved (decisions resolved 2026-04-26)
**Source spec:** `/Users/robin/shared/prompts/brewdial-pr1-project-skeleton.md`

## Goal

Initialize the BrewDial repository as a pnpm monorepo with a SvelteKit web app skeleton, a shared TypeScript package, and an initial architecture decision record. Deliver as PR `feat/project-skeleton` against `main` on `git@github.com:mgh3326/brewdial`.

This PR is skeleton-only. CouchDB, MCP, auth, and deployment are explicitly deferred.

## Resolved Decisions

These resolve open points in the source spec:

1. **`lint` / `test` scripts:** Keep both scripts present in `package.json` but as **no-op stubs** (e.g., `echo` exits with 0). Document the no-op status in the README and PR notes. ESLint/Vitest deferred to a later PR.
2. **SvelteKit scaffolding:** Use the official `pnpm dlx sv create apps/web` scaffolder for latest compatibility, then strip Tailwind, demo content, and any unrequested integrations. Reshape into the structure required by the source spec.
3. **Existing root files (from WebStorm-generated single-package TS project):** Delete `src/index.ts` and the root `tsconfig.json`; replace `package.json` and `README.md` with monorepo-aware versions per the source spec.
4. **`packageManager` field:** Pin to `pnpm@10.33.2` (locally verified version) instead of `pnpm@latest`, for reproducibility.

## Constraints (carried from source spec)

- **Agent-agnostic:** No Hermes-specific names in packages, code, docs, or APIs. Hermes is one possible client among many (OpenClaw etc.).
- **Stack:** pnpm monorepo, TypeScript, SvelteKit, plain CSS (no Tailwind), Node `>=22`.
- **Out of scope (PR1):** CouchDB integration, MCP server, authentication, deployment configuration.
- **Reuse existing remote:** `git@github.com:mgh3326/brewdial` is already configured — do not overwrite.
- **Branch:** All implementation work lands on `feat/project-skeleton`.
- **No user-specific paths** committed to the repo.

## Target Structure

```text
brewdial/
  README.md
  package.json
  pnpm-workspace.yaml
  .gitignore
  .env.example
  apps/
    web/
      package.json
      svelte.config.js
      vite.config.ts
      tsconfig.json
      src/
        app.css
        app.html
        lib/
          index.ts
        routes/
          +layout.svelte
          +page.svelte
          api/
            health/
              +server.ts
  packages/
    shared/
      package.json
      tsconfig.json
      src/
        index.ts
        schemas.ts
        types.ts
        feedback-rules.ts
  docs/
    decisions/
      0001-initial-architecture.md
    superpowers/
      specs/
        2026-04-26-pr1-project-skeleton-design.md   # this file
```

Standard SvelteKit-generated files (e.g. `.svelte-kit/`, additional config) may exist but should be kept minimal.

## Components

### Root workspace
- `package.json`: private monorepo root with workspace scripts (`dev`, `build`, `check`, `test`, `lint`). `test` and `lint` are no-op stubs at the root and at each workspace.
- `pnpm-workspace.yaml`: includes `apps/*` and `packages/*`.
- `.gitignore`: covers `node_modules`, `.pnpm-store`, `.env`/`.env.*` (allow `.env.example`), `.svelte-kit`, `build`, `dist`, `coverage`, `.DS_Store`.
- `.env.example`: placeholders only (`PUBLIC_APP_NAME`, future CouchDB envs, future API token). No real `.env`.

### `@brewdial/shared` (`packages/shared`)
- Pure TypeScript package; minimal dependencies (no zod yet).
- Exports: types (`BrewMethod`, `RecipeCode`, `RatingValue`, `OverallRating`, `BeanSnapshot`, `RecipeParams`, `RecipeStep`, `RecipeDoc`, `FeedbackRatings`, `ActualBrewParams`, `FeedbackDoc`, `PreferenceDoc`), `summarizeFeedbackRatings()` helper, and `recipeCodePattern` / `isRecipeCode()` placeholder.
- All exports re-exported from `src/index.ts`.

### `@brewdial/web` (`apps/web`)
- SvelteKit app, TypeScript, plain CSS.
- `/` — mobile-first landing page showing product name, one-line description, planned components list, and a visible reference to `/api/health`.
- `GET /api/health` — returns `{ ok: true, service: "brewdial-web", version: "0.1.0" }` via SvelteKit's `json` helper.
- Depends on `@brewdial/shared` via workspace protocol (even if unused at runtime in PR1, to validate wiring).

### Documentation
- `docs/decisions/0001-initial-architecture.md`: ADR covering project name, agent-agnostic rationale, chosen stack, text-form architecture diagram, PR1 non-goals, and roadmap PRs (2: CouchDB; 3: mobile UI; 4: agent context API; 5: MCP server; 6: launchd + Cloudflare deployment).
- `README.md`: what BrewDial is, current status (skeleton), planned architecture, local dev commands (`pnpm install`/`dev`/`check`/`build`), repository structure, note that `lint`/`test` are intentional no-ops, mention of planned `coffee.robinco.dev` domain.

## Data Flow (PR1 scope)

```text
Browser  --GET /-->  SvelteKit (apps/web) --renders--> static landing page
Browser  --GET /api/health-->  SvelteKit endpoint --returns JSON
```

CouchDB and MCP wiring intentionally absent.

## Validation

After implementation, the following must succeed from the repo root:

```bash
pnpm install
pnpm check     # svelte-check across workspaces
pnpm build     # builds @brewdial/web (and shared if it has a build step)
pnpm lint      # no-op, exit 0
pnpm test      # no-op, exit 0
```

Manual smoke test: `pnpm dev`, visit landing page, confirm `/api/health` returns the expected JSON.

## Git Workflow

1. Branch: `git checkout -b feat/project-skeleton` from `main`.
2. Commit logically (skeleton creation can be one commit; sub-stages may split if useful).
3. Push: `git push -u origin feat/project-skeleton`.
4. Open PR against `main` with the body specified in the source spec.

## Non-Goals (PR1)

- No CouchDB driver or queries.
- No MCP server package.
- No auth, sessions, cookies, or rate limiting.
- No deployment, Cloudflare, or launchd config.
- No Tailwind or other UI frameworks.
- No Hermes-specific naming, comments, or assumptions.
- No real `.env` committed.
