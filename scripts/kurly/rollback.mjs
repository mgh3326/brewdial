#!/usr/bin/env node
// ROB-1291 P3 — 원장 기반 롤백 (T1, 브리프: rob1291-p3-loader-20260819-1703)
//
// 기본은 dry-run: SQL 파일은 생성하되(로컬 파일 쓰기), 실제 삭제/아카이브는 --execute 에서만.
// --execute 는 이 job에서 절대 호출하지 않는다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { API_BASE, requireAgentToken, sqlStr } from "./load.mjs";

export async function readLedger(ledgerPath) {
  if (!existsSync(ledgerPath)) return [];
  const raw = await readFile(ledgerPath, "utf8");
  if (raw.trim() === "") return [];
  return JSON.parse(raw);
}

// 원장에서 롤백 대상을 뽑는다. created=false(기존 행) bean은 절대 삭제 대상에 포함하지 않는다.
export function buildRollbackPlan(ledger) {
  const recipesToArchive = [];
  const linkIdsToDelete = [];
  const beanIdsToDelete = [];

  for (const entry of ledger) {
    for (const code of entry.recipe_codes ?? []) {
      recipesToArchive.push({ bean_key: entry.bean_key, code });
    }
    for (const linkId of entry.link_ids ?? []) {
      linkIdsToDelete.push({ bean_key: entry.bean_key, link_id: linkId });
    }
    if (entry.created === true) {
      beanIdsToDelete.push({ bean_key: entry.bean_key, bean_id: entry.bean_id });
    }
    // entry.created === false(기존 행)인 bean_id는 여기서 절대 추가하지 않는다 — 강제 보호.
  }

  return { recipesToArchive, linkIdsToDelete, beanIdsToDelete };
}

export function generateRollbackLinksSql(linkIdsToDelete) {
  if (linkIdsToDelete.length === 0) return "-- no purchase links to roll back\n";
  const ids = linkIdsToDelete.map((l) => sqlStr(l.link_id)).join(", ");
  return `-- ROB-1291 P3 rollback -- bean_purchase_links (${linkIdsToDelete.length}건)\ndelete from bean_purchase_links where id in (${ids});\n`;
}

export function generateRollbackBeansSql(beanIdsToDelete) {
  if (beanIdsToDelete.length === 0) return "-- no beans to roll back (created=true 대상 없음)\n";
  const ids = beanIdsToDelete.map((b) => sqlStr(b.bean_id)).join(", ");
  return (
    `-- ROB-1291 P3 rollback -- beans (${beanIdsToDelete.length}건, created=true만)\n` +
    "-- recipes.bean_id 는 FK on delete set null 이므로 삭제해도 레시피는 남고 bean_id만 null이 된다.\n" +
    `delete from beans where id in (${ids});\n`
  );
}

// ---------- CLI ----------

export function parseArgs(argv) {
  const args = { ledger: null, execute: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ledger") args.ledger = argv[++i];
    else if (a === "--execute") args.execute = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!args.ledger) throw new Error("--ledger <path> is required");
  return args;
}

export async function runDryRun({ ledgerPath, outDir }) {
  const ledger = await readLedger(ledgerPath);
  const plan = buildRollbackPlan(ledger);

  await mkdir(outDir, { recursive: true });
  const linksSqlPath = path.join(outDir, "rollback-links.sql");
  const beansSqlPath = path.join(outDir, "rollback-beans.sql");
  await writeFile(linksSqlPath, generateRollbackLinksSql(plan.linkIdsToDelete), "utf8");
  await writeFile(beansSqlPath, generateRollbackBeansSql(plan.beanIdsToDelete), "utf8");

  const output = {
    mode: "dry-run",
    ledger: ledgerPath,
    steps: {
      recipes_to_archive: { planned: plan.recipesToArchive.length, items: plan.recipesToArchive },
      links_to_delete: { planned: plan.linkIdsToDelete.length, items: plan.linkIdsToDelete, sql_path: linksSqlPath },
      beans_to_delete: { planned: plan.beanIdsToDelete.length, items: plan.beanIdsToDelete, sql_path: beansSqlPath },
    },
  };
  console.log(JSON.stringify(output, null, 2));
  return output;
}

// --execute: 이 job에서는 절대 호출하지 않음. P4/후속 오케스트레이션 소관.
export async function runExecute({ ledgerPath, outDir, worktreeRoot }) {
  const token = requireAgentToken(worktreeRoot);
  const ledger = await readLedger(ledgerPath);
  const plan = buildRollbackPlan(ledger);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "rollback-links.sql"), generateRollbackLinksSql(plan.linkIdsToDelete), "utf8");
  await writeFile(path.join(outDir, "rollback-beans.sql"), generateRollbackBeansSql(plan.beanIdsToDelete), "utf8");

  for (const item of plan.recipesToArchive) {
    const res = await fetch(`${API_BASE}/api/agent/recipes/${item.code}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: "archived" }),
    });
    if (!res.ok) throw new Error(`archive failed for ${item.code}: ${res.status}`);
  }

  return { mode: "execute", archived: plan.recipesToArchive.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.join(path.dirname(args.ledger), "out");
  if (args.execute) {
    const result = await runExecute({ ledgerPath: args.ledger, outDir, worktreeRoot: process.cwd() });
    console.log(JSON.stringify(result, null, 2));
  } else {
    await runDryRun({ ledgerPath: args.ledger, outDir });
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
