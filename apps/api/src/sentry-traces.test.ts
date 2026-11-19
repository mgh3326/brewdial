// Performance traces: the API sends one transaction per HTTP request, named by the
// route pattern, with mysql2 db spans. Runs the real app in a child process started
// the way production starts it (`node --import <instrument.ts>`). The DSN points at a
// local collector, which stands in for Sentry's ingest and records every envelope.

import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

const CHILD = fileURLToPath(new URL('./test/sentry-child.ts', import.meta.url))
const INSTRUMENT = pathToFileURL(fileURLToPath(new URL('./instrument.ts', import.meta.url))).href
const API_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CHILD_TIMEOUT_MS = 90_000
const SECRET = 'sentry-trace-test-authorization-value'
const RESULT_PREFIX = 'SENTRY_CHILD_RESULT='

let collector: Server
let collectorPort = 0
const envelopes: string[] = []

beforeAll(async () => {
  collector = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      const body = req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw
      envelopes.push(body.toString('utf8'))
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })
  await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve))
  collectorPort = (collector.address() as { port: number }).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => collector.close(() => resolve()))
})

beforeEach(() => {
  envelopes.length = 0
})

interface ChildResult {
  initialised: boolean
  statuses: number[]
}

// Runs the child with the given env (an undefined value removes the variable).
function runChild(
  env: Record<string, string | undefined>,
  requests: Array<{ path: string; headers?: Record<string, string> }>,
): Promise<ChildResult> {
  const childEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) childEnv[key] = value
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key]
    else childEnv[key] = value
  }
  childEnv.SENTRY_CHILD_REQUESTS = JSON.stringify(requests)

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--import', INSTRUMENT, CHILD],
      { cwd: API_ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    const killer = setTimeout(() => child.kill('SIGKILL'), CHILD_TIMEOUT_MS - 5_000)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(killer)
      const line = stdout.split('\n').find((l) => l.startsWith(RESULT_PREFIX))
      if (code !== 0 || !line) {
        reject(new Error(`sentry child exited ${code} without a result line:\n${stderr.slice(-2000)}`))
        return
      }
      resolve(JSON.parse(line.slice(RESULT_PREFIX.length)) as ChildResult)
    })
  })
}

// Transactions from every envelope the collector received. An envelope is a header line,
// then pairs of (item header, item payload) lines.
interface SentryTransaction {
  transaction: string
  spans?: Array<Record<string, unknown>>
}

function transactions(): SentryTransaction[] {
  const out: SentryTransaction[] = []
  for (const body of envelopes) {
    const lines = body.split('\n')
    for (let i = 1; i < lines.length; i += 2) {
      const header = parseJson(lines[i]) as { type?: string } | undefined
      const payload = parseJson(lines[i + 1]) as SentryTransaction | undefined
      if (header?.type === 'transaction' && payload) out.push(payload)
    }
  }
  return out
}

function parseJson(line: string | undefined): unknown {
  if (!line) return undefined
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

const dsn = () => `http://public@127.0.0.1:${collectorPort}/1`

describe('Sentry is off without SENTRY_DSN', () => {
  test('nothing is initialised and no envelope is sent', async () => {
    const result = await runChild({ SENTRY_DSN: undefined, SENTRY_TRACES_SAMPLE_RATE: '1' }, [
      { path: '/api/health' },
    ])
    expect(result).toEqual({ initialised: false, statuses: [200] })
    expect(envelopes).toHaveLength(0)
  }, CHILD_TIMEOUT_MS)
})

describe.skipIf(!process.env.DATABASE_URL)('performance traces against MySQL', () => {
  test(
    'one transaction per request, named by route pattern, with mysql2 db spans and no inlined parameters',
    async () => {
      const result = await runChild({ SENTRY_DSN: dsn(), SENTRY_TRACES_SAMPLE_RATE: '1' }, [
        { path: '/api/recipes/trace-check-code', headers: { Authorization: `Bearer ${SECRET}` } },
      ])
      expect(result.initialised).toBe(true)

      const named = transactions().filter((t) => t.transaction === 'GET /api/recipes/:code')
      expect(named).toHaveLength(1)
      const dbSpans = (named[0].spans ?? []).filter((s) => s.op === 'db')
      expect(dbSpans.length).toBeGreaterThan(0)
      expect(JSON.stringify(dbSpans)).not.toContain('trace-check-code')
    },
    CHILD_TIMEOUT_MS,
  )

  test('the Authorization header value never reaches Sentry', async () => {
    await runChild({ SENTRY_DSN: dsn(), SENTRY_TRACES_SAMPLE_RATE: '1' }, [
      { path: '/api/recipes/trace-check-code', headers: { Authorization: `Bearer ${SECRET}` } },
    ])
    expect(envelopes.length).toBeGreaterThan(0)
    expect(envelopes.join('\n')).not.toContain(SECRET)
  }, CHILD_TIMEOUT_MS)
})
