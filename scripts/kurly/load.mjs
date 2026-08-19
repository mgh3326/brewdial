#!/usr/bin/env node
// ROB-1291 P3 — 컬리 원두 매니페스트 → 프로덕션 적재 로더 (T1, 브리프: rob1291-p3-loader-20260819-1703)
//
// 기본은 dry-run: 네트워크·SSH·DB 접촉 없이 실행 계획만 출력한다.
// --execute 는 이 job에서 절대 호출하지 않는다 (P4에서 운영자 입회 하에 orch가 돌린다).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

export const SSH_KEY_PATH = path.join(os.homedir(), ".ssh/ssh-key-2026-06-23.key");
export const SSH_TARGET = "opc@140.245.33.121";
export const API_BASE = process.env.API_BASE_URL ?? "https://api.brewdial.robinco.dev";

const VALID_ACTIONS = new Set(["create_new", "link_existing", "skip"]);

// ---------- SQL 이스케이프 헬퍼 ----------

export function sqlStr(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function sqlNum(value) {
  if (value === null || value === undefined) return "null";
  return String(Number(value));
}

export function sqlBool(value) {
  if (value === null || value === undefined) return "null";
  return value ? "true" : "false";
}

export function sqlTextArray(arr) {
  if (!arr || arr.length === 0) return "null";
  const items = arr.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(",");
  return `array[${items}]::text[]`;
}

// ---------- beans.sql 생성 ----------

const BEAN_COLUMNS = [
  "name",
  "roaster",
  "origin",
  "process",
  "roast_level",
  "notes",
  "roast_level_ord",
  "acidity",
  "body",
  "decaf",
  "flavor_categories",
  "attrs_source",
  "source_url",
  "attrs_notes",
];

function beanValuesSql(entry) {
  const b = entry.bean ?? {};
  const a = entry.attrs ?? {};
  return [
    sqlStr(b.name),
    sqlStr(b.roaster),
    sqlStr(b.origin),
    sqlStr(b.process),
    sqlStr(b.roast_level),
    sqlStr(b.notes),
    sqlNum(a.roast_level_ord),
    sqlNum(a.acidity),
    sqlNum(a.body),
    sqlBool(a.decaf),
    sqlTextArray(a.flavor_categories),
    sqlStr(a.attrs_source),
    sqlStr(a.source_url),
    sqlStr(a.attrs_notes),
  ].join(", ");
}

function buildInsertCte(entry, i) {
  return `ins_${i} as (
  insert into beans (${BEAN_COLUMNS.join(", ")})
  values (${beanValuesSql(entry)})
  on conflict ((lower(name)), (coalesce(lower(roaster), ''))) do nothing
  returning id, created_at
)`;
}

function buildResolveSelect(entry, i) {
  const nameLit = sqlStr(entry.bean?.name ?? null);
  const roasterLit = sqlStr(entry.bean?.roaster ?? null);
  return `  select ${sqlStr(entry.bean_key)} as bean_key, id, true as created from ins_${i}
  union all
  select ${sqlStr(entry.bean_key)} as bean_key, b.id, false as created
  from beans b
  where lower(b.name) = lower(${nameLit})
    and coalesce(lower(b.roaster), '') = coalesce(lower(${roasterLit}), '')
    and not exists (select 1 from ins_${i})`;
}

// create_new 엔트리들을 하나의 SQL 스크립트로 결합: 각 엔트리를 insert CTE로 만들고,
// 최종 SELECT에서 엔트리별 id/created 여부를 한 번에 판별한다(ON CONFLICT DO NOTHING 기준 dedup).
export function generateBeansSql(entries) {
  if (entries.length === 0) {
    return "-- no create_new entries in this plan\n";
  }
  const header =
    "-- ROB-1291 P3 -- beans insert plan (" +
    entries.length +
    "건)\n" +
    "-- ON CONFLICT ((lower(name)), (coalesce(lower(roaster), ''))) DO NOTHING 기준 dedup\n" +
    "\\pset format csv\n\n";
  const ctes = entries.map((e, i) => buildInsertCte(e, i)).join(",\n");
  const selects = entries.map((e, i) => buildResolveSelect(e, i)).join("\n  union all\n");
  return `${header}with\n${ctes}\nselect bean_key, id, created from (\n${selects}\n) resolved\norder by bean_key;\n`;
}

// psql --csv 출력(bean_key,id,created 헤더)을 파싱한다. 단순 콤마 구분(우리 값에는 콤마/개행이 없음을 보장).
export function parseBeansCsvOutput(csvText) {
  let lines = csvText.trim().split("\n").filter((l) => l.length > 0);
  // \pset format csv 가 stdout에 "Output format is csv." 배너를 섞는다 — 헤더 행까지 스킵.
  const headerAt = lines.findIndex((l) => l.split(",").includes("bean_key"));
  if (headerAt === -1) throw new Error(`beans.sql csv header not found in output: ${lines[0] ?? "<empty>"}`);
  lines = lines.slice(headerAt);
  if (lines.length === 0) return [];
  const header = lines[0].split(",");
  const beanKeyIdx = header.indexOf("bean_key");
  const idIdx = header.indexOf("id");
  const createdIdx = header.indexOf("created");
  if (beanKeyIdx === -1 || idIdx === -1 || createdIdx === -1) {
    throw new Error(`unexpected beans.sql csv header: ${lines[0]}`);
  }
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    return {
      bean_key: cols[beanKeyIdx],
      id: cols[idIdx],
      created: cols[createdIdx] === "t" || cols[createdIdx] === "true",
    };
  });
}

// ---------- manifest / ledger ----------

export async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function readLedger(ledgerPath) {
  if (!existsSync(ledgerPath)) return [];
  const raw = await readFile(ledgerPath, "utf8");
  if (raw.trim() === "") return [];
  return JSON.parse(raw);
}

export async function writeLedger(ledgerPath, ledger) {
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2), "utf8");
}

// manifest entries를 액션(skip 제외)·원장 기록 여부·--pilot N(create_new 상위 N개 제한) 기준으로 필터링한다.
export function filterEntries(manifest, ledger, pilot) {
  const doneKeys = new Set(ledger.map((e) => e.bean_key));
  const skipped = [];
  const alreadyDone = [];
  let candidates = [];

  for (const entry of manifest.entries) {
    if (!VALID_ACTIONS.has(entry.action)) {
      throw new Error(`unknown action "${entry.action}" for bean_key=${entry.bean_key}`);
    }
    if (entry.action === "skip") {
      skipped.push(entry);
      continue;
    }
    if (doneKeys.has(entry.bean_key)) {
      alreadyDone.push(entry);
      continue;
    }
    candidates.push(entry);
  }

  if (pilot != null) {
    // pilot 모드: create_new 상위 N개 엔트리만 대상으로 제한한다(P4 파일럿용).
    // link_existing 엔트리는 파일럿 범위에서 제외한다 — 신규 bean 적재 경로만 소규모로 검증하는 것이
    // 파일럿의 목적이라고 판단(브리프에 link_existing 처리 여부가 명시되지 않아 자체 해석,
    // REPORT.md에 설계 특이사항으로 명시함).
    candidates = candidates.filter((e) => e.action === "create_new").slice(0, pilot);
  }

  return { candidates, skipped, alreadyDone };
}

function beanIdPlaceholder(entry) {
  return entry.action === "link_existing" ? entry.existing_bean_id : `<pending:${entry.bean_key}>`;
}

export function buildPlan(manifest, ledger, pilot) {
  const { candidates, skipped, alreadyDone } = filterEntries(manifest, ledger, pilot);
  const beanEntries = candidates.filter((e) => e.action === "create_new");

  const linkItems = candidates.flatMap((entry) =>
    (entry.purchase_links ?? []).map((link) => ({
      bean_key: entry.bean_key,
      bean_id: beanIdPlaceholder(entry),
      vendor: "컬리",
      url: link.url,
      link_category: "product",
    })),
  );

  const recipeItems = candidates
    .filter((entry) => entry.recipe_draft)
    .map((entry) => ({
      bean_key: entry.bean_key,
      bean_id: beanIdPlaceholder(entry),
      body: { ...entry.recipe_draft, beanId: beanIdPlaceholder(entry) },
    }));

  return {
    candidates,
    skipped_count: skipped.length,
    already_done_count: alreadyDone.length,
    beans: { planned: beanEntries.length, bean_keys: beanEntries.map((e) => e.bean_key), entries: beanEntries },
    purchase_links: { planned: linkItems.length, items: linkItems },
    recipes: { planned: recipeItems.length, items: recipeItems },
  };
}

// ---------- CLI 인자 ----------

export function parseArgs(argv) {
  const args = { manifest: null, ledger: null, execute: false, pilot: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--manifest") args.manifest = argv[++i];
    else if (a === "--ledger") args.ledger = argv[++i];
    else if (a === "--execute") args.execute = true;
    else if (a === "--pilot") args.pilot = Number(argv[++i]);
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!args.manifest) throw new Error("--manifest <path> is required");
  if (!args.ledger) throw new Error("--ledger <path> is required");
  return args;
}

// ---------- dry-run ----------

export async function runDryRun({ manifestPath, ledgerPath, pilot, outDir }) {
  const manifest = await readJson(manifestPath);
  const ledger = await readLedger(ledgerPath);
  const plan = buildPlan(manifest, ledger, pilot);

  await mkdir(outDir, { recursive: true });
  const beansSqlPath = path.join(outDir, "beans.sql");
  await writeFile(beansSqlPath, generateBeansSql(plan.beans.entries), "utf8");

  const output = {
    mode: "dry-run",
    manifest: manifestPath,
    ledger: ledgerPath,
    pilot: pilot ?? null,
    skipped_by_manifest: plan.skipped_count,
    already_in_ledger: plan.already_done_count,
    steps: {
      beans: { planned: plan.beans.planned, bean_keys: plan.beans.bean_keys },
      purchase_links: { planned: plan.purchase_links.planned, calls: plan.purchase_links.items },
      recipes: { planned: plan.recipes.planned, calls: plan.recipes.items },
    },
    beans_sql_path: beansSqlPath,
  };
  console.log(JSON.stringify(output, null, 2));
  return output;
}

// ---------- --execute (이 job에서는 절대 호출되지 않음. P4용 구현) ----------

function readEnvFile(envPath) {
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

export function requireAgentToken(worktreeRoot) {
  if (process.env.AGENT_TOKEN) return process.env.AGENT_TOKEN;
  const parsed = readEnvFile(path.join(worktreeRoot, ".env"));
  if (parsed.AGENT_TOKEN) return parsed.AGENT_TOKEN;
  throw new Error("AGENT_TOKEN not found in process.env or worktree .env");
}

// beans.sql을 ssh 경유 psql로 실행한다. --execute 에서만 호출되며, 이 job에서는 절대 실행하지 않는다.
function execBeansSqlViaSsh(sql) {
  // DSN은 박스의 /etc/brewdial/api.env에만 있다 (원격 셸 env에 없음) — sudo로 읽어 psql에 넘긴다.
  const result = spawnSync("ssh", ["-i", SSH_KEY_PATH, SSH_TARGET, 'DSN=$(sudo grep ^DATABASE_URL /etc/brewdial/api.env | cut -d= -f2-); psql "$DSN" -v ON_ERROR_STOP=1 -f -'], {
    input: sql,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`beans.sql execution failed: ${result.stderr}`);
  }
  return result.stdout;
}

async function fetchJsonOrThrow(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${opts?.method ?? "GET"} ${url} -> ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

export async function runExecute({ manifestPath, ledgerPath, pilot, outDir, worktreeRoot }) {
  const token = requireAgentToken(worktreeRoot);
  const manifest = await readJson(manifestPath);
  const ledger = await readLedger(ledgerPath);
  const plan = buildPlan(manifest, ledger, pilot);

  await mkdir(outDir, { recursive: true });
  const beansSql = generateBeansSql(plan.beans.entries);
  const beansSqlPath = path.join(outDir, "beans.sql");
  await writeFile(beansSqlPath, beansSql, "utf8");

  const beanIdMap = new Map();
  for (const entry of plan.candidates) {
    if (entry.action === "link_existing") beanIdMap.set(entry.bean_key, { id: entry.existing_bean_id, created: false });
  }
  if (plan.beans.entries.length > 0) {
    const csvOut = execBeansSqlViaSsh(beansSql);
    for (const row of parseBeansCsvOutput(csvOut)) {
      beanIdMap.set(row.bean_key, { id: row.id, created: row.created });
    }
  }

  for (const entry of plan.candidates) {
    const resolved = beanIdMap.get(entry.bean_key);
    if (!resolved) throw new Error(`no bean id resolved for ${entry.bean_key}`);
    const linkIds = [];
    for (const link of entry.purchase_links ?? []) {
      const existing = await fetchJsonOrThrow(`${API_BASE}/api/beans/${resolved.id}/purchase-links`);
      const already = (existing?.links ?? existing ?? []).some((l) => l.url === link.url);
      if (already) continue;
      const created = await fetchJsonOrThrow(`${API_BASE}/api/agent/beans/${resolved.id}/purchase-links`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ vendor: "컬리", url: link.url, linkCategory: "product" }),
      });
      linkIds.push(created.id);
    }

    const recipeCodes = [];
    if (entry.recipe_draft) {
      const created = await fetchJsonOrThrow(`${API_BASE}/api/agent/recipes`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...entry.recipe_draft, beanId: resolved.id }),
      });
      recipeCodes.push(created.code);
    }

    ledger.push({
      bean_key: entry.bean_key,
      bean_id: resolved.id,
      created: resolved.created,
      link_ids: linkIds,
      recipe_codes: recipeCodes,
    });
    await writeLedger(ledgerPath, ledger);
  }

  return { mode: "execute", processed: plan.candidates.length };
}

// ---------- entrypoint ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.join(path.dirname(args.manifest), "out");
  if (args.execute) {
    const worktreeRoot = process.cwd();
    const result = await runExecute({ manifestPath: args.manifest, ledgerPath: args.ledger, pilot: args.pilot, outDir, worktreeRoot });
    console.log(JSON.stringify(result, null, 2));
  } else {
    await runDryRun({ manifestPath: args.manifest, ledgerPath: args.ledger, pilot: args.pilot, outDir });
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
