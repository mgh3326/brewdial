# 0006 — xBloom reference recipe load (idempotency key)

## Status

Accepted (#589, xBloom chain 3/4). Builds on #587 (YAML mapper) and #588
(`status='reference'`, migration 007).

## Context

`packages/db/scripts/load-xbloom-reference.ts` loads the 25 xBloom Studio
recipes published at https://xbloom.lodywgumce.tv/ (17 hot + 8 iced) as
agent-only reference rows. Re-running it must never duplicate rows, and
1/4–2/4 added no column to carry a source identity.

## Decision

### Idempotency key: `recipes.bean_snapshot->>'sourceUrl'`

- The key is the **YAML URL**, normalized by `normalizeSourceUrl`
  (`packages/db/src/xbloom-reference.ts`): scheme/host/path lowercased, default
  port dropped, duplicate slashes collapsed, trailing slash, query and fragment
  removed. Every upsert looks a row up by this key only.
- `params`, `notes` (its `YAML:` line is display-only) and `intent` are never
  used to find a row.
- No new column or index (no migration in 3/4). The set is small, so lookup is a
  jsonb `->>` scan. A transaction-scoped advisory lock per key serializes
  concurrent runs. A key matching >1 row fails that item instead of picking one.

### Storage rules

`status='reference'`, `created_by='agent'`, `is_official=false`, `owner_id=null`,
`bean_id=null`, and no `beans` row. The `recipes_link_bean` INSERT trigger would
create a bean for an ownerless row carrying a snapshot. To avoid that, the loader
inserts with `bean_snapshot = null` and writes the snapshot with an UPDATE in the
same transaction.

- `title`: `[참조] <roaster> — <bean>[ ICE] (xBloom Omni <dose>g)`
- `notes`: the YAML `note` verbatim, then the mapper's `[xbloom …]` tag, then the
  lines `출처: <page URL>` and `YAML: <yaml URL>` (always the last two lines).
- `bean_snapshot` fields:
  - from the page: `name` (page title), `roaster`, `origin`, `process`,
    `roastLevel`, `notes` (tasting notes);
  - source fields: `sourceUrl` (the key), `sourcePageUrl`, `sourceYamlName`
    (`--verify` needs it because `title` is rewritten), and `sourceKind`
    (`hot` or `iced`).

### Mapper change (#587)

Real xbloom-ble files label only the first pour, so `pours[].label` is now
optional. An absent label is carried in the step tag as `label=""` and omitted
again on export.

## Running

```bash
# local DB only; the fetched raw files stay outside the repo
DATABASE_URL=... pnpm --filter @brewdial/db load:xbloom-reference --cache-dir /tmp/xb-cache
DATABASE_URL=... pnpm --filter @brewdial/db load:xbloom-reference --verify --expect 25 --cache-dir /tmp/xb-cache
```

- Requests are sequential, with at least `--delay-ms` (default 1500, minimum
  1000) between them. One full load is 43 requests: index, 17 pages, 25 YAML.
- Exit code = number of skipped items; `255` = fatal (bad args, a non-local DB
  without `--allow-remote-db`, migration 007 missing, index unreachable, or an
  `--expect` mismatch).
- Production runs need migration 007 applied first and operator approval.
- No site YAML or page HTML is committed (the site has no license notice). Tests
  use a self-authored mock site (`@brewdial/db/testing`).
