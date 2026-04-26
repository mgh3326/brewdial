# PR1 — Project Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Initialize the BrewDial repository as a pnpm monorepo with a SvelteKit web app skeleton, a shared TypeScript package, an architecture decision record, and a `/api/health` endpoint. Land as PR `feat/project-skeleton` against `main` on `git@github.com:mgh3326/brewdial`.

**Architecture:** Single repository, pnpm workspaces, two workspaces — `apps/web` (SvelteKit) and `packages/shared` (TypeScript types and helpers). `@brewdial/shared` is consumed by `@brewdial/web` via the `workspace:*` protocol; PR1 uses a type-only import in `apps/web/src/lib/index.ts` to validate end-to-end workspace wiring without adding runtime dependencies. No CouchDB, MCP, auth, or deployment in this PR.

**Tech Stack:** pnpm@10.33.2, Node ≥22, TypeScript, SvelteKit (latest, scaffolded via `sv`), plain CSS.

**Reference spec:** `docs/superpowers/specs/2026-04-26-pr1-project-skeleton-design.md`
**Source brief:** `/Users/robin/shared/prompts/brewdial-pr1-project-skeleton.md`

---

## Pre-flight

Run from the local repository root (do **not** hardcode this path anywhere committed). Confirm:

- `pnpm --version` reports `10.33.2`
- `node --version` reports `>=22`
- `git remote -v` shows `git@github.com:mgh3326/brewdial`
- Current branch is `main`, working tree clean (the design doc is already committed as `f3edf70`)

---

## File map

The plan creates / modifies / deletes these files. Each task below contains the exact content.

| Path | Action | Owner Task |
| --- | --- | --- |
| `tsconfig.json` (root) | delete | T1 |
| `src/index.ts` | delete | T1 |
| `src/` | delete | T1 |
| `package-lock.json` | delete | T1 |
| `node_modules/` | delete | T1 |
| `package.json` (root) | replace | T2 |
| `pnpm-workspace.yaml` | create | T2 |
| `.gitignore` | replace | T2 |
| `.env.example` | create | T2 |
| `packages/shared/package.json` | create | T3 |
| `packages/shared/tsconfig.json` | create | T3 |
| `packages/shared/src/index.ts` | create | T3 |
| `packages/shared/src/types.ts` | create | T3 |
| `packages/shared/src/schemas.ts` | create | T3 |
| `packages/shared/src/feedback-rules.ts` | create | T3 |
| `apps/web/**` | create via `sv` | T4 |
| `apps/web/package.json` | modify | T5 |
| `apps/web/src/app.css` | replace | T6 |
| `apps/web/src/routes/+layout.svelte` | replace | T6 |
| `apps/web/src/routes/+page.svelte` | replace | T6 |
| `apps/web/src/lib/index.ts` | replace | T6 |
| `apps/web/src/routes/api/health/+server.ts` | create | T7 |
| `docs/decisions/0001-initial-architecture.md` | create | T8 |
| `README.md` | replace | T9 |

---

### Task 1: Create feature branch and remove old scaffolding

**Files:**
- Delete: `tsconfig.json` (root)
- Delete: `src/index.ts`, `src/`
- Delete: `package-lock.json`
- Delete: `node_modules/`

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/project-skeleton
```

Expected: `Switched to a new branch 'feat/project-skeleton'`.

- [ ] **Step 2: Remove WebStorm-generated scaffolding**

```bash
rm -f tsconfig.json package-lock.json
rm -rf src node_modules
```

- [ ] **Step 3: Verify deletions**

```bash
git status
```

Expected: `deleted: src/index.ts` and `deleted: tsconfig.json` shown (these were tracked). `package-lock.json` was untracked, so it just disappears.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove WebStorm single-package scaffolding"
```

---

### Task 2: Add root workspace configuration

**Files:**
- Replace: `package.json`
- Create: `pnpm-workspace.yaml`
- Replace: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Replace root `package.json`**

Overwrite `package.json` with:

```json
{
  "name": "brewdial",
  "private": true,
  "version": "0.1.0",
  "description": "Agent-friendly coffee recipe and feedback dial-in system",
  "type": "module",
  "scripts": {
    "dev": "pnpm --filter @brewdial/web dev",
    "build": "pnpm -r build",
    "check": "pnpm -r check",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  },
  "packageManager": "pnpm@10.33.2",
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Replace `.gitignore`**

```gitignore
# Dependencies
node_modules
.pnpm-store

# Build outputs
.svelte-kit
build
dist
coverage

# Environment
.env
.env.*
!.env.example

# Editor / OS
.DS_Store
/.idea
.vscode/*

# Other package managers (project uses pnpm)
package-lock.json
yarn.lock
```

- [ ] **Step 4: Create `.env.example`**

```bash
# BrewDial web
PUBLIC_APP_NAME=BrewDial

# Future CouchDB integration
COUCHDB_URL=http://127.0.0.1:5984
COUCHDB_DATABASE=coffee
COUCHDB_USERNAME=
COUCHDB_PASSWORD=

# Future agent/MCP API token
BREWDIAL_API_TOKEN=
```

- [ ] **Step 5: Run install (should be a no-op until workspaces exist)**

```bash
pnpm install
```

Expected: pnpm prints `No projects matched the filters` or installs nothing because no workspace packages exist yet. May or may not create an empty `pnpm-lock.yaml`. Either is fine.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml .gitignore .env.example
# Include the lockfile only if pnpm created it
[ -f pnpm-lock.yaml ] && git add pnpm-lock.yaml
git commit -m "feat: add pnpm workspace configuration and env template"
```

---

### Task 3: Scaffold @brewdial/shared package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/feedback-rules.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@brewdial/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "check": "tsc --noEmit",
    "build": "echo '@brewdial/shared has no build step' && exit 0",
    "test": "echo '@brewdial/shared: no tests in PR1 (intentional no-op)' && exit 0",
    "lint": "echo '@brewdial/shared: no lint in PR1 (intentional no-op)' && exit 0"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/shared/src/types.ts`**

```ts
export type BrewMethod = 'v60' | 'espresso' | 'aeropress' | 'kalita' | 'other';

export type RecipeCode = `COF-${string}`;

export type RatingValue = 0 | 1 | 2 | 3 | 4;

export type OverallRating = 1 | 2 | 3 | 4 | 5;

export interface BeanSnapshot {
  name?: string;
  roaster?: string;
  roastDate?: string;
}

export interface RecipeParams {
  doseG?: number;
  waterG?: number;
  ratio?: string;
  tempC?: number;
  grind?: string;
  targetTimeSec?: number;
}

export interface RecipeStep {
  atSec?: number;
  waterG?: number;
  note: string;
}

export interface RecipeDoc {
  _id: string;
  _rev?: string;
  type: 'recipe';
  code: RecipeCode;
  beanId?: string;
  beanSnapshot?: BeanSnapshot;
  method: BrewMethod;
  version: number;
  title: string;
  params: RecipeParams;
  steps: RecipeStep[];
  intent?: string[];
  adjustmentFromPrevious?: string;
  createdBy: 'agent' | 'manual';
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackRatings {
  overall?: OverallRating;
  burnt?: RatingValue;
  bitter?: RatingValue;
  sour?: RatingValue;
  sweetness?: RatingValue;
  body?: RatingValue;
  astringency?: RatingValue;
  clarity?: RatingValue;
}

export interface ActualBrewParams {
  tempC?: number;
  grind?: string;
  timeSec?: number;
}

export interface FeedbackDoc {
  _id: string;
  _rev?: string;
  type: 'feedback';
  recipeCode: RecipeCode;
  recipeId: string;
  beanId?: string;
  ratings: FeedbackRatings;
  actual?: ActualBrewParams;
  comment?: string;
  desiredDirection?: string[];
  nextHint?: string[];
  source: 'web' | 'agent' | 'mcp';
  createdAt: string;
  updatedAt: string;
}

export interface PreferenceDoc {
  _id: 'preference:global';
  _rev?: string;
  type: 'preference';
  likes: string[];
  dislikes: string[];
  defaultParams?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Create `packages/shared/src/schemas.ts`**

```ts
export const recipeCodePattern = /^COF-\d{4,}$/;

export function isRecipeCode(value: string): value is `COF-${string}` {
  return recipeCodePattern.test(value);
}
```

- [ ] **Step 5: Create `packages/shared/src/feedback-rules.ts`**

```ts
import type { FeedbackRatings } from './types';

export interface FeedbackSummary {
  dominantIssues: string[];
  positiveSignals: string[];
  recommendedAdjustments: string[];
}

export function summarizeFeedbackRatings(ratings: FeedbackRatings): FeedbackSummary {
  const dominantIssues: string[] = [];
  const positiveSignals: string[] = [];
  const recommendedAdjustments: string[] = [];

  if ((ratings.burnt ?? 0) >= 3) {
    dominantIssues.push('burnt');
    recommendedAdjustments.push('Lower water temperature by 1-2°C');
    recommendedAdjustments.push('Grind slightly coarser');
    recommendedAdjustments.push('Reduce late-stage extraction or final pour agitation');
  }

  if ((ratings.astringency ?? 0) >= 3) {
    dominantIssues.push('astringency');
    recommendedAdjustments.push('Reduce agitation');
    recommendedAdjustments.push('Shorten total brew time by 10-15 seconds');
  }

  if ((ratings.sour ?? 0) >= 3) {
    dominantIssues.push('sour');
    recommendedAdjustments.push('Increase extraction slightly');
    recommendedAdjustments.push('Consider a slightly finer grind or +1°C water temperature');
  }

  if ((ratings.sweetness ?? 0) >= 3) {
    positiveSignals.push('sweetness');
  }

  if ((ratings.clarity ?? 0) >= 3) {
    positiveSignals.push('clarity');
  }

  return {
    dominantIssues,
    positiveSignals,
    recommendedAdjustments: Array.from(new Set(recommendedAdjustments))
  };
}
```

- [ ] **Step 6: Create `packages/shared/src/index.ts`**

```ts
export * from './types';
export * from './schemas';
export * from './feedback-rules';
```

- [ ] **Step 7: Install and type-check the shared package**

```bash
pnpm install
pnpm --filter @brewdial/shared check
```

Expected: `pnpm install` resolves `typescript` for the shared workspace and writes `pnpm-lock.yaml`. `pnpm --filter @brewdial/shared check` runs `tsc --noEmit` and reports no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "feat: add @brewdial/shared package with types and feedback helper"
```

---

### Task 4: Scaffold the SvelteKit web app via `sv create`

**Files:**
- Create: `apps/web/` (entire tree, via scaffolder)

- [ ] **Step 1: Run the official Svelte scaffolder**

From repo root:

```bash
pnpm dlx sv@latest create apps/web
```

Answer the prompts as follows:

| Prompt | Answer |
| --- | --- |
| Where should we create your project? | `apps/web` (already provided as arg) |
| Which Svelte app template? | **minimal** (`SvelteKit minimal`) |
| Add type checking with TypeScript? | **Yes, using TypeScript syntax** |
| What would you like to add? (add-ons) | **Deselect everything** — no Prettier, ESLint, Vitest, Playwright, Tailwind, Drizzle, Lucia, mdsvex, Storybook, or any other add-on |
| Which package manager do you want to install dependencies with? | **pnpm** |

If `sv` supports non-interactive flags in this version, the equivalent shorthand is:

```bash
pnpm dlx sv@latest create apps/web --template minimal --types ts --no-add-ons --install pnpm
```

(If flag names differ in the installed version, fall back to the interactive answers above.)

- [ ] **Step 2: Inspect what was generated**

```bash
ls -la apps/web
cat apps/web/package.json
```

Expected (at minimum): `package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `src/`, `static/`. `sv` may also drop `apps/web/.gitignore`, `apps/web/README.md`, and possibly `apps/web/.npmrc` — record the file list.

- [ ] **Step 3: Remove sv-generated `.gitignore` and `README.md` inside apps/web**

The root `.gitignore` already covers everything, and the root `README.md` is the canonical project README.

```bash
rm -f apps/web/.gitignore apps/web/README.md
```

Keep any sv-generated `apps/web/.npmrc` if present — it's small and useful.

- [ ] **Step 4: Commit the raw scaffold (before customization)**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "chore: scaffold apps/web with sv create (minimal template)"
```

---

### Task 5: Reshape `apps/web/package.json`

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Read the current file**

```bash
cat apps/web/package.json
```

Note its `"name"`, `"scripts"`, `"dependencies"`, and `"devDependencies"`. The `devDependencies` block will list `@sveltejs/adapter-auto`, `@sveltejs/kit`, `@sveltejs/vite-plugin-svelte`, `svelte`, `svelte-check`, `typescript`, `vite` (and possibly more) at versions chosen by sv.

- [ ] **Step 2: Edit `apps/web/package.json`**

Apply these edits — **preserve every dependency / devDependency version that sv produced; do not bump anything**:

1. Change top-level `"name"` to `"@brewdial/web"`.
2. Ensure `"version": "0.1.0"`, `"private": true`, `"type": "module"` are set.
3. Keep all sv-generated entries under `"scripts"` (typically `dev`, `build`, `preview`, `check`, `check:watch`).
4. Add these two no-op scripts under `"scripts"` (preserving the existing ones):

   ```json
   "test": "echo '@brewdial/web: no tests in PR1 (intentional no-op)' && exit 0",
   "lint": "echo '@brewdial/web: no lint in PR1 (intentional no-op)' && exit 0"
   ```
5. Add a `"dependencies"` block (sv may not include one in the minimal template):

   ```json
   "dependencies": {
     "@brewdial/shared": "workspace:*"
   }
   ```

The final shape should look like (`...sv versions...` = whatever sv generated, copied verbatim):

```json
{
  "name": "@brewdial/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "check:watch": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch",
    "test": "echo '@brewdial/web: no tests in PR1 (intentional no-op)' && exit 0",
    "lint": "echo '@brewdial/web: no lint in PR1 (intentional no-op)' && exit 0"
  },
  "dependencies": {
    "@brewdial/shared": "workspace:*"
  },
  "devDependencies": {
    "@sveltejs/adapter-auto": "...sv version...",
    "@sveltejs/kit": "...sv version...",
    "@sveltejs/vite-plugin-svelte": "...sv version...",
    "svelte": "...sv version...",
    "svelte-check": "...sv version...",
    "typescript": "...sv version...",
    "vite": "...sv version..."
  }
}
```

If sv produced different `dev`/`build`/`preview`/`check` script bodies, **keep what sv wrote** — only the `name`, the two no-op scripts, and the `dependencies` block are introduced by us.

- [ ] **Step 3: Reinstall to wire up the workspace dependency**

```bash
pnpm install
```

Expected: pnpm links `@brewdial/shared` into `apps/web/node_modules` via a symlink and updates `pnpm-lock.yaml`.

- [ ] **Step 4: Verify the workspace symlink**

```bash
ls -la apps/web/node_modules/@brewdial/shared
```

Expected: a symlink whose target ends in `packages/shared` (exact prefix depends on the local checkout path).

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "feat: rename web app to @brewdial/web and link shared package"
```

---

### Task 6: Web app source — landing page and layout

**Files:**
- Replace: `apps/web/src/app.css`
- Replace: `apps/web/src/routes/+layout.svelte`
- Replace: `apps/web/src/routes/+page.svelte`
- Replace: `apps/web/src/lib/index.ts`

(`apps/web/src/app.html` keeps its sv-generated content — no change needed.)

- [ ] **Step 1: Write `apps/web/src/app.css`**

```css
:root {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  -webkit-text-size-adjust: 100%;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  background: #fafafa;
  color: #1a1a1a;
  line-height: 1.5;
}

a {
  color: #6f4e37;
}

@media (prefers-color-scheme: dark) {
  body {
    background: #161616;
    color: #e8e8e8;
  }
  a {
    color: #d4a574;
  }
}
```

- [ ] **Step 2: Write `apps/web/src/routes/+layout.svelte`**

```svelte
<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

{@render children()}
```

- [ ] **Step 3: Write `apps/web/src/routes/+page.svelte`**

```svelte
<svelte:head>
  <title>BrewDial</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<main>
  <h1>BrewDial</h1>
  <p class="tagline">
    Coffee recipes, tasting feedback, and dial-in history for agents and humans.
  </p>

  <section>
    <h2>Planned components</h2>
    <ul>
      <li>Mobile recipe viewer</li>
      <li>Feedback capture</li>
      <li>Agent API</li>
      <li>MCP server</li>
      <li>CouchDB document store</li>
    </ul>
  </section>

  <section>
    <h2>Health check</h2>
    <p>
      <a href="/api/health"><code>GET /api/health</code></a>
    </p>
  </section>
</main>

<style>
  main {
    max-width: 540px;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 4rem;
  }
  h1 {
    font-size: 2.25rem;
    margin: 0 0 0.5rem;
  }
  .tagline {
    color: #555;
    margin: 0 0 2rem;
  }
  h2 {
    font-size: 1.1rem;
    margin: 1.5rem 0 0.5rem;
  }
  ul {
    padding-left: 1.25rem;
    margin: 0;
  }
  li {
    margin: 0.25rem 0;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    background: rgba(0, 0, 0, 0.06);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
  }

  @media (prefers-color-scheme: dark) {
    .tagline {
      color: #aaa;
    }
    code {
      background: rgba(255, 255, 255, 0.08);
    }
  }
</style>
```

- [ ] **Step 4: Replace `apps/web/src/lib/index.ts`**

This file proves the `@brewdial/shared` workspace dependency resolves end-to-end. Type-only re-exports incur no runtime cost, but `tsc` / `svelte-check` will fail if the workspace symlink is broken.

```ts
export type { RecipeCode, BrewMethod, FeedbackDoc } from '@brewdial/shared';
```

- [ ] **Step 5: Type-check**

```bash
pnpm --filter @brewdial/web check
```

Expected: `svelte-kit sync` runs, then `svelte-check` reports `0 errors and 0 warnings`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat: add BrewDial landing page and shared package import"
```

---

### Task 7: `/api/health` endpoint

**Files:**
- Create: `apps/web/src/routes/api/health/+server.ts`

- [ ] **Step 1: Create the endpoint**

```ts
import { json } from '@sveltejs/kit';

export const GET = () => {
  return json({
    ok: true,
    service: 'brewdial-web',
    version: '0.1.0'
  });
};
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @brewdial/web check
```

Expected: `0 errors and 0 warnings`.

- [ ] **Step 3: Smoke test the endpoint**

In one terminal:

```bash
pnpm dev
```

Wait for the line `Local: http://localhost:5173/`. In another terminal:

```bash
curl -s http://localhost:5173/api/health
```

Expected output (exactly):

```json
{"ok":true,"service":"brewdial-web","version":"0.1.0"}
```

Stop the dev server with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/api
git commit -m "feat: add /api/health endpoint"
```

---

### Task 8: Architecture decision record

**Files:**
- Create: `docs/decisions/0001-initial-architecture.md`

- [ ] **Step 1: Create the ADR**

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add docs/decisions
git commit -m "docs: add ADR 0001 for initial BrewDial architecture"
```

---

### Task 9: Project README

**Files:**
- Replace: `README.md`

- [ ] **Step 1: Replace `README.md`**

````markdown
# BrewDial

Agent-friendly coffee recipe and feedback dial-in system.

BrewDial records brewing recipes, captures tasting feedback, and helps humans
and agents iteratively dial in a brew. The system is agent-agnostic — it does
not assume any specific agent or client.

## Status

**Skeleton (PR1).** Repository layout, SvelteKit shell, shared types, and a
`/api/health` endpoint. CouchDB integration, MCP server, auth, and deployment
are intentionally deferred to later PRs.

## Planned architecture

```text
Mobile Web UI
  -> SvelteKit backend/API (apps/web)
    -> CouchDB

Hermes / OpenClaw / other agents
  -> BrewDial MCP server
    -> BrewDial web API
      -> CouchDB
```

Public service domain (planned): **`coffee.robinco.dev`**.

See [`docs/decisions/0001-initial-architecture.md`](docs/decisions/0001-initial-architecture.md) for full architectural rationale.

## Repository structure

```text
apps/
  web/               # @brewdial/web — SvelteKit app
packages/
  shared/            # @brewdial/shared — TypeScript types and helpers
docs/
  decisions/         # architecture decision records (ADRs)
  superpowers/       # design specs and implementation plans
```

## Local development

Requires Node ≥22 and pnpm 10.33.2 (pinned via `packageManager`).

```bash
pnpm install
pnpm dev      # starts apps/web on http://localhost:5173
pnpm check    # svelte-check + tsc --noEmit across workspaces
pnpm build    # builds apps/web
```

`pnpm test` and `pnpm lint` are intentional no-op stubs in PR1. ESLint and
Vitest will be wired up in a later PR.

## Health check

Once `pnpm dev` is running:

```bash
curl http://localhost:5173/api/health
# {"ok":true,"service":"brewdial-web","version":"0.1.0"}
```

## License

TBD.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for monorepo skeleton"
```

---

### Task 10: Final validation

**Files:** none — validation only.

- [ ] **Step 1: Clean install**

```bash
pnpm install
```

Expected: clean install, no errors, no lockfile churn beyond what's already committed.

- [ ] **Step 2: Run check across all workspaces**

```bash
pnpm check
```

Expected: both `@brewdial/shared` (`tsc --noEmit`) and `@brewdial/web` (`svelte-kit sync && svelte-check`) report no errors.

- [ ] **Step 3: Run build across all workspaces**

```bash
pnpm build
```

Expected: shared echoes the no-op message; web builds via `vite build` (output in `apps/web/.svelte-kit` and possibly `apps/web/build`). No errors.

- [ ] **Step 4: Run lint and test (no-op stubs)**

```bash
pnpm lint
pnpm test
```

Expected: each prints the no-op message in both workspaces and exits 0.

- [ ] **Step 5: Smoke test dev server**

```bash
pnpm dev
```

In a browser, visit:
- `http://localhost:5173/` — should render the BrewDial landing page with title, tagline, planned-components list, and a `/api/health` link.
- `http://localhost:5173/api/health` — should return `{"ok":true,"service":"brewdial-web","version":"0.1.0"}`.

Stop the server (Ctrl-C).

- [ ] **Step 6: Confirm working tree clean**

```bash
git status
```

Expected: nothing to commit (`pnpm-lock.yaml` may be untouched at this point — if validation modified it, commit it).

- [ ] **Step 7: Commit lockfile if modified**

```bash
if ! git diff --quiet pnpm-lock.yaml; then
  git add pnpm-lock.yaml
  git commit -m "chore: refresh pnpm-lock.yaml after final validation"
fi
```

---

### Task 11: Push branch and open PR

**Files:** none.

- [ ] **Step 1: Push the feature branch**

```bash
git push -u origin feat/project-skeleton
```

- [ ] **Step 2: Open the PR via `gh`**

```bash
gh pr create --base main --head feat/project-skeleton --title "feat: initialize brewdial project skeleton" --body "$(cat <<'EOF'
## Summary
- Initialized BrewDial pnpm monorepo
- Added SvelteKit web skeleton (`@brewdial/web`)
- Added shared TypeScript types and feedback rule helper (`@brewdial/shared`)
- Added `/api/health` endpoint
- Added initial architecture decision record (ADR 0001)

## Validation
- [x] `pnpm install`
- [x] `pnpm check`
- [x] `pnpm build`
- [x] Manual smoke test of `/` and `/api/health`

## Notes
- CouchDB integration intentionally deferred to PR2.
- MCP server intentionally deferred to a later PR.
- `pnpm lint` and `pnpm test` are intentional no-op stubs in PR1; ESLint and Vitest will be wired up in a later PR.
- `packageManager` pinned to `pnpm@10.33.2` for reproducibility.
EOF
)"
```

- [ ] **Step 3: Capture and share the PR URL**

`gh pr create` prints the PR URL on success. Share it back to the user.

---

## Self-review

| Check | Result |
| --- | --- |
| Spec coverage — every section of the source brief maps to a task | T1 cleanup, T2 root files, T3 shared, T4–T7 web app, T8 ADR, T9 README, T10 validation, T11 PR — all covered |
| Placeholder scan | The only `...sv version...` placeholders are in T5, where the engineer is explicitly told to copy versions verbatim from the sv-generated `package.json`. No other placeholders. |
| Type / name consistency | `RecipeCode`, `BrewMethod`, `FeedbackDoc`, `FeedbackRatings`, `summarizeFeedbackRatings`, `recipeCodePattern`, `isRecipeCode` are spelled identically across T3, T6, T8 references. |
| No-op script messages | Worded consistently across `@brewdial/shared` and `@brewdial/web`: `"<package>: no <task> in PR1 (intentional no-op)"`. |
| Constraints honored | No CouchDB / MCP / auth / deployment / Tailwind / Hermes-specific names anywhere. Branch is `feat/project-skeleton`. Existing remote `git@github.com:mgh3326/brewdial` reused. `packageManager` pinned to `pnpm@10.33.2`. |

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-26-pr1-project-skeleton.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
