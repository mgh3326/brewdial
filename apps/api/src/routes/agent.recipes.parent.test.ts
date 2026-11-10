import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { request } from '../test/request.js'
import { closeDb, getDb, getRecipeAnyStatus, insertAgentRecipe } from '@brewdial/db'

const seed = randomUUID().replace(/-/g, '').slice(0, 8)
const codes: string[] = []
const req = (path: string, body: unknown) => request(new Request(`http://localhost${path}`, { method: 'PUT', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify(body) }))
beforeAll(() => { process.env.AGENT_TOKEN = 'test-token' })
afterAll(async () => { if (codes.length) await getDb().deleteFrom('recipes').where('code', 'in', codes).execute(); await closeDb() })

async function make(title: string) {
  const row = await insertAgentRecipe(getDb(), { method: 'v60', title: `${title} ${seed}` })
  codes.push(row.code)
  return row
}

test('PUT parent sets and clears lineage without changing version', async () => {
  const parent = await make('Parent')
  const child = await make('Child')
  const set = await req(`/api/agent/recipes/${child.code}/parent`, { parentCode: parent.code })
  expect(set.status).toBe(200)
  expect((await set.json()).version).toBe(child.version)
  expect((await getRecipeAnyStatus(getDb(), child.code))?.parent_code).toBe(parent.code)
  const clear = await req(`/api/agent/recipes/${child.code}/parent`, { parentCode: null })
  expect(clear.status).toBe(200)
  expect((await clear.json()).version).toBe(child.version)
})

test('PUT parent rejects self, two-node and three-node cycles and missing recipes', async () => {
  const a = await make('A')
  const b = await make('B')
  const c = await make('C')
  expect((await req(`/api/agent/recipes/${a.code}/parent`, { parentCode: 'COF-999999' })).status).toBe(400)
  expect((await req(`/api/agent/recipes/${a.code}/parent`, { parentCode: a.code })).status).toBe(400)
  expect((await req(`/api/agent/recipes/${b.code}/parent`, { parentCode: a.code })).status).toBe(200)
  expect((await req(`/api/agent/recipes/${a.code}/parent`, { parentCode: b.code })).status).toBe(400)
  expect((await req(`/api/agent/recipes/${c.code}/parent`, { parentCode: b.code })).status).toBe(200)
  expect((await req(`/api/agent/recipes/${a.code}/parent`, { parentCode: c.code })).status).toBe(400)
  expect((await req('/api/agent/recipes/COF-999999/parent', { parentCode: null })).status).toBe(404)
})

test('concurrent opposite parent assignments do not return a server error or create a cycle', async () => {
  const a = await make('Concurrent A')
  const b = await make('Concurrent B')
  const [aToB, bToA] = await Promise.all([
    req(`/api/agent/recipes/${a.code}/parent`, { parentCode: b.code }),
    req(`/api/agent/recipes/${b.code}/parent`, { parentCode: a.code }),
  ])
  expect([aToB.status, bToA.status].sort()).toEqual([200, 400])
  const storedA = await getRecipeAnyStatus(getDb(), a.code)
  const storedB = await getRecipeAnyStatus(getDb(), b.code)
  expect(storedA?.parent_code === b.code && storedB?.parent_code === a.code).toBe(false)
})
