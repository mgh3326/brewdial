import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { health } from './routes/health.js'
import { recipes } from './routes/recipes.js'
import { beans } from './routes/beans.js'
import { registries } from './routes/registries.js'
import { feedback } from './routes/feedback.js'
import { me } from './routes/me.js'
import { recommendations } from './routes/recommendations.js'
import { identityMiddleware } from './middleware/identity.js'
import { agentAuth } from './middleware/agent-auth.js'
import { agentRouter } from './routes/agent.js'

// Toss mini-app WebView calls cross-origin from these EXACT origins and rejects
// Access-Control-Allow-Origin: '*' — so we echo the specific origin + credentials.
// https://<appName>.apps.tossmini.com (live), https://<appName>.private-apps.tossmini.com
// (console QR / pre-release). appName='brewdial' (granite.config.ts). Plus the web hosts.
// Ref: developers-apps-in-toss.toss.im/development/test/toss.html "통신이 되지 않는 경우 → CORS".
const ALLOWED_ORIGINS = [
  'https://brewdial.apps.tossmini.com',
  'https://brewdial.private-apps.tossmini.com',
  'https://coffee.robinco.dev',
  'https://brewdial.robinco.dev',
]

// The API sub-app. Mounted at BOTH /api/* and /* below: the mini-app/web client's
// base URL omits the /api prefix (it calls GET /beans, /me/collections), while the
// MCP server and ops curls use /api/beans. Both resolve to the same handlers.
const api = new Hono()

// CORS BEFORE identity so OPTIONS preflight isn't auth-gated.
api.use(
  '*',
  cors({
    origin: ALLOWED_ORIGINS,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-BrewDial-Identity'],
    credentials: true,
    maxAge: 86400,
  })
)

// Populate c.get('appUserId') for all routes — required before /me's requireIdentity guard.
api.use('*', identityMiddleware)

// Agent surface — gate with the agent token BEFORE mounting the router.
api.use('/agent/*', agentAuth)
api.route('/agent', agentRouter)

api.route('/', health)
api.route('/recipes', recipes)
api.route('/recipes', feedback)
api.route('/beans', beans)
api.route('/recommendations', recommendations)
api.route('/', registries)
api.route('/me', me)

export const app = new Hono()

// Request log (method, path, status, duration) → journald. No headers/body, so no secret leak.
app.use('*', logger())

app.route('/api', api) // canonical: /api/beans, /api/agent/* (MCP, ops)
app.route('/', api) // mini-app/web client base omits /api: /beans, /me/collections
