#!/usr/bin/env node
// ROB-1291 P1 — 컬리 원두 카탈로그 크롤 (T1, 브리프: rob1291-p1-crawl-20260819-1637)
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

const JOB_DIR = process.env.KURLY_JOB_DIR ?? path.join(
  process.env.HOME,
  "work/herdr-inbox/jobs/rob1291-p1-crawl-20260819-1637",
);
const RAW_DIR = path.join(JOB_DIR, "raw");
const LOG_PATH = path.join(JOB_DIR, "crawl.log");
const DATASET_PATH = path.join(JOB_DIR, "dataset.json");
const COVERAGE_PATH = path.join(JOB_DIR, "coverage.md");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const SEARCH_BASE = "https://api.kurly.com/search/v4/sites/market/normal-search";
const DETAIL_BASE = "https://api.kurly.com/showroom/v2/products";

const PRIMARY_KEYWORD = "원두";
const SUPPLEMENTAL_KEYWORDS = [
  "디카페인 원두",
  "스페셜티 원두",
  "블렌드 원두",
  "싱글오리진",
  "홀빈",
];

// 드립백·캡슐·티백·액상·파우더·스틱 — 상품명 기준 제외
const EXCLUDE_KEYWORDS = [
  "드립백",
  "드립 백",
  "캡슐",
  "티백",
  "액상",
  "파우더",
  "스틱",
];

const MIN_INTERVAL_MS = 320; // ≥300ms 여유
const BACKOFF_MS = [1000, 2000, 4000];

let lastRequestStartAt = 0;
let lastLoggedStartAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = lastRequestStartAt + MIN_INTERVAL_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestStartAt = Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function log(line) {
  const stamped = `${new Date().toISOString()} ${line}\n`;
  await appendFile(LOG_PATH, stamped, "utf8");
}

// 429/5xx 지수 백오프. 3회 실패 시 null 반환(호출부에서 skip 기록).
async function fetchJson(url, { retries = BACKOFF_MS.length } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle();
    const start = Date.now();
    const sinceLastStartMs = lastLoggedStartAt === 0 ? null : start - lastLoggedStartAt;
    lastLoggedStartAt = start;
    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA } });
    } catch (err) {
      await log(`GET ${url} start_interval_ms=${sinceLastStartMs} -> ERROR ${err.message} (attempt ${attempt + 1})`);
      if (attempt < retries) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      return { ok: false, status: null, body: null };
    }
    const durationMs = Date.now() - start;
    await log(`GET ${url} start_interval_ms=${sinceLastStartMs} -> ${res.status} (${durationMs}ms, attempt ${attempt + 1})`);

    if (res.status === 429 || res.status >= 500) {
      if (attempt < retries) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      return { ok: false, status: res.status, body: null };
    }

    if (!res.ok) {
      return { ok: false, status: res.status, body: null };
    }

    const body = await res.json();
    return { ok: true, status: res.status, body };
  }
  return { ok: false, status: null, body: null };
}

function matchesExclude(name) {
  return EXCLUDE_KEYWORDS.find((kw) => name.includes(kw)) ?? null;
}

async function searchKeyword(keyword) {
  const found = new Map(); // no -> {no, name, isSoldOut, reviewCount}
  let page = 1;
  let totalPages = 1;
  do {
    const url = `${SEARCH_BASE}?keyword=${encodeURIComponent(keyword)}&page=${page}&per_page=100&sort_type=1`;
    const { ok, body } = await fetchJson(url);
    if (!ok || !body?.success) {
      await log(`SEARCH FAIL keyword="${keyword}" page=${page}`);
      break;
    }
    const items = (body.data?.listSections ?? [])
      .flatMap((s) => s.data?.items ?? [])
      .filter((it) => typeof it === "object" && it !== null && "no" in it);
    for (const it of items) {
      if (!found.has(it.no)) {
        found.set(it.no, { no: it.no, name: it.name, isSoldOut: it.isSoldOut });
      }
    }
    totalPages = body.data?.meta?.pagination?.totalPages ?? 1;
    if (items.length === 0) break;
    page += 1;
  } while (page <= totalPages);
  return found;
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BREW_GUIDE_MARKERS = [
  "추출 가이드",
  "브루잉 가이드",
  "추출 레시피",
  "드립 레시피",
  "이렇게 즐겨보세요",
  "추출 방법",
  "브루잉 방법",
];

// 정규화만 — 해석/추론 없이, 상세 텍스트 중 가이드 마커 주변 구간만 그대로 발췌
function extractBrewGuideText(detailText) {
  for (const marker of BREW_GUIDE_MARKERS) {
    const idx = detailText.indexOf(marker);
    if (idx !== -1) {
      return detailText.slice(idx, idx + 800).trim();
    }
  }
  return null;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(LOG_PATH, "", "utf8"); // 새 크롤 시작 시 로그 초기화
  await log(`CRAWL START keywords=["${PRIMARY_KEYWORD}", ${SUPPLEMENTAL_KEYWORDS.map((k) => `"${k}"`).join(", ")}]`);

  const merged = new Map();
  for (const kw of [PRIMARY_KEYWORD, ...SUPPLEMENTAL_KEYWORDS]) {
    const res = await searchKeyword(kw);
    await log(`SEARCH DONE keyword="${kw}" found=${res.size}`);
    for (const [no, v] of res) {
      if (!merged.has(no)) merged.set(no, v);
    }
  }

  const excluded = [];
  const targets = [];
  for (const [no, v] of merged) {
    const matched = matchesExclude(v.name);
    if (matched) {
      excluded.push({ no, name: v.name, matched });
    } else {
      targets.push(v);
    }
  }

  await log(`FILTER DONE total_found=${merged.size} targets=${targets.length} excluded=${excluded.length}`);

  const products = [];
  const skipped = [];

  for (const target of targets) {
    const url = `${DETAIL_BASE}/${target.no}`;
    const { ok, body, status } = await fetchJson(url);
    if (!ok || !body?.data) {
      skipped.push({ no: target.no, name: target.name, reason: `detail fetch failed (status=${status})` });
      await log(`SKIP no=${target.no} reason=detail_fetch_failed status=${status}`);
      continue;
    }

    const data = body.data;
    await writeFile(path.join(RAW_DIR, `${target.no}.json`), JSON.stringify(body, null, 2), "utf8");

    const legacy = data.product_detail?.legacy_content ?? "";
    const content = data.product_detail?.content ?? "";
    const detailText = stripHtml(`${legacy} ${content}`);
    const imageOnly = detailText.length < 200;

    products.push({
      kurly_no: data.no,
      product_name: data.name,
      url: `https://www.kurly.com/goods/${data.no}`,
      review_count: data.review_count ?? null,
      is_sold_out: data.is_sold_out ?? null,
      deal_products: (data.deal_products ?? []).map((dp) => ({
        no: dp.no,
        name: dp.name,
        is_sold_out: dp.is_sold_out,
      })),
      detail_text: detailText,
      image_only: imageOnly,
      brew_guide_text: extractBrewGuideText(detailText),
    });
  }

  const dataset = {
    crawled_at: new Date().toISOString(),
    products,
  };
  await writeFile(DATASET_PATH, JSON.stringify(dataset, null, 2), "utf8");

  const skuTotal = products.reduce((acc, p) => acc + p.deal_products.length, 0);
  const imageOnlyCount = products.filter((p) => p.image_only).length;
  const countWith = (needle) => products.filter((p) => p.detail_text.includes(needle)).length;

  const coverage = `# ROB-1291 P1 — coverage

- 크롤 시각: ${dataset.crawled_at}
- 검색 키워드: ${PRIMARY_KEYWORD} (기본) + ${SUPPLEMENTAL_KEYWORDS.join(", ")} (보완)
- 검색 결과 총 dedup 상품 수(제외 전): ${merged.size}
- 최종 products 수: ${products.length}
- SKU(deal_products) 합계: ${skuTotal}
- image_only 상품 수 (detail_text < 200자): ${imageOnlyCount}
- "테이스팅 노트" 포함 상품 수: ${countWith("테이스팅 노트")}
- "가공법" 포함 상품 수: ${countWith("가공법")}
- "원산지" 포함 상품 수: ${countWith("원산지")}
- "배전도" 또는 "로스팅" 포함 상품 수: ${products.filter((p) => p.detail_text.includes("배전도") || p.detail_text.includes("로스팅")).length}
- skip 목록 (${skipped.length}건): ${skipped.length === 0 ? "0건" : ""}
${skipped.map((s) => `  - no=${s.no} name="${s.name}" reason=${s.reason}`).join("\n")}
- 제외 목록 (${excluded.length}건, 상품명 기준 드립백/캡슐/티백/액상/파우더/스틱): ${excluded.length === 0 ? "0건" : ""}
${excluded.map((e) => `  - no=${e.no} name="${e.name}" matched="${e.matched}"`).join("\n")}
`;
  await writeFile(COVERAGE_PATH, coverage, "utf8");

  await log(`CRAWL DONE products=${products.length} sku_total=${skuTotal} skipped=${skipped.length} excluded=${excluded.length}`);

  console.log(JSON.stringify({
    total_found: merged.size,
    targets: targets.length,
    products: products.length,
    sku_total: skuTotal,
    skipped: skipped.length,
    excluded: excluded.length,
  }, null, 2));
}

main().catch(async (err) => {
  await log(`FATAL ${err.stack ?? err.message}`);
  console.error(err);
  process.exit(1);
});
