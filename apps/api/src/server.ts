import './instrument.js'
import { serve } from '@hono/node-server'
import { app } from './app.js'
import { loadConfig } from './config.js'

const { port } = loadConfig()
// Bind localhost by default: in production the backend is reached ONLY via the
// Cloudflare Tunnel (cloudflared connects to 127.0.0.1), so it must not listen
// on a public interface. Override with HOST=0.0.0.0 for container/dev use.
const hostname = process.env.HOST ?? '127.0.0.1'
serve({ fetch: app.fetch, port, hostname }, (i) =>
  console.log(`brewdial-api on ${hostname}:${i.port}`)
)
