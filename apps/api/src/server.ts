import './instrument.js'
import { serve } from '@hono/node-server'
import { app } from './app.js'
import { loadConfig } from './config.js'

const { port } = loadConfig()
serve({ fetch: app.fetch, port }, (i) =>
  console.log(`brewdial-api on :${i.port}`)
)
