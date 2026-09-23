import { request } from '../test/request.js'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { closeDb, getDb, loadXBloomReferences, PoliteFetcher } from '@brewdial/db'
import { startXBloomMockSite, type XBloomMockSite } from '@brewdial/db/testing'

// #589 M2: rows written by the xBloom reference loader must never surface on the
// user-facing web API or the MCP recent-context tool ("내 레시피" / recent lists).
// Loads through the real loader (self-authored mock site, no network) so a loader
// that wrote any status other than 'reference' turns these assertions red.

const SUFFIX = randomUUID().replace(/-/g, '').slice(0, 8)
const IDENTITY_KEY = `toss_anon:xbref_${SUFFIX}_${'0'.repeat(20)}`
let site: XBloomMockSite
let codes: string[] = []
// Active control row: proves each list path actually returns rows.
const controlCode = `T-XBREF-ACT-${SUFFIX}`

beforeAll(async () => {
  process.env.AGENT_TOKEN = 'test-token'
  site = await startXBloomMockSite(SUFFIX)
  const s = await loadXBloomReferences(getDb(), { siteUrl: site.url, fetcher: new PoliteFetcher({ delayMs: 0 }) })
  expect(s).toMatchObject({ inserted: 3, failed: 0 })
  codes = s.items.map((i) => i.code!).filter(Boolean)
  expect(codes).toHaveLength(3)
  await getDb()
    .insertInto('recipes')
    .values({ code: controlCode, method: 'v60', title: `Control ${SUFFIX}`, status: 'active', owner_id: null })
    .execute()
})

afterAll(async () => {
  await sql`delete from recipes where bean_snapshot->>'sourceUrl' like ${`${site.origin}/%`}`.execute(getDb())
  await sql`delete from recipes where code = ${controlCode}`.execute(getDb())
  await site.close()
  await closeDb()
})

test('GET /api/recipes (web list) never includes loaded [참조] recipes', async () => {
  const res = await request('/api/recipes?limit=100')
  expect(res.status).toBe(200)
  const rows = (await res.json()) as Array<{ code: string; title: string }>
  expect(rows.map((r) => r.code)).toContain(controlCode) // positive control: the list works
  for (const code of codes) expect(rows.map((r) => r.code)).not.toContain(code)
  expect(rows.filter((r) => r.title.startsWith('[참조]') && r.title.includes(SUFFIX))).toEqual([])
})

test('GET /api/recipes/:code (web deep link) 404s for every loaded row', async () => {
  for (const code of codes) {
    const res = await request(`/api/recipes/${code}`)
    expect(res.status).toBe(404)
  }
})

test('GET /api/me/collections: myRecipes and savedRecipes stay free of reference rows', async () => {
  const save = await request('/api/me/saved-recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-BrewDial-Identity': IDENTITY_KEY },
    body: JSON.stringify({ code: codes[0] }),
  })
  expect(save.status).toBe(201)
  const res = await request('/api/me/collections', { headers: { 'X-BrewDial-Identity': IDENTITY_KEY } })
  expect(res.status).toBe(200)
  const col = (await res.json()) as {
    myRecipes: string[]
    savedRecipes: Array<{ recipe_code: string; snapshot: unknown }>
  }
  for (const code of codes) expect(col.myRecipes).not.toContain(code)
  const saved = col.savedRecipes.find((r) => r.recipe_code === codes[0])
  if (saved) expect(saved.snapshot).toBeNull()
})

test('MCP brew.get_recent_context (buildRecentContext over the API) excludes loaded rows', async () => {
  // The MCP server reads recipes through this API; drive its real context builder
  // with a fetch bridged onto the same app/server the other tests hit. Imported by
  // path (not a package dep) so apps/api's tsc does not compile apps/mcp sources.
  const modPath = new URL('../../../mcp/src/context.ts', import.meta.url).href
  const mcp = (await import(/* @vite-ignore */ modPath)) as {
    buildRecentContext: (
      config: { baseUrl: string; agentToken: string },
      limit: number,
      fetchImpl: typeof fetch,
    ) => Promise<{ recentRecipes: Array<{ recipe: { code: string; title: string } }> }>
  }
  const bridge: typeof fetch = (input, init) => {
    const u = new URL(input instanceof Request ? input.url : String(input))
    return request(`${u.pathname}${u.search}`, init)
  }
  const ctx = await mcp.buildRecentContext({ baseUrl: 'http://mcp-bridge.invalid', agentToken: 'test-token' }, 20, bridge)
  const seen = ctx.recentRecipes.map((r) => r.recipe.code)
  expect(seen).toContain(controlCode) // positive control: the bridge works
  for (const code of codes) expect(seen).not.toContain(code)
})

test('explicit agent lookup by code still reaches a reference row', async () => {
  const res = await request(`/api/agent/recipes/${codes[0]}`, { headers: { Authorization: 'Bearer test-token' } })
  expect(res.status).toBe(200)
  const row = (await res.json()) as { status: string; title: string }
  expect(row.status).toBe('reference')
  expect(row.title.startsWith('[참조] ')).toBe(true)
})
