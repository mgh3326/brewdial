// The db:migrate entry point refuses a PostgreSQL URL before it connects to anything.
// No database: the postgres:// branch throws before any driver is loaded.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('scripts/migrate.ts exits 1 with a clear message for a postgres:// URL and does not echo the password', () => {
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
    cwd: packageRoot,
    env: { ...process.env, DATABASE_URL: 'postgres://u:secret@127.0.0.1:5432/brewdial' },
    encoding: 'utf8',
  })
  expect(run.status).toBe(1)
  expect(run.stderr).toContain('DATABASE_URL points at PostgreSQL, which is no longer supported; use a mysql:// URL')
  expect(run.stderr).not.toContain('secret')
})
