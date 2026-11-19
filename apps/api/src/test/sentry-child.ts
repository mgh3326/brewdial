// Child process for sentry-traces.test.ts. Started the way production starts the API:
//   node --import tsx --import <src/instrument.ts> <this file>
// so the SDK is preloaded before hono and mysql2 are imported.
//
// Input: SENTRY_CHILD_REQUESTS, a JSON array of { path, headers? } sent to the real app
// over HTTP (a Node http server, so the SDK's http transaction exists).
// Output: one stdout line, prefixed SENTRY_CHILD_RESULT=, with whether a Sentry client
// exists and the response status of each request.

import type { Server } from 'node:http'
import { serve, type ServerType } from '@hono/node-server'
import * as Sentry from '@sentry/node'
import { createApp } from '../app.js'

interface ChildRequest {
  path: string
  headers?: Record<string, string>
}

const requests: ChildRequest[] = JSON.parse(process.env.SENTRY_CHILD_REQUESTS ?? '[]')
const app = createApp()

const server: ServerType = await new Promise((resolve) => {
  const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(s))
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('server did not bind a TCP port')

const statuses: number[] = []
for (const req of requests) {
  const res = await fetch(`http://127.0.0.1:${address.port}${req.path}`, { headers: req.headers })
  statuses.push(res.status)
  await res.text()
}

const initialised = Boolean(Sentry.getClient())
// Close the keep-alive sockets and wait for the server to close, so every request's
// span has ended before the flush sends the transactions.
;(server as Server).closeAllConnections()
await new Promise<void>((resolve) => server.close(() => resolve()))
await Sentry.flush(5000)
process.stdout.write(`SENTRY_CHILD_RESULT=${JSON.stringify({ initialised, statuses })}\n`)
process.exit(0)
