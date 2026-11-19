// The API must start with the Sentry instrument preloaded (`--import`), in both places
// that define the production command. The migrate step must not load it.
// Source-level: the image itself is built by .github/workflows/image.yml.

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const dockerfile = readFileSync(new URL('../../../Dockerfile', import.meta.url), 'utf8')
const servicesYaml = readFileSync(
  new URL('../../../deploy/oci/shiftgate/services.yaml', import.meta.url),
  'utf8',
)

describe('production start command preloads the Sentry instrument', () => {
  test('Dockerfile CMD loads dist/instrument.js before dist/server.js', () => {
    expect(dockerfile).toContain('CMD ["node", "--import", "/app/dist/instrument.js", "/app/dist/server.js"]')
  })

  test('shiftgate args load it for the API only, after migrate.ts', () => {
    const argsLine = servicesYaml.split('\n').find((line) => line.includes('/app/dist/server.js'))
    expect(argsLine).toBeDefined()
    expect(argsLine).toContain(
      'migrate.ts && exec node --import /app/dist/instrument.js /app/dist/server.js',
    )
  })
})
