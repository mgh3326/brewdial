import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  buildPlan,
  filterEntries,
  generateBeansSql,
  parseBeansCsvOutput,
  readJson,
  readLedger,
  runDryRun,
} from "./load.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(HERE, "fixtures/manifest.sample.json");
const LEDGER_PATH = path.join(HERE, "fixtures/ledger.sample.json");

let outDir;

beforeEach(async () => {
  outDir = await mkdtemp(path.join(tmpdir(), "kurly-load-test-"));
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

test("fixture manifest has the shape AC1 expects", async () => {
  const manifest = await readJson(MANIFEST_PATH);
  const byAction = { create_new: 0, link_existing: 0, skip: 0 };
  let withRecipeDraft = 0;
  for (const e of manifest.entries) {
    byAction[e.action] += 1;
    if (e.recipe_draft) withRecipeDraft += 1;
  }
  expect(byAction.create_new).toBeGreaterThanOrEqual(3);
  expect(byAction.link_existing).toBeGreaterThanOrEqual(2);
  expect(byAction.skip).toBeGreaterThanOrEqual(1);
  expect(withRecipeDraft).toBeGreaterThanOrEqual(1);
});

test("dry-run plan counts match the fixture manifest (empty ledger)", async () => {
  const manifest = await readJson(MANIFEST_PATH);
  const plan = buildPlan(manifest, [], null);
  // 3 create_new
  expect(plan.beans.planned).toBe(3);
  // 1+1+1+2+1 = 6 links across 3 create_new + 2 link_existing
  expect(plan.purchase_links.planned).toBe(6);
  // only kurly:5052567 has recipe_draft
  expect(plan.recipes.planned).toBe(1);
  expect(plan.skipped_count).toBe(1);
  expect(plan.already_done_count).toBe(0);
});

test("AC2: pre-populated ledger makes a rerun of the same fixture planned=0", async () => {
  const manifest = await readJson(MANIFEST_PATH);
  const ledger = await readLedger(LEDGER_PATH);
  const plan = buildPlan(manifest, ledger, null);
  expect(plan.beans.planned).toBe(0);
  expect(plan.purchase_links.planned).toBe(0);
  expect(plan.recipes.planned).toBe(0);
  expect(plan.already_done_count).toBe(5); // 5 non-skip entries all already in ledger
});

test("--pilot N limits candidates to the top N create_new entries only", async () => {
  const manifest = await readJson(MANIFEST_PATH);
  const { candidates } = filterEntries(manifest, [], 2);
  expect(candidates).toHaveLength(2);
  expect(candidates.every((e) => e.action === "create_new")).toBe(true);
});

test("AC5: generated beans.sql contains the ON CONFLICT clause and an id/created resolution query", async () => {
  const manifest = await readJson(MANIFEST_PATH);
  const plan = buildPlan(manifest, [], null);
  const sql = generateBeansSql(plan.beans.entries);
  expect(sql).toContain("on conflict ((lower(name)), (coalesce(lower(roaster), ''))) do nothing");
  expect(sql).toContain("select bean_key, id, created from (");
  expect(sql).toContain("union all");
  // 3 create_new entries -> 3 insert CTEs
  expect(sql).toContain("ins_0 as (");
  expect(sql).toContain("ins_1 as (");
  expect(sql).toContain("ins_2 as (");
  // bean_key literal shows up for traceability
  expect(sql).toContain("'kurly:5052567'");
});

test("parseBeansCsvOutput reads bean_key,id,created rows back", () => {
  const csv = "bean_key,id,created\nkurly:5052567,abc-123,t\nkurly:5051472,def-456,f\n";
  const rows = parseBeansCsvOutput(csv);
  expect(rows).toEqual([
    { bean_key: "kurly:5052567", id: "abc-123", created: true },
    { bean_key: "kurly:5051472", id: "def-456", created: false },
  ]);
});

test("AC7/AC4: dry-run performs zero network calls (fetch stubbed to throw)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("fetch must never be called during dry-run");
  };
  try {
    const result = await runDryRun({ manifestPath: MANIFEST_PATH, ledgerPath: LEDGER_PATH, pilot: null, outDir });
    expect(result.mode).toBe("dry-run");
    expect(result.steps.beans.planned).toBe(0); // ledger.sample already covers all entries
    const sqlContent = await readFile(path.join(outDir, "beans.sql"), "utf8");
    expect(sqlContent).toContain("no create_new entries in this plan");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dry-run against an empty ledger also makes zero network calls and writes a non-trivial beans.sql", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("fetch must never be called during dry-run");
  };
  const emptyLedgerPath = path.join(outDir, "empty-ledger.json");
  await import("node:fs/promises").then((fs) => fs.writeFile(emptyLedgerPath, "[]", "utf8"));
  try {
    const result = await runDryRun({ manifestPath: MANIFEST_PATH, ledgerPath: emptyLedgerPath, pilot: null, outDir });
    expect(result.steps.beans.planned).toBe(3);
    const sqlContent = await readFile(path.join(outDir, "beans.sql"), "utf8");
    expect(sqlContent).toContain("on conflict");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
