// /mcp access: Cloudflare Access assertion (RS256, iss, aud, exp, email allowlist)
// and the fail-closed config. Uses a locally generated key and the injected JWKS,
// so no network and no database.

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose'
import { createApp } from '../app.js'
import {
  MCP_ACCESS_HEADER,
  formatMcpAccessLog,
  logMcpAccessState,
  readMcpAccessState,
} from './mcp-access.js'

const TEAM = 'team.test.invalid'
const ISSUER = `https://${TEAM}`
const AUD = 'test-aud-tag-0123'
const ALLOWED = 'operator@example.test'

const MCP_ENV_KEYS = [
  'BREWDIAL_MCP_CF_TEAM_DOMAIN',
  'BREWDIAL_MCP_CF_AUD',
  'BREWDIAL_MCP_ALLOWED_EMAILS',
] as const

const FULL_ENV: Record<(typeof MCP_ENV_KEYS)[number], string> = {
  BREWDIAL_MCP_CF_TEAM_DOMAIN: TEAM,
  BREWDIAL_MCP_CF_AUD: AUD,
  BREWDIAL_MCP_ALLOWED_EMAILS: ALLOWED,
}

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
let jwks: ReturnType<typeof createLocalJWKSet>

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  const publicJwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'test-kid', alg: 'RS256', use: 'sig' }
  jwks = createLocalJWKSet({ keys: [publicJwk] })
})

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(MCP_ENV_KEYS.map((k) => [k, process.env[k]]))
  Object.assign(process.env, FULL_ENV)
})

afterEach(() => {
  for (const k of MCP_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

interface TokenOptions {
  email?: string | null
  issuer?: string
  audience?: string
  exp?: number | null
}

async function rs256Token(options: TokenOptions = {}): Promise<string> {
  const claims: Record<string, unknown> = {}
  if (options.email !== null) claims.email = options.email ?? ALLOWED
  const signer = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUD)
    .setIssuedAt()
  if (options.exp !== null) signer.setExpirationTime(options.exp ?? '5m')
  return signer.sign(privateKey)
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'access-test', version: '0.0.0' },
  },
}

function postMcp(token: string | undefined) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  }
  if (token !== undefined) headers[MCP_ACCESS_HEADER] = token
  return createApp({ mcpJwks: jwks }).request('/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(INITIALIZE),
  })
}

function expectUnauthorized(res: Response) {
  expect(res.status).toBe(401)
  expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
  return res.json().then((body) => expect(body).toEqual({ error: 'unauthorized' }))
}

describe('/mcp Cloudflare Access assertion (401 on any failure)', () => {
  test('no Cf-Access-Jwt-Assertion header → 401 {"error":"unauthorized"} + WWW-Authenticate: Bearer', async () => {
    await expectUnauthorized(await postMcp(undefined))
  })

  test('wrong audience → 401', async () => {
    await expectUnauthorized(await postMcp(await rs256Token({ audience: 'some-other-aud' })))
  })

  test('wrong issuer → 401', async () => {
    await expectUnauthorized(await postMcp(await rs256Token({ issuer: 'https://evil.test.invalid' })))
  })

  test('expired token → 401', async () => {
    const past = Math.floor(Date.now() / 1000) - 60
    await expectUnauthorized(await postMcp(await rs256Token({ exp: past })))
  })

  test('token without exp → 401 (expiry is required, not optional)', async () => {
    await expectUnauthorized(await postMcp(await rs256Token({ exp: null })))
  })

  test('HS256-signed token → 401 (RS256 only)', async () => {
    const hs = await new SignJWT({ email: ALLOWED })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(AUD)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('x'.repeat(48)))
    await expectUnauthorized(await postMcp(hs))
  })

  test('valid token whose email is not on the allowlist → 401', async () => {
    await expectUnauthorized(await postMcp(await rs256Token({ email: 'stranger@example.test' })))
  })

  test('valid token without an email claim (Access service token) → 401', async () => {
    await expectUnauthorized(await postMcp(await rs256Token({ email: null })))
  })

  test('valid token with an allowlisted email in mixed case and padding → not 401', async () => {
    const res = await postMcp(await rs256Token({ email: `  Operator@Example.TEST ` }))
    expect(res.status).toBe(200)
  })
})

describe('/mcp fail-closed config (503 when any of the three vars is missing or blank)', () => {
  const blankings: Array<[string, string | undefined]> = [
    ['unset', undefined],
    ['blank', '   '],
  ]

  for (const key of MCP_ENV_KEYS) {
    for (const [label, value] of blankings) {
      test(`${key} ${label} → 503 {"error":"mcp auth not configured"} even with a valid token`, async () => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
        const res = await postMcp(await rs256Token())
        expect(res.status).toBe(503)
        expect(await res.json()).toEqual({ error: 'mcp auth not configured' })
      })
    }
  }
})

describe('startup log line (mcp.access)', () => {
  test('all three set → "mcp.access enabled"', () => {
    expect(formatMcpAccessLog(readMcpAccessState(FULL_ENV))).toBe('mcp.access enabled')
  })

  test('each incomplete combination names only the set flags, never a value', () => {
    expect(
      formatMcpAccessLog(
        readMcpAccessState({ ...FULL_ENV, BREWDIAL_MCP_CF_TEAM_DOMAIN: '  ' }),
      ),
    ).toBe(
      'mcp.access disabled reason=incomplete_config team_domain_set=false aud_set=true allowlist_set=true',
    )
    expect(
      formatMcpAccessLog(readMcpAccessState({ ...FULL_ENV, BREWDIAL_MCP_CF_AUD: undefined })),
    ).toBe(
      'mcp.access disabled reason=incomplete_config team_domain_set=true aud_set=false allowlist_set=true',
    )
    expect(
      formatMcpAccessLog(readMcpAccessState({ ...FULL_ENV, BREWDIAL_MCP_ALLOWED_EMAILS: ' , ' })),
    ).toBe(
      'mcp.access disabled reason=incomplete_config team_domain_set=true aud_set=true allowlist_set=false',
    )
  })

  test('the emitted line contains no configured value', () => {
    const lines: string[] = []
    logMcpAccessState(FULL_ENV, (line) => lines.push(line))
    logMcpAccessState({ ...FULL_ENV, BREWDIAL_MCP_CF_AUD: undefined }, (line) => lines.push(line))
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(line).not.toContain(TEAM)
      expect(line).not.toContain(AUD)
      expect(line).not.toContain(ALLOWED)
    }
  })

  test('logMcpAccessState writes exactly one line through the injected sink', () => {
    const log = vi.fn()
    logMcpAccessState(FULL_ENV, log)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('mcp.access enabled')
  })
})
