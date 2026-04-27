# ROB-5 — Bean metadata and practical recipe entry flow

## Issue

Linear: ROB-5 — BrewDial: add bean metadata and practical recipe entry flow

## User reference recipe

The user wants to use BrewDial for real recipe entry starting with:

- Bean: Starbucks Blonde Espresso Roast
- Notes on bag: Blonde roast, smooth and sweet notes; Latin America blend; pairs well with milk but should work as a mellow V60 baseline
- Brewer: Hario V60
- Grinder: KINGrinder K6
- Dose: 40g

Suggested baseline recipe to include in docs/examples/tests if useful:

- Dose: 40g
- Water: 620g, filtered
- Ratio: 1:15.5
- Temperature: 92°C
- Grind: KINGrinder K6 around 90 clicks from zero; adjust +5–10 clicks if drawdown is too slow or bitter, -5 clicks if watery/sour
- V60 size: prefer 03 for 40g; 02 may be tight
- Rinse filter/preheat
- 0:00 bloom to 80g, swirl, wait until 0:45
- 0:45 pour to 240g
- 1:25 pour to 400g
- 2:10 pour to 520g
- 2:55 pour to 620g
- Gentle final swirl
- Target drawdown: 4:15–5:00
- Next adjustment: if bitter/roasty, lower temp to 90–91°C or coarsen; if thin/sour, grind slightly finer or extend ratio toward 1:15

## Goal

Make BrewDial practical for entering real recipes by adding bean metadata and brew setup fields to the recipe model, forms, API persistence, cards, and detail views.

## Scope

1. Extend recipe data model/schema with optional backward-compatible fields for bean metadata and practical setup, such as:
   - bean name
   - roaster/brand
   - roast level
   - origin/process or tasting notes if minimal
   - dose grams
   - water grams
   - temperature Celsius
   - grinder
   - grind setting
   - target drawdown/time
   - notes

2. Update create recipe validation/form mapping:
   - New fields should trim empty strings to undefined or safe empty values.
   - Numeric fields should validate positive/realistic values where existing validation style supports it.
   - Existing minimal recipe creation should still work.

3. Update `New recipe` UI:
   - Add practical sections for bean/setup.
   - Keep mobile-friendly layout.
   - Avoid adding a heavy component library.

4. Update recipe card/detail UI:
   - Show bean name and key setup fields when available.
   - Existing COF-0001 without metadata must still render safely.

5. Update API/repository tests and form tests.

## Non-goals

- No LLM calls in the web app.
- No recommendation engine.
- No MCP write tools yet.
- No auth/token/deployment changes.
- No CouchDB SDK or Mango index changes.
- No destructive migration of existing recipe documents.

## Validation

Run and report exact results:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
pnpm lint
```

If practical, run a live/local smoke with the existing CouchDB env to create a sample recipe using the Starbucks Blonde Espresso Roast 40g V60/K6 metadata. Do not print secrets.

## Acceptance criteria

- Existing recipe documents remain valid.
- A new recipe can persist and display bean/setup metadata.
- Cards and detail pages display the most useful metadata.
- Standard validation passes.
- No secrets or local user-specific paths are committed.

## AoE marker

When done, output:

```text
AOE_STATUS: implementation_done
AOE_ISSUE: ROB-5
AOE_ROLE: implementer
AOE_AGENT: opencode
AOE_TESTS: <exact verification summary>
AOE_NEXT: request_plan_review
```
