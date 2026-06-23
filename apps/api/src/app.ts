import { Hono } from 'hono'
import { health } from './routes/health.js'
import { recipes } from './routes/recipes.js'
import { beans } from './routes/beans.js'
import { registries } from './routes/registries.js'
import { feedback } from './routes/feedback.js'
import { me } from './routes/me.js'
import { identityMiddleware } from './middleware/identity.js'

export const app = new Hono()

// Populate c.get('appUserId') for all /api routes — required before /me routes' requireIdentity guard.
app.use('/api/*', identityMiddleware)

app.route('/api', health)
app.route('/api/recipes', recipes)
app.route('/api/recipes', feedback)
app.route('/api/beans', beans)
app.route('/api', registries)
app.route('/api/me', me)
