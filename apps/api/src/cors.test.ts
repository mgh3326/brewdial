/**
 * cors.test.ts — Task 1: permissive CORS for browser/.ait clients
 *
 * Verifies:
 *  1. OPTIONS preflight on /api/recipes returns CORS allow headers (204/200).
 *  2. GET /api/health with Origin header returns Access-Control-Allow-Origin: *.
 *
 * Uses Hono's built-in `app.request()` — no real HTTP server needed.
 */

import { describe, expect, test } from 'vitest'
import { app } from './app.js'

describe('CORS — OPTIONS preflight', () => {
  test('OPTIONS /api/recipes with Origin + ACR-Method + ACR-Headers → 204/200 with CORS headers', async () => {
    const res = await app.request('/api/recipes', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://coffee.robinco.dev',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-brewdial-identity',
      },
    })

    // Hono cors middleware short-circuits OPTIONS: 204 (no content) or 200.
    expect([200, 204]).toContain(res.status)

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')

    // allow-headers must include X-BrewDial-Identity (case-insensitive check).
    const allowedHeaders = (
      res.headers.get('Access-Control-Allow-Headers') ?? ''
    ).toLowerCase()
    expect(allowedHeaders).toContain('x-brewdial-identity')
  })
})

describe('CORS — simple request', () => {
  test('GET /api/health with Origin header → 200 with Access-Control-Allow-Origin: *', async () => {
    const res = await app.request('/api/health', {
      method: 'GET',
      headers: {
        Origin: 'https://coffee.robinco.dev',
      },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})
