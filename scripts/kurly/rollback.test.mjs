import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { buildRollbackPlan, generateRollbackBeansSql, generateRollbackLinksSql, readLedger, runDryRun } from "./rollback.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = path.join(HERE, "fixtures/ledger.sample.json");

let outDir;

beforeEach(async () => {
  outDir = await mkdtemp(path.join(tmpdir(), "kurly-rollback-test-"));
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

test("AC3: rollback plan lists archive/link/bean targets from the fixture ledger", async () => {
  const ledger = await readLedger(LEDGER_PATH);
  const plan = buildRollbackPlan(ledger);

  // only kurly:5052567 has a recipe_code in the ledger
  expect(plan.recipesToArchive).toEqual([{ bean_key: "kurly:5052567", code: "COF-0001" }]);

  // 1+1+1+2+1 = 6 links total in the ledger
  expect(plan.linkIdsToDelete).toHaveLength(6);

  // only created=true entries (the 3 create_new ones) are delete candidates
  expect(plan.beanIdsToDelete).toEqual([
    { bean_key: "kurly:5052567", bean_id: "bean-new-001" },
    { bean_key: "kurly:5051472", bean_id: "bean-new-002" },
    { bean_key: "kurly:5060542", bean_id: "bean-new-003" },
  ]);
});

test("AC3: created=false beans are never included in the deletion list", async () => {
  const ledger = await readLedger(LEDGER_PATH);
  const plan = buildRollbackPlan(ledger);
  const deletedIds = plan.beanIdsToDelete.map((b) => b.bean_id);
  expect(deletedIds).not.toContain("bean-existing-aaa");
  expect(deletedIds).not.toContain("bean-existing-bbb");

  const sql = generateRollbackBeansSql(plan.beanIdsToDelete);
  expect(sql).not.toContain("bean-existing-aaa");
  expect(sql).not.toContain("bean-existing-bbb");
  expect(sql).toContain("bean-new-001");
});

test("generateRollbackLinksSql produces a delete statement covering all link ids", async () => {
  const ledger = await readLedger(LEDGER_PATH);
  const plan = buildRollbackPlan(ledger);
  const sql = generateRollbackLinksSql(plan.linkIdsToDelete);
  expect(sql).toContain("delete from bean_purchase_links where id in");
  for (const l of plan.linkIdsToDelete) {
    expect(sql).toContain(l.link_id);
  }
});

test("AC7/AC4: rollback dry-run performs zero network calls (fetch stubbed to throw)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("fetch must never be called during rollback dry-run");
  };
  try {
    const result = await runDryRun({ ledgerPath: LEDGER_PATH, outDir });
    expect(result.mode).toBe("dry-run");
    expect(result.steps.recipes_to_archive.planned).toBe(1);
    expect(result.steps.links_to_delete.planned).toBe(6);
    expect(result.steps.beans_to_delete.planned).toBe(3);
    const beansSql = await readFile(path.join(outDir, "rollback-beans.sql"), "utf8");
    expect(beansSql).not.toContain("bean-existing-aaa");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
