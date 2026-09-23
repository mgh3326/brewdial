import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'kysely'
import { parse } from 'yaml'
import { closeDb, getDb } from './db.js'
import {
  assertReferenceStatusSupported,
  describeDatabaseUrl,
  extractRecipePageUrls,
  loadXBloomReferences,
  normalizeSourceUrl,
  parseRecipePage,
  PoliteFetcher,
  verifyXBloomReferences,
} from './xbloom-reference.js'
import { startXBloomMockSite, type XBloomMockSite } from './testing.js'

// #589: reference loader against a self-authored mock site (no network, no real
// site content). Every row is keyed under the mock's unique http://127.0.0.1:<port>
// origin, so assertions scoped by origin are safe next to other DB test files.

const db = getDb()
const sites: XBloomMockSite[] = []
let cacheDir = ''

async function newSite(): Promise<XBloomMockSite> {
  const s = await startXBloomMockSite(randomUUID().slice(0, 8))
  sites.push(s)
  return s
}

interface Row {
  code: string
  title: string
  status: string
  created_by: string
  is_official: boolean
  owner_id: string | null
  bean_id: string | null
  notes: string | null
  params: { doseG?: number }
  bean_snapshot: Record<string, string>
}

async function rowsFor(site: XBloomMockSite): Promise<Row[]> {
  const r = await sql<Row>`
    select code, title, status, created_by, is_official, owner_id, bean_id, notes, params, bean_snapshot
    from recipes where bean_snapshot->>'sourceUrl' like ${`${site.origin}/%`}
    order by bean_snapshot->>'sourceUrl'`.execute(db)
  return r.rows
}

const fast = (extra: Partial<ConstructorParameters<typeof PoliteFetcher>[0]> = {}) =>
  new PoliteFetcher({ delayMs: 0, ...extra })

beforeAll(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'bd589-cache-'))
})

afterAll(async () => {
  for (const s of sites) {
    await sql`delete from recipes where bean_snapshot->>'sourceUrl' like ${`${s.origin}/%`}`.execute(db)
    await s.close()
  }
  await rm(cacheDir, { recursive: true, force: true })
  await closeDb()
})

describe('normalizeSourceUrl — the idempotency key is deterministic', () => {
  const canonical = 'https://xbloom.lodywgumce.tv/r/teso-la-leona.yaml'
  it.each([
    ['canonical', canonical],
    ['trailing slash', `${canonical}/`],
    ['upper-case host/path', 'HTTPS://XBLOOM.lodywgumce.TV/r/TESO-La-Leona.yaml'],
    ['query + fragment', `${canonical}?v=2&utm=x#top`],
    ['duplicate slashes', 'https://xbloom.lodywgumce.tv//r//teso-la-leona.yaml'],
    ['explicit default port', 'https://xbloom.lodywgumce.tv:443/r/teso-la-leona.yaml'],
    ['surrounding whitespace', `  ${canonical}  `],
    ['dot segments', 'https://xbloom.lodywgumce.tv/recipes/../r/./teso-la-leona.yaml'],
  ])('%s → canonical', (_l, raw) => {
    expect(normalizeSourceUrl(raw)).toBe(canonical)
  })

  it('resolves a relative href against the page', () => {
    expect(normalizeSourceUrl('/r/teso-la-leona.yaml', 'https://xbloom.lodywgumce.tv/recipes/teso-la-leona/')).toBe(
      canonical,
    )
  })

  it('keeps distinct files distinct (hot vs iced, other slug)', () => {
    const keys = new Set(
      ['/r/teso-la-leona.yaml', '/r/teso-la-leona-iced.yaml', '/r/teso-san-pedro.yaml'].map((p) =>
        normalizeSourceUrl(p, 'https://xbloom.lodywgumce.tv/'),
      ),
    )
    expect(keys.size).toBe(3)
  })

  it('rejects non-http schemes', () => {
    expect(() => normalizeSourceUrl('ftp://xbloom.lodywgumce.tv/r/a.yaml')).toThrow(/scheme/)
  })
})

describe('describeDatabaseUrl — the CLI local-DB guard', () => {
  it.each([
    ['unix socket via ?host=', 'postgres://robin@localhost/db?host=/tmp&port=5433', true],
    ['localhost', 'postgres://u:p@localhost:5432/db', true],
    ['127.0.0.1', 'postgres://u:p@127.0.0.1/db', true],
    ['remote host', 'postgres://u:p@db.example.com:5432/db', false],
    ['?host= overrides a localhost hostname', 'postgres://localhost/app?host=db.prod.example.com', false],
    ['?host= socket overrides a remote hostname', 'postgres://db.example.com/app?host=/var/run/postgresql', true],
  ])('%s', (_l, url, local) => {
    expect(describeDatabaseUrl(url).local).toBe(local)
  })
})

describe('site parsing (mock HTML)', () => {
  it('collects each recipe page once and ignores foreign/other links', async () => {
    const site = await newSite()
    const html = await (await fetch(site.url)).text()
    const pages = extractRecipePageUrls(html, site.url)
    expect(pages).toEqual([`${site.origin}${site.pagePaths.a}`, `${site.origin}${site.pagePaths.b}`])
  })

  it('parses title, spec line, notes and hot/iced sections', async () => {
    const site = await newSite()
    const url = `${site.origin}${site.pagePaths.a}`
    const page = parseRecipePage(await (await fetch(url)).text(), url)
    expect(page.roaster).toMatch(/^Mock Roastery [0-9a-f]{8}$/)
    expect(page.beanName).toBe('Kenya Kiambu & Friends') // entity decoded, ¶ anchor dropped
    expect(page.origin).toBe('Kenya')
    expect(page.process).toBe('washed')
    expect(page.roastLevel).toBe('light')
    expect(page.tastingNotes).toBe('blackcurrant · tomato · cane sugar')
    // `?v=2` duplicate of the hot link collapses to the same key; the
    // foreign-origin /r/foreign.yaml link is ignored
    expect(page.sections).toEqual([
      { yamlUrl: `${site.origin}${site.yamlPaths.hotA}`, heading: 'xBloom recipe', iced: false },
      { yamlUrl: `${site.origin}${site.yamlPaths.icedA}`, heading: 'Iced — over ice', iced: true },
    ])
  })
})

describe('load + storage rules', () => {
  let site: XBloomMockSite
  let firstCodes: string[] = []

  beforeAll(async () => {
    site = await newSite()
  })

  it('migration 007 precondition is detected', async () => {
    await expect(assertReferenceStatusSupported(db)).resolves.toBeUndefined()
  })

  it('first run inserts every YAML exactly once, sequentially', async () => {
    const fetcher = fast({ cacheDir })
    const s = await loadXBloomReferences(db, { siteUrl: site.url, fetcher })
    expect(s.fatal).toBeUndefined()
    expect(s).toMatchObject({ pages: 2, inserted: 3, updated: 0, unchanged: 0, failed: 0, exitCode: 0 })
    expect(s.requests).toBe(1 + 2 + 3) // index + 2 pages + 3 yaml
    const rows = await rowsFor(site)
    expect(rows).toHaveLength(3)
    firstCodes = rows.map((r) => r.code)
  })

  it("status='reference', created_by='agent', is_official=false, owner_id=null, bean_id=null", async () => {
    const rows = await rowsFor(site)
    expect(rows).toHaveLength(3) // never pass vacuously
    for (const r of rows) {
      expect(r.status).toBe('reference')
      expect(r.created_by).toBe('agent')
      expect(r.is_official).toBe(false)
      expect(r.owner_id).toBeNull()
      expect(r.bean_id).toBeNull()
    }
  })

  it('creates no beans row (recipes_link_bean is bypassed)', async () => {
    const rows = await rowsFor(site)
    expect(rows).toHaveLength(3)
    const names = rows.map((r) => r.bean_snapshot.name)
    const beans = await sql<{ n: number }>`
      select count(*)::int as n from beans where name = any(${names}::text[]) or roaster = any(${rows.map((r) => r.bean_snapshot.roaster)}::text[])`.execute(db)
    expect(beans.rows[0].n).toBe(0)
  })

  it('title format: [참조] <roaster> — <bean> [ICE] (xBloom Omni <dose>g)', async () => {
    const byUrl = new Map((await rowsFor(site)).map((r) => [r.bean_snapshot.sourceUrl, r.title]))
    const roaster = (await rowsFor(site))[0].bean_snapshot.roaster
    expect(byUrl.get(`${site.origin}${site.yamlPaths.hotA}`)).toBe(
      `[참조] ${roaster} — Kenya Kiambu & Friends (xBloom Omni 16g)`,
    )
    expect(byUrl.get(`${site.origin}${site.yamlPaths.icedA}`)).toBe(
      `[참조] ${roaster} — Kenya Kiambu & Friends ICE (xBloom Omni 16g)`,
    )
    expect(byUrl.get(`${site.origin}${site.yamlPaths.hotB}`)).toMatch(
      /^\[참조\] Other Roast [0-9a-f]{8} — Brazil Cerrado \(xBloom Omni 15\.5g\)$/,
    )
  })

  it('notes = YAML note verbatim … + 출처/YAML as the final two lines', async () => {
    const hot = (await rowsFor(site)).find((r) => r.bean_snapshot.sourceUrl.endsWith(site.yamlPaths.hotA))!
    const yamlText = await (await fetch(`${site.origin}${site.yamlPaths.hotA}`)).text()
    const note = (parse(yamlText) as { note: string }).note
    expect(hot.notes!.startsWith(`${note}\n[xbloom v=1 `)).toBe(true)
    const lines = hot.notes!.split('\n')
    expect(lines.at(-2)).toBe(`출처: ${site.origin}${site.pagePaths.a}`)
    expect(lines.at(-1)).toBe(`YAML: ${site.origin}${site.yamlPaths.hotA}`)
  })

  it('bean_snapshot carries page fields + the source key', async () => {
    const iced = (await rowsFor(site)).find((r) => r.bean_snapshot.sourceUrl.endsWith(site.yamlPaths.icedA))!
    expect(iced.bean_snapshot).toMatchObject({
      name: expect.stringMatching(/ — Kenya Kiambu & Friends$/),
      origin: 'Kenya',
      process: 'washed',
      roastLevel: 'light',
      notes: 'blackcurrant · tomato · cane sugar',
      sourceUrl: `${site.origin}${site.yamlPaths.icedA}`,
      sourcePageUrl: `${site.origin}${site.pagePaths.a}`,
      sourceYamlName: expect.stringMatching(/^Mock Roastery Kenya Iced /),
      sourceKind: 'iced',
    })
  })

  // M1: re-running must not add rows. A per-run key would insert 3 more here.
  it('M1: second run adds no rows and reports every item unchanged', async () => {
    const s = await loadXBloomReferences(db, { siteUrl: site.url, fetcher: fast() })
    const rows = await rowsFor(site)
    expect(rows.length, 'recipes rows after the 2nd run').toBe(3) // row count first: the M1 signal
    expect(rows.map((r) => r.code)).toEqual(firstCodes)
    expect(s).toMatchObject({ inserted: 0, updated: 0, unchanged: 3, failed: 0, exitCode: 0 })
  })

  it('a changed YAML updates the same row in place', async () => {
    const yamlText = await (await fetch(`${site.origin}${site.yamlPaths.hotB}`)).text()
    site.setRoute(site.yamlPaths.hotB, { status: 200, body: yamlText.replace('dose_g: 15.5', 'dose_g: 17') })
    const s = await loadXBloomReferences(db, { siteUrl: site.url, fetcher: fast({ cacheDir }) })
    expect(s).toMatchObject({ inserted: 0, updated: 1, unchanged: 2, failed: 0 })
    const rows = await rowsFor(site)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.code)).toEqual(firstCodes)
    const b = rows.find((r) => r.bean_snapshot.sourceUrl.endsWith(site.yamlPaths.hotB))!
    expect(b.params.doseG).toBe(17)
    expect(b.title).toMatch(/\(xBloom Omni 17g\)$/)
  })

  it('a drifted row (status flipped to active) is restored to reference on re-run', async () => {
    await sql`update recipes set status = 'active' where code = ${firstCodes[0]}`.execute(db)
    const s = await loadXBloomReferences(db, { siteUrl: site.url, fetcher: fast() })
    expect(s).toMatchObject({ inserted: 0, updated: 1, unchanged: 2 })
    expect((await rowsFor(site)).every((r) => r.status === 'reference')).toBe(true)
  })

  describe('--verify (roundtrip via toXBloomYaml, deep-equal)', () => {
    it('passes every loaded row, served from the cache (no requests)', async () => {
      const fetcher = fast({ cacheDir, preferCache: true })
      const v = await verifyXBloomReferences(db, { siteUrl: site.url, fetcher, expect: 3 })
      expect(v.items.filter((i) => !i.ok)).toEqual([])
      expect(v).toMatchObject({ rows: 3, passed: 3, failed: 0, exitCode: 0 })
      expect(v.requests).toBe(0)
    })

    it('fails a row whose params drifted, naming the field', async () => {
      const code = firstCodes[0]
      await sql`update recipes set params = jsonb_set(params, '{doseG}', '99') where code = ${code}`.execute(db)
      const v = await verifyXBloomReferences(db, { siteUrl: site.url, fetcher: fast() })
      expect(v).toMatchObject({ passed: 2, failed: 1, exitCode: 1 })
      const bad = v.items.find((i) => i.code === code)!
      expect(bad.ok).toBe(false)
      expect(bad.reasons.join(' ')).toMatch(/roundtrip mismatch: \$\.dose_g: expected 16 got 99/)
    })

    it('fails a row with a drifted step, storage rule, or missing source lines', async () => {
      const [a, b, c] = firstCodes
      await sql`update recipes set steps = jsonb_set(steps, '{1,waterG}', '999') where code = ${a}`.execute(db)
      await db.transaction().execute(async (trx) => {
        // guard trigger: is_official is only writable with the owner-write flag
        await sql`select set_config('bd.owner_write_ok','on',true)`.execute(trx)
        await sql`update recipes set is_official = true where code = ${b}`.execute(trx)
      })
      await sql`update recipes set notes = regexp_replace(notes, '\nYAML: .*$', '') where code = ${c}`.execute(db)
      const v = await verifyXBloomReferences(db, { siteUrl: site.url, fetcher: fast() })
      expect(v).toMatchObject({ passed: 0, failed: 3, exitCode: 3 })
      const reasons = Object.fromEntries(v.items.map((i) => [i.code, i.reasons.join(' | ')]))
      expect(reasons[a]).toMatch(/roundtrip mismatch: .*\$\.pours\.1\.ml: expected \d+ got/)
      expect(reasons[b]).toMatch(/is_official=true/)
      expect(reasons[c]).toMatch(/source lines/)
    })

    it('a re-run heals every drift and verify passes again; --expect mismatch is fatal', async () => {
      const s = await loadXBloomReferences(db, { siteUrl: site.url, fetcher: fast() })
      expect(s).toMatchObject({ inserted: 0, updated: 3, unchanged: 0 })
      const v = await verifyXBloomReferences(db, { siteUrl: site.url, fetcher: fast(), expect: 3 })
      expect(v).toMatchObject({ passed: 3, failed: 0, exitCode: 0 })
      const off = await verifyXBloomReferences(db, { siteUrl: site.url, fetcher: fast(), expect: 25 })
      expect(off.countMismatch).toBe('expected 25 reference rows, found 3')
      expect(off.exitCode).toBe(255)
    })
  })
})

describe('failure paths: skip, summarize, exit code = failures', () => {
  it('404 YAML + broken YAML are skipped; the rest still loads', async () => {
    const site = await newSite()
    site.setRoute(site.yamlPaths.hotB, { status: 404, body: 'gone' })
    site.setRoute(site.yamlPaths.icedA, { status: 200, body: 'name: [unclosed\ndose_g: : :\n' })
    const s = await loadXBloomReferences(db, { siteUrl: site.url, fetcher: fast() })
    expect(s).toMatchObject({ inserted: 1, failed: 2, exitCode: 2 })
    const failed = Object.fromEntries(s.items.filter((i) => i.outcome === 'failed').map((i) => [i.url, i.reason]))
    expect(failed[`${site.origin}${site.yamlPaths.hotB}`]).toBe('yaml: HTTP 404')
    expect(failed[`${site.origin}${site.yamlPaths.icedA}`]).toMatch(/YAML|Flow|Nested|Implicit/i)
    const rows = await rowsFor(site)
    expect(rows.map((r) => r.bean_snapshot.sourceUrl)).toEqual([`${site.origin}${site.yamlPaths.hotA}`])
  })

  it('a hardware-invalid YAML and a missing page are counted too', async () => {
    const site = await newSite()
    const yamlText = await (await fetch(`${site.origin}${site.yamlPaths.hotA}`)).text()
    site.setRoute(site.yamlPaths.hotA, { status: 200, body: yamlText.replace('grind: 59', 'grind: 999') })
    site.setRoute(site.pagePaths.b, { status: 500, body: 'boom' })
    const s = await loadXBloomReferences(db, { siteUrl: site.url, fetcher: fast() })
    expect(s).toMatchObject({ inserted: 1, failed: 2, exitCode: 2 })
    expect(s.items.find((i) => i.url.endsWith(site.yamlPaths.hotA))?.reason).toMatch(/XBloomValidationError: .*grind/)
    expect(s.items.find((i) => i.url.endsWith(site.pagePaths.b))?.reason).toBe('page: HTTP 500')
  })

  it('an unreachable index is fatal (255) and writes nothing', async () => {
    const site = await newSite()
    site.setRoute('/', { status: 503, body: 'down' })
    const s = await loadXBloomReferences(db, { siteUrl: site.url, fetcher: fast() })
    expect(s.fatal).toMatch(/HTTP 503/)
    expect(s.exitCode).toBe(255)
    expect(await rowsFor(site)).toHaveLength(0)
  })
})

describe('politeness: sequential requests with a minimum gap', () => {
  it('never overlaps requests and keeps ≥ delayMs between them', async () => {
    const site = await newSite()
    site.latencyMs = 25
    const delayMs = 80
    const s = await loadXBloomReferences(db, { siteUrl: site.url, fetcher: new PoliteFetcher({ delayMs }) })
    expect(s.failed).toBe(0)
    expect(site.maxInFlight).toBe(1)
    const reqs = [...site.requests].sort((a, b) => a.startedAt - b.startedAt)
    expect(reqs).toHaveLength(6)
    for (let i = 1; i < reqs.length; i++) {
      // server-side gap; 5ms slack for socket/timer jitter
      expect(reqs[i].startedAt - reqs[i - 1].endedAt).toBeGreaterThanOrEqual(delayMs - 5)
    }
  })

  it('serializes even when callers fire concurrently', async () => {
    const site = await newSite()
    site.latencyMs = 20
    const f = new PoliteFetcher({ delayMs: 30 })
    const urls = [site.url, `${site.origin}${site.pagePaths.a}`, `${site.origin}${site.pagePaths.b}`]
    const res = await Promise.all(urls.map((u) => f.getText(u)))
    expect(res.every((r) => r.ok)).toBe(true)
    expect(site.maxInFlight).toBe(1)
    expect(f.requests).toBe(3)
  })

  it('offline mode never touches the network', async () => {
    const site = await newSite()
    const f = new PoliteFetcher({ delayMs: 0, cacheDir, offline: true })
    const r = await f.getText(site.url)
    expect(r.ok).toBe(false)
    expect(f.requests).toBe(0)
    expect(site.requests).toHaveLength(0)
  })
})
