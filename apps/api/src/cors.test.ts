/**
 * cors.test.ts — CORS for the Toss mini-app WebView + web clients.
 *
 * The Toss WebView calls cross-origin with a SPECIFIC Origin
 * (https://<appName>.{apps,private-apps}.tossmini.com) and is strict — `*` is
 * rejected. We echo the exact allowed origin + Access-Control-Allow-Credentials.
 *
 * Verifies:
 *  1. OPTIONS preflight from the Toss QR-test origin → 204/200, echoes that origin,
 *     allow-credentials true, allow-headers include X-BrewDial-Identity.
 *  2. GET /api/health from an allowed web origin → 200, echoes that origin.
 *  3. A disallowed origin is NOT echoed back.
 *
 * Uses Hono's built-in `request()` — no real HTTP server needed.
 */

import { describe, expect, test } from 'vitest'
import { request } from './test/request.js'

const TOSS_TEST_ORIGIN = 'https://brewdial.private-apps.tossmini.com'
const WEB_ORIGIN = 'https://coffee.robinco.dev'

describe('CORS — OPTIONS preflight (Toss WebView origin)', () => {
  test('OPTIONS /api/recipes from Toss QR-test origin → 204/200, echoes origin + credentials', async () => {
    const res = await request('/api/recipes', {
      method: 'OPTIONS',
      headers: {
        Origin: TOSS_TEST_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-brewdial-identity',
      },
    })

    // Hono cors middleware short-circuits OPTIONS: 204 (no content) or 200.
    expect([200, 204]).toContain(res.status)

    // Strict Toss WebView: the EXACT origin must be echoed, not '*'.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(TOSS_TEST_ORIGIN)
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')

    const allowedHeaders = (
      res.headers.get('Access-Control-Allow-Headers') ?? ''
    ).toLowerCase()
    expect(allowedHeaders).toContain('x-brewdial-identity')
  })
})

describe('CORS — simple request (web origin)', () => {
  test('GET /api/health from an allowed web origin → 200, echoes that origin', async () => {
    const res = await request('/api/health', {
      method: 'GET',
      headers: { Origin: WEB_ORIGIN },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(WEB_ORIGIN)
  })
})

describe('CORS — disallowed origin', () => {
  test('a foreign origin is NOT echoed back', async () => {
    const res = await request('/api/health', {
      method: 'GET',
      headers: { Origin: 'https://evil.example.com' },
    })

    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe(
      'https://evil.example.com'
    )
  })
})

describe('routing — served at both /api/* and /* (client base omits /api)', () => {
  test('GET /api/health → 200 (canonical prefix)', async () => {
    const res = await request('/api/health')
    expect(res.status).toBe(200)
  })

  test('GET /health → 200 (client base omits /api)', async () => {
    const res = await request('/health')
    expect(res.status).toBe(200)
  })

  test('OPTIONS /me/collections (no /api) from Toss origin → preflight 204, echoes origin', async () => {
    const res = await request('/me/collections', {
      method: 'OPTIONS',
      headers: {
        Origin: TOSS_TEST_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-brewdial-identity',
      },
    })
    expect([200, 204]).toContain(res.status)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(TOSS_TEST_ORIGIN)
  })
})
