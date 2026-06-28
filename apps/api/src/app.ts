import { Hono } from 'hono'
import { cors } from 'hono/cors'
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

// CORS — must be BEFORE identityMiddleware so OPTIONS preflight is handled without auth.
// Header-auth only (X-BrewDial-Identity, Authorization: Bearer) — no cookies → '*' is safe.
app.use(
  '/api/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-BrewDial-Identity'],
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
