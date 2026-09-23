// #589: load xBloom reference recipes from https://xbloom.lodywgumce.tv/ (xBloom chain 3/4).
//
// Flow: site index → /recipes/<slug>/ pages → every `/r/<name>.yaml` download link
// on a page (hot recipe + optional "Iced" section) → #587 mapper (fromXBloomYaml)
// → idempotent upsert as a status='reference' recipe.
//
// ── Idempotency key (finalized in this task) ────────────────────────────────
// The ONE place a loaded row's identity lives is `recipes.bean_snapshot->>'sourceUrl'`,
// holding `normalizeSourceUrl(<YAML URL>)`. Neither params, notes (the `YAML:` line
// is display only) nor intent are ever read to find a row. Normalization is
// deterministic: scheme/host/path lowercased, default port dropped, duplicate
// slashes collapsed, trailing slash, query and fragment removed. (Site slugs are
// lowercase kebab-case, so lowercasing the path cannot merge two real files.)
// No column/index was added (no migration in 3/4): the 25-row reference set
// is found by a jsonb ->> scan, serialized per key with a transaction-scoped
// advisory lock so two concurrent runs cannot both insert the same key.
//
// ── Storage rules ───────────────────────────────────────────────────────────
// status='reference', created_by='agent', is_official=false, owner_id=null,
// bean_id=null and NO beans row: the recipes_link_bean BEFORE INSERT trigger
// would find_or_create_bean() for any ownerless row carrying a bean_snapshot,
// so the row is inserted with bean_snapshot NULL and the snapshot is written by
// an UPDATE in the same transaction (the link trigger is INSERT-only).
// title   = `[참조] <roaster> — <bean>[ ICE] (xBloom Omni <dose>g)`
// notes   = mapper notes (YAML `note` verbatim + `[xbloom …]` recipe tag)
//           + `\n출처: <page URL>` + `\nYAML: <yaml URL>` (always the final two lines)
// bean_snapshot = name (page title), roaster, origin/process/roastLevel (page spec
//           line, when parseable), notes (tasting notes) + source fields:
//           sourceUrl (the key), sourcePageUrl, sourceYamlName (YAML `name`,
//           needed by --verify since title is rewritten), sourceKind hot|iced.

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { sql, type Kysely } from 'kysely'
import { parse } from 'yaml'
import { fromXBloomYaml, toXBloomYaml, type BeanSnapshot, type RecipeParams, type RecipeStep } from '@brewdial/shared'
import type { DB } from './types.js'

export const XBLOOM_REFERENCE_SITE = 'https://xbloom.lodywgumce.tv/'
export const MIN_SITE_DELAY_MS = 1000
/** Exit code when the run cannot even enumerate items (index/DB precondition). */
export const FATAL_EXIT_CODE = 255

// ── URL normalization (idempotency key) ─────────────────────────────────────

export function normalizeSourceUrl(raw: string, base?: string): string {
  const u = new URL(raw.trim(), base)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error(`unsupported source URL scheme: ${u.protocol}`)
  }
  let path = u.pathname.toLowerCase().replace(/\/{2,}/g, '/')
  if (path.length > 1) path = path.replace(/\/+$/, '')
  return `${u.protocol}//${u.host.toLowerCase()}${path}`
}

/** Canonical page URL — same normalization, but keeps the site's trailing `/`. */
function canonicalPageUrl(raw: string, base?: string): string {
  const key = normalizeSourceUrl(raw, base)
  return key.endsWith('/') ? key : `${key}/`
}

// ── polite sequential fetcher ───────────────────────────────────────────────

export type FetchResult = { ok: true; text: string; fromCache: boolean } | { ok: false; reason: string }

export interface PoliteFetcherOptions {
  /** Minimum gap between the END of one request and the START of the next. */
  delayMs: number
  fetchImpl?: typeof fetch
  userAgent?: string
  timeoutMs?: number
  /** Directory (outside the repo) where fetched bodies are stored. */
  cacheDir?: string
  /** Serve from cacheDir only; never touch the network. */
  offline?: boolean
  /** Read cacheDir first and only fetch on a miss (used by --verify). */
  preferCache?: boolean
}

export class PoliteFetcher {
  /** Network requests actually sent (cache hits are not counted). */
  requests = 0
  readonly log: Array<{ url: string; status: number | 'error'; startedAt: number; endedAt: number }> = []
  private lastEnd = Number.NEGATIVE_INFINITY
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly opts: PoliteFetcherOptions) {}

  /** Sequential by construction: calls are chained, so at most one request is in flight. */
  getText(url: string): Promise<FetchResult> {
    const run = this.queue.then(() => this.fetchOne(url))
    this.queue = run.catch(() => undefined)
    return run
  }

  private cachePath(url: string): string | undefined {
    if (!this.opts.cacheDir) return undefined
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 16)
    const tail = (new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'index').replace(/[^a-z0-9._-]/gi, '_')
    return join(this.opts.cacheDir, `${hash}-${tail}`)
  }

  private async fetchOne(url: string): Promise<FetchResult> {
    const cachePath = this.cachePath(url)
    if (cachePath && (this.opts.offline || this.opts.preferCache)) {
      try {
        return { ok: true, text: await readFile(cachePath, 'utf8'), fromCache: true }
      } catch {
        if (this.opts.offline) return { ok: false, reason: `not in cache (offline): ${url}` }
      }
    } else if (this.opts.offline) {
      return { ok: false, reason: 'offline mode requires a cache dir' }
    }

    const wait = this.lastEnd + this.opts.delayMs - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    const fetchImpl = this.opts.fetchImpl ?? fetch
    const startedAt = Date.now()
    this.requests += 1
    try {
      const res = await fetchImpl(url, {
        headers: { 'user-agent': this.opts.userAgent ?? 'brewdial-reference-loader/1 (#589)' },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
        redirect: 'follow',
      })
      const text = await res.text()
      this.lastEnd = Date.now()
      this.log.push({ url, status: res.status, startedAt, endedAt: this.lastEnd })
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
      if (cachePath) {
        await mkdir(this.opts.cacheDir!, { recursive: true })
        await writeFile(cachePath, text, 'utf8')
      }
      return { ok: true, text, fromCache: false }
    } catch (err) {
      this.lastEnd = Date.now()
      this.log.push({ url, status: 'error', startedAt, endedAt: this.lastEnd })
      return { ok: false, reason: `fetch failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
}

// ── HTML parsing (site structure: zensical/mkdocs article) ──────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', para: '' }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function htmlText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

/** Recipe page URLs linked from the site index (deduplicated, in page order). */
export function extractRecipePageUrls(indexHtml: string, siteUrl: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of indexHtml.matchAll(/href="([^"]+)"/g)) {
    const href = decodeEntities(m[1])
    let url: URL
    try {
      url = new URL(href, siteUrl)
    } catch {
      continue
    }
    if (url.origin !== new URL(siteUrl).origin) continue
    if (!/^\/recipes\/[a-z0-9][a-z0-9._-]*\/?$/i.test(url.pathname)) continue
    const page = canonicalPageUrl(url.href)
    if (!seen.has(page)) {
      seen.add(page)
      out.push(page)
    }
  }
  return out
}

export interface ReferenceSection {
  yamlUrl: string // normalized (the idempotency key)
  heading: string
  iced: boolean
}

export interface ReferencePage {
  pageUrl: string
  title: string // h1 text, e.g. "Roaster — Bean"
  roaster: string
  beanName: string
  origin?: string
  process?: string
  roastLevel?: string
  tastingNotes?: string
  sections: ReferenceSection[]
}

const PROCESS_RE =
  /\b(washed|natural|honey|anaerobic|ferment\w*|co-?ferment\w*|carbonic|wet[- ]hulled|semi[- ]washed|pulped|decaf\w*|infused|macerat\w*|thermal\w*|yeast|double|giling)\b/i

export function parseRecipePage(html: string, pageUrl: string): ReferencePage {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  if (!h1) throw new Error('page has no <h1> title')
  const title = htmlText(h1[1])
  const dash = title.indexOf(' — ')
  if (dash <= 0) throw new Error(`page title is not "Roaster — Bean": ${JSON.stringify(title)}`)
  const roaster = title.slice(0, dash).trim()
  const beanName = title.slice(dash + 3).trim()
  if (!roaster || !beanName) throw new Error(`page title is not "Roaster — Bean": ${JSON.stringify(title)}`)

  const page: ReferencePage = { pageUrl: canonicalPageUrl(pageUrl), title, roaster, beanName, sections: [] }

  // Spec line: <p><strong>Country · Region · Variety · process · roast</strong></p>
  const afterH1 = html.slice(h1.index + h1[0].length)
  const spec = /<p>\s*<strong>([^<]*·[^<]*)<\/strong>\s*<\/p>/i.exec(afterH1)
  if (spec) {
    const segs = htmlText(spec[1]).split('·').map((s) => s.trim()).filter(Boolean)
    const roastSeg = segs.find((s) => /\broast\b/i.test(s))
    if (roastSeg) page.roastLevel = roastSeg.replace(/\s*\broast(ed)?\b\s*$/i, '').trim() || roastSeg
    const processSeg = segs.find((s) => s !== roastSeg && PROCESS_RE.test(s))
    if (processSeg) page.process = processSeg
    if (segs[0] && segs[0] !== roastSeg && segs[0] !== processSeg) page.origin = segs[0]
  }

  const notes = /<p>\s*<strong>\s*Notes:\s*<\/strong>([\s\S]*?)<\/p>/i.exec(html)
  if (notes) {
    const t = htmlText(notes[1])
    if (t) page.tastingNotes = t
  }

  // Every /r/<file>.yaml link, attributed to the nearest preceding h1/h2 heading.
  const headings = [...html.matchAll(/<h([12])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({
    at: m.index ?? 0,
    text: htmlText(m[2]),
  }))
  const seen = new Set<string>()
  const siteOrigin = new URL(pageUrl).origin
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>/gi)) {
    let url: URL
    try {
      url = new URL(decodeEntities(m[1]), pageUrl)
    } catch {
      continue
    }
    // Same-origin only: a foreign link would bypass the https/--site rules and
    // produce a row --verify (which scans by site origin) never sees.
    if (url.origin !== siteOrigin || !/^\/r\/[^/]+\.ya?ml$/i.test(url.pathname)) continue
    const yamlUrl = normalizeSourceUrl(url.href)
    if (seen.has(yamlUrl)) continue
    seen.add(yamlUrl)
    const at = m.index ?? 0
    const heading = headings.filter((h) => h.at < at).pop()?.text ?? title
    const iced = /^ice[ds]?\b/i.test(heading) || /-ice[ds]?\.ya?ml$/i.test(url.pathname)
    page.sections.push({ yamlUrl, heading, iced })
  }
  return page
}

// ── record building ─────────────────────────────────────────────────────────

export interface ReferenceBeanSnapshot extends BeanSnapshot {
  sourceUrl: string
  sourcePageUrl: string
  sourceYamlName: string
  sourceKind: 'hot' | 'iced'
}

export interface ReferenceRecord {
  sourceUrl: string
  method: 'other'
  title: string
  params: RecipeParams
  steps: RecipeStep[]
  notes: string
  beanSnapshot: ReferenceBeanSnapshot
}

export function sourceLinesSuffix(pageUrl: string, yamlUrl: string): string {
  return `\n출처: ${pageUrl}\nYAML: ${yamlUrl}`
}

/** Inverse of the notes suffix; null when the stored notes do not end with it. */
export function stripSourceLines(notes: string, pageUrl: string, yamlUrl: string): string | null {
  const suffix = sourceLinesSuffix(pageUrl, yamlUrl)
  return notes.endsWith(suffix) ? notes.slice(0, -suffix.length) : null
}

function fmtNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
}

export function referenceTitle(roaster: string, beanName: string, doseG: number, iced: boolean): string {
  return `[참조] ${roaster} — ${beanName}${iced ? ' ICE' : ''} (xBloom Omni ${fmtNumber(doseG)}g)`
}

export function buildReferenceRecord(page: ReferencePage, section: ReferenceSection, yamlText: string): ReferenceRecord {
  const input = fromXBloomYaml(yamlText) // throws XBloomValidationError / YAML errors
  const raw = parse(yamlText) as { name: string; dose_g: number }
  const beanSnapshot: ReferenceBeanSnapshot = {
    name: page.title,
    roaster: page.roaster,
    sourceUrl: section.yamlUrl,
    sourcePageUrl: page.pageUrl,
    sourceYamlName: raw.name,
    sourceKind: section.iced ? 'iced' : 'hot',
  }
  if (page.origin) beanSnapshot.origin = page.origin
  if (page.process) beanSnapshot.process = page.process
  if (page.roastLevel) beanSnapshot.roastLevel = page.roastLevel
  if (page.tastingNotes) beanSnapshot.notes = page.tastingNotes
  return {
    sourceUrl: section.yamlUrl,
    method: 'other',
    title: referenceTitle(page.roaster, page.beanName, raw.dose_g, section.iced),
    params: input.params ?? {},
    steps: input.steps ?? [],
    notes: `${input.notes ?? ''}${sourceLinesSuffix(page.pageUrl, section.yamlUrl)}`,
    beanSnapshot,
  }
}

// ── DB ──────────────────────────────────────────────────────────────────────

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', ''])

/**
 * Where a DATABASE_URL really connects. pg lets `?host=` override the URL
 * hostname (a leading `/` = unix socket dir), so locality is decided from that
 * effective host only.
 */
export function describeDatabaseUrl(raw: string): { label: string; local: boolean } {
  const u = new URL(raw)
  const host = u.searchParams.get('host') ?? u.hostname
  const local = host.startsWith('/') || LOCAL_DB_HOSTS.has(host)
  const port = u.searchParams.get('port') ?? u.port
  return { label: `${u.pathname.replace(/^\//, '')} @ ${host}${port ? `:${port}` : ''}`, local }
}

/** Fails unless migration 007 (status='reference' in recipes_status_check) is applied. */
export async function assertReferenceStatusSupported(db: Kysely<DB>): Promise<void> {
  const r = await sql<{ def: string }>`
    select pg_get_constraintdef(oid) as def from pg_constraint
    where conname = 'recipes_status_check' and conrelid = 'recipes'::regclass`.execute(db)
  const def = r.rows[0]?.def ?? ''
  if (!def.includes("'reference'")) {
    throw new Error(
      `recipes_status_check does not allow 'reference' (migration 007 not applied?): ${def || '<missing>'}`,
    )
  }
}

export type UpsertOutcome = 'inserted' | 'updated' | 'unchanged'

/** Idempotent upsert keyed on bean_snapshot->>'sourceUrl' (see header). */
export async function upsertReferenceRecipe(
  db: Kysely<DB>,
  rec: ReferenceRecord,
): Promise<{ outcome: UpsertOutcome; code: string }> {
  const key = rec.sourceUrl
  const params = JSON.stringify(rec.params)
  const steps = JSON.stringify(rec.steps)
  const snapshot = JSON.stringify({ ...rec.beanSnapshot, sourceUrl: key })
  return db.transaction().execute(async (trx) => {
    // Guard trigger: without this flag an INSERT is forced to created_by='manual'.
    await sql`select set_config('bd.owner_write_ok','on',true)`.execute(trx)
    await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 589))`.execute(trx)
    const existing = await sql<{ id: string; code: string }>`
      select id, code from recipes where bean_snapshot->>'sourceUrl' = ${key}
      order by created_at, id for update`.execute(trx)
    if (existing.rows.length > 1) {
      throw new Error(`duplicate rows for ${key}: ${existing.rows.map((r) => r.code).join(', ')}`)
    }
    if (existing.rows.length === 0) {
      // bean_snapshot NULL on INSERT so recipes_link_bean does not create a beans row.
      const ins = await sql<{ id: string; code: string }>`
        insert into recipes (method, title, version, params, steps, notes, bean_id, bean_snapshot,
                             created_by, status, is_official, owner_id)
        values (${rec.method}, ${rec.title}, 1, ${params}::jsonb, ${steps}::jsonb, ${rec.notes}, null, null,
                'agent', 'reference', false, null)
        returning id, code`.execute(trx)
      const row = ins.rows[0]
      await sql`update recipes set bean_snapshot = ${snapshot}::jsonb where id = ${row.id}`.execute(trx)
      return { outcome: 'inserted' as const, code: row.code }
    }
    const { id, code } = existing.rows[0]
    const upd = await sql<{ id: string }>`
      update recipes set
        method = ${rec.method}, title = ${rec.title}, params = ${params}::jsonb, steps = ${steps}::jsonb,
        notes = ${rec.notes}, bean_snapshot = ${snapshot}::jsonb, bean_id = null,
        created_by = 'agent', status = 'reference', is_official = false, owner_id = null
      where id = ${id}
        and (method, title, params, steps, notes, bean_snapshot, bean_id, created_by, status, is_official, owner_id)
            is distinct from
            (${rec.method}::text, ${rec.title}::text, ${params}::jsonb, ${steps}::jsonb, ${rec.notes}::text,
             ${snapshot}::jsonb, null::text, 'agent'::text, 'reference'::text, false, null::uuid)
      returning id`.execute(trx)
    return { outcome: upd.rows.length > 0 ? ('updated' as const) : ('unchanged' as const), code }
  })
}

// ── load ────────────────────────────────────────────────────────────────────

export interface LoadItemResult {
  url: string
  outcome: UpsertOutcome | 'failed'
  code?: string
  title?: string
  reason?: string
}

export interface LoadSummary {
  pages: number
  items: LoadItemResult[]
  inserted: number
  updated: number
  unchanged: number
  failed: number
  requests: number
  fatal?: string
  exitCode: number
}

export interface LoadOptions {
  siteUrl?: string
  fetcher: PoliteFetcher
  log?: (line: string) => void
}

/** Exit code: fatal → 255; otherwise the number of failed items (0 = all loaded), capped at 254. */
export function exitCodeFor(failed: number, fatal?: string): number {
  return fatal ? FATAL_EXIT_CODE : Math.min(failed, FATAL_EXIT_CODE - 1)
}

export async function loadXBloomReferences(db: Kysely<DB>, opts: LoadOptions): Promise<LoadSummary> {
  const siteUrl = opts.siteUrl ?? XBLOOM_REFERENCE_SITE
  const log = opts.log ?? (() => {})
  const items: LoadItemResult[] = []
  const finish = (pages: number, fatal?: string): LoadSummary => {
    const count = (o: LoadItemResult['outcome']) => items.filter((i) => i.outcome === o).length
    const failed = count('failed')
    return {
      pages,
      items,
      inserted: count('inserted'),
      updated: count('updated'),
      unchanged: count('unchanged'),
      failed,
      requests: opts.fetcher.requests,
      ...(fatal ? { fatal } : {}),
      exitCode: exitCodeFor(failed, fatal),
    }
  }

  try {
    await assertReferenceStatusSupported(db)
  } catch (err) {
    return finish(0, err instanceof Error ? err.message : String(err))
  }

  const index = await opts.fetcher.getText(siteUrl)
  if (!index.ok) return finish(0, `index ${siteUrl}: ${index.reason}`)
  const pageUrls = extractRecipePageUrls(index.text, siteUrl)
  if (pageUrls.length === 0) return finish(0, `index ${siteUrl}: no /recipes/<slug>/ links found`)
  log(`index: ${pageUrls.length} recipe pages`)

  const done = new Set<string>()
  for (const pageUrl of pageUrls) {
    const pageRes = await opts.fetcher.getText(pageUrl)
    if (!pageRes.ok) {
      items.push({ url: pageUrl, outcome: 'failed', reason: `page: ${pageRes.reason}` })
      log(`FAIL page ${pageUrl}: ${pageRes.reason}`)
      continue
    }
    let page: ReferencePage
    try {
      page = parseRecipePage(pageRes.text, pageUrl)
      if (page.sections.length === 0) throw new Error('no /r/*.yaml download links')
    } catch (err) {
      const reason = `page parse: ${err instanceof Error ? err.message : String(err)}`
      items.push({ url: pageUrl, outcome: 'failed', reason })
      log(`FAIL page ${pageUrl}: ${reason}`)
      continue
    }
    for (const section of page.sections) {
      if (done.has(section.yamlUrl)) continue
      done.add(section.yamlUrl)
      const yamlRes = await opts.fetcher.getText(section.yamlUrl)
      if (!yamlRes.ok) {
        items.push({ url: section.yamlUrl, outcome: 'failed', reason: `yaml: ${yamlRes.reason}` })
        log(`FAIL ${section.yamlUrl}: ${yamlRes.reason}`)
        continue
      }
      try {
        const rec = buildReferenceRecord(page, section, yamlRes.text)
        const { outcome, code } = await upsertReferenceRecipe(db, rec)
        items.push({ url: section.yamlUrl, outcome, code, title: rec.title })
        log(`${outcome.padEnd(9)} ${code} ${rec.title}`)
      } catch (err) {
        const reason = `${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`
        items.push({ url: section.yamlUrl, outcome: 'failed', reason })
        log(`FAIL ${section.yamlUrl}: ${reason}`)
      }
    }
  }
  return finish(pageUrls.length)
}

// ── verify (roundtrip: row → toXBloomYaml → deep-equal original YAML) ────────

export interface VerifyItemResult {
  code: string
  sourceUrl: string
  ok: boolean
  reasons: string[]
}

export interface VerifySummary {
  rows: number
  passed: number
  failed: number
  items: VerifyItemResult[]
  requests: number
  countMismatch?: string
  exitCode: number
}

function diffPaths(a: unknown, b: unknown, path = '$', out: string[] = []): string[] {
  if (out.length >= 5) return out
  if (isDeepStrictEqual(a, b)) return out
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out)
    }
    return out
  }
  out.push(`${path}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`)
  return out
}

interface VerifyRow {
  code: string
  title: string
  params: RecipeParams
  steps: RecipeStep[]
  notes: string | null
  bean_snapshot: ReferenceBeanSnapshot
  bean_id: string | null
  status: string
  created_by: string
  is_official: boolean
  owner_id: string | null
}

export async function verifyXBloomReferences(
  db: Kysely<DB>,
  opts: { siteUrl?: string; fetcher: PoliteFetcher; expect?: number },
): Promise<VerifySummary> {
  const origin = normalizeSourceUrl(opts.siteUrl ?? XBLOOM_REFERENCE_SITE).replace(/\/$/, '')
  // Every row carrying a key under this site — regardless of status, so a row
  // whose storage rules drifted is checked (and failed) rather than skipped.
  const res = await sql<VerifyRow>`
    select code, title, params, steps, notes, bean_snapshot, bean_id, status, created_by, is_official, owner_id
    from recipes where bean_snapshot->>'sourceUrl' like ${`${origin}/%`}
    order by bean_snapshot->>'sourceUrl', code`.execute(db)
  const items: VerifyItemResult[] = []
  for (const row of res.rows) {
    const snap = row.bean_snapshot
    const reasons: string[] = []
    if (row.status !== 'reference') reasons.push(`status=${row.status} (want reference)`)
    if (row.created_by !== 'agent') reasons.push(`created_by=${row.created_by} (want agent)`)
    if (row.is_official !== false) reasons.push('is_official=true (want false)')
    if (row.owner_id !== null) reasons.push('owner_id set (want null)')
    if (row.bean_id !== null) reasons.push(`bean_id=${row.bean_id} (want null)`)
    const notes = stripSourceLines(row.notes ?? '', snap.sourcePageUrl, snap.sourceUrl)
    if (notes === null) reasons.push('notes do not end with the 출처:/YAML: source lines')
    const original = await opts.fetcher.getText(snap.sourceUrl)
    if (!original.ok) {
      reasons.push(`original yaml: ${original.reason}`)
    } else if (notes !== null) {
      try {
        const expected: unknown = parse(original.text)
        const actual: unknown = parse(
          toXBloomYaml({ title: snap.sourceYamlName, params: row.params, steps: row.steps, notes }),
        )
        if (!isDeepStrictEqual(actual, expected)) {
          reasons.push(`roundtrip mismatch: ${diffPaths(actual, expected).join('; ')}`)
        }
      } catch (err) {
        reasons.push(`roundtrip error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    items.push({ code: row.code, sourceUrl: snap.sourceUrl, ok: reasons.length === 0, reasons })
  }
  const failed = items.filter((i) => !i.ok).length
  const countMismatch =
    opts.expect !== undefined && opts.expect !== items.length
      ? `expected ${opts.expect} reference rows, found ${items.length}`
      : undefined
  return {
    rows: items.length,
    passed: items.length - failed,
    failed,
    items,
    requests: opts.fetcher.requests,
    ...(countMismatch ? { countMismatch } : {}),
    exitCode: countMismatch ? FATAL_EXIT_CODE : exitCodeFor(failed),
  }
}
