import * as Sentry from '@sentry/node'
import { sentryInitOptions } from './sentry-options.js'

// Production starts the API with `node --import <dist>/instrument.js <dist>/server.js`
// (Dockerfile CMD and deploy/oci/shiftgate/services.yaml). That preload is what lets the
// SDK patch hono and mysql2 in ESM. server.ts also imports this file (dev via tsx);
// ESM evaluates a module once per URL, and the guard below covers any other double load.
const options = sentryInitOptions(process.env)
if (options && !Sentry.getClient()) Sentry.init(options)
