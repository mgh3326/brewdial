// /mcp end-to-end with the database: list_grinders through the in-process tool
// path must return a non-error result. Needs DATABASE_URL (CI sets it); locally
// it is skipped, because no database server is started on the dev host.

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose'
import { closeDb } from '@brewdial/db'
import { createApp } from '../app.js'
import { MCP_ACCESS_HEADER } from '../middleware/mcp-access.js'

const TEAM = 'team.test.invalid'
const AUD = 'test-aud-tag-0123'
const ALLOWED = 'operator@example.test'

describe.skipIf(!process.env.DATABASE_URL)('/mcp list_grinders against the database', () => {
  let token: string
  let jwks: ReturnType<typeof createLocalJWKSet>
  const saved: Record<string, string | undefined> = {}
  const keys = ['BREWDIAL_MCP_CF_TEAM_DOMAIN', 'BREWDIAL_MCP_CF_AUD', 'BREWDIAL_MCP_ALLOWED_EMAILS']

  beforeAll(async () => {
    for (const k of keys) saved[k] = process.env[k]
    process.env.BREWDIAL_MCP_CF_TEAM_DOMAIN = TEAM
    process.env.BREWDIAL_MCP_CF_AUD = AUD
    process.env.BREWDIAL_MCP_ALLOWED_EMAILS = ALLOWED

    const pair = await generateKeyPair('RS256')
    const publicJwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'db-kid', alg: 'RS256', use: 'sig' }
    jwks = createLocalJWKSet({ keys: [publicJwk] })
    token = await new SignJWT({ email: ALLOWED })
      .setProtectedHeader({ alg: 'RS256', kid: 'db-kid' })
      .setIssuer(`https://${TEAM}`)
      .setAudience(AUD)
      .setExpirationTime('5m')
      .sign(pair.privateKey)
  })

  afterAll(async () => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    await closeDb()
  })

  test('tools/call list_grinders → non-error result', async () => {
    const res = await createApp({ mcpJwks: jwks }).request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        [MCP_ACCESS_HEADER]: token,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_grinders', arguments: {} },
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).not.toBe(true)
  })
})
