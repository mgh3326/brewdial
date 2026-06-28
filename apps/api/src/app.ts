import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { health } from './routes/health.js'
import { recipes } from './routes/recipes.js'
import { beans } from './routes/beans.js'
import { registries } from './routes/registries.js'
import { feedback } from './routes/feedback.js'
import { me } from './routes/me.js'
import { identityMiddleware } from './middleware/identity.js'
import { agentAuth } from './middleware/agent-auth.js'
import { agentRouter } from './routes/agent.js'

export const app = new Hono()

// Request log (method, path, status, duration) → journald. No headers/body, so no secret leak.
app.use('*', logger())

// CORS — must be BEFORE identityMiddleware so OPTIONS preflight is handled without auth.
// The Toss mini-app WebView calls cross-origin with a SPECIFIC Origin and is strict:
// `*` is rejected (it needs the exact origin echoed). Toss WebView origins are
// https://<appName>.apps.tossmini.com (live) and https://<appName>.private-apps.tossmini.com
// (console QR / pre-release test). appName = 'brewdial' (granite.config.ts). Plus the web hosts.
// Ref: developers-apps-in-toss.toss.im/development/test/toss.html "통신이 되지 않는 경우 → CORS".
const ALLOWED_ORIGINS = [
  'https://brewdial.apps.tossmini.com', // Toss live
  'https://brewdial.private-apps.tossmini.com', // Toss console QR / pre-release test
  'https://coffee.robinco.dev', // web
  'https://brewdial.robinco.dev', // web (alt host)
]
app.use(
  '/api/*',
  cors({
    origin: ALLOWED_ORIGINS,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-BrewDial-Identity'],
    credentials: true,
    maxAge: 86400,
  })
)

// Populate c.get('appUserId') for all /api routes — required before /me routes' requireIdentity guard.
app.use('/api/*', identityMiddleware)

// Agent surface — gate with agent token BEFORE mounting the router.
// /api/agent/* is distinct from all M3 public routes (/api/recipes, /api/beans, /api/me, /api/health, etc.).
app.use('/api/agent/*', agentAuth)
app.route('/api/agent', agentRouter)

app.route('/api', health)
app.route('/api/recipes', recipes)
app.route('/api/recipes', feedback)
app.route('/api/beans', beans)
app.route('/api', registries)
app.route('/api/me', me)
