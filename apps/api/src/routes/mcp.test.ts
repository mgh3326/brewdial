// /mcp Streamable HTTP: initialize and tools/list over a proxied Host header,
// in-process tool calls through agentAuth (no network, no database), and no
// CORS on /mcp. A local RS256 key and the injected JWKS sign the Access assertion.

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose'
import { createApp } from '../app.js'
import { MCP_ACCESS_HEADER } from '../middleware/mcp-access.js'

const TEAM = 'team.test.invalid'
const AUD = 'test-aud-tag-0123'
const ALLOWED = 'operator@example.test'

// Exactly the tools `createBrewdialMcpServer` registers (apps/mcp/src/server.ts TOOLS).
const EXPECTED_TOOL_NAMES = [
  'archive_recipe',
  'create_feedback',
  'create_recipe',
  'find_bean',
  'get_recent_context',
  'get_recipe_context',
  'list_beans',
  'list_drippers',
  'list_grinders',
  'supersede_recipe',
  'update_bean_attributes',
  'update_preferences',
  'update_recipe',
]

const ENV_KEYS = [
  'BREWDIAL_MCP_CF_TEAM_DOMAIN',
  'BREWDIAL_MCP_CF_AUD',
  'BREWDIAL_MCP_ALLOWED_EMAILS',
  'AGENT_TOKEN',
] as const

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
let jwks: ReturnType<typeof createLocalJWKSet>
let token: string

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  const publicJwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'test-kid', alg: 'RS256', use: 'sig' }
  jwks = createLocalJWKSet({ keys: [publicJwk] })
  token = await new SignJWT({ email: ALLOWED })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setIssuer(`https://${TEAM}`)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
})

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env.BREWDIAL_MCP_CF_TEAM_DOMAIN = TEAM
  process.env.BREWDIAL_MCP_CF_AUD = AUD
  process.env.BREWDIAL_MCP_ALLOWED_EMAILS = ALLOWED
  delete process.env.AGENT_TOKEN
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function mcpApp() {
  return createApp({ mcpJwks: jwks })
}

function rpc(method: string, id: number, params: Record<string, unknown> = {}) {
  return { jsonrpc: '2.0', id, method, params }
}

const INITIALIZE = rpc('initialize', 1, {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'route-test', version: '0.0.0' },
})

function postMcp(body: unknown, extra: Record<string, string> = {}) {
  return mcpApp().request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      [MCP_ACCESS_HEADER]: token,
      ...extra,
    },
    body: JSON.stringify(body),
  })
}

describe('/mcp initialize and tools/list through a proxied public Host', () => {
  test('initialize → 200 and tools/list → exactly the 13 registered tool names', async () => {
    const proxied = { Host: 'mcp.public.example.test' }

    const init = await postMcp(INITIALIZE, proxied)
    expect(init.status).toBe(200)
    const initBody = await init.json()
    expect(initBody.result.serverInfo.name).toBe('brewdial-mcp')

    const list = await postMcp(rpc('tools/list', 2), proxied)
    expect(list.status).toBe(200)
    const listBody = await list.json()
    const names = listBody.result.tools.map((t: { name: string }) => t.name).sort()
    expect(names).toEqual(EXPECTED_TOOL_NAMES)
    expect(names).toHaveLength(13)
  })
})

describe('/mcp tool calls run in-process through agentAuth', () => {
  test('tools/call of an agent-surface tool with AGENT_TOKEN unset → tool error carrying 503 agent auth not configured; global fetch never called', async () => {
    const spy = vi.fn(() => {
      throw new Error('global fetch must not be called')
    })
    vi.stubGlobal('fetch', spy)

    const res = await postMcp(
      rpc('tools/call', 3, { name: 'update_preferences', arguments: {} }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    const text: string = body.result.content[0].text
    // apps/mcp formats API failures as "API request failed with status <n>" and drops
    // the body, so the carried evidence is the API's 503 status, not its body text.
    expect(text).toContain('API request failed with status 503')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('/mcp is outside the API CORS and /api mount', () => {
  test('OPTIONS /mcp (valid token, allowed origin) → no Access-Control-Allow-Origin', async () => {
    const res = await mcpApp().request('/mcp', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://coffee.robinco.dev',
        'Access-Control-Request-Method': 'POST',
        [MCP_ACCESS_HEADER]: token,
      },
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  test('POST /mcp (valid token, allowed origin) → no Access-Control-Allow-Origin', async () => {
    const res = await postMcp(INITIALIZE, { Origin: 'https://coffee.robinco.dev' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  test('/mcp is not reachable under /api → 404', async () => {
    const res = await mcpApp().request('/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', [MCP_ACCESS_HEADER]: token },
      body: JSON.stringify(INITIALIZE),
    })
    expect(res.status).toBe(404)
  })
})
