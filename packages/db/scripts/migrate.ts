// `pnpm db:migrate` entry point: dispatches on the DATABASE_URL scheme.
//   postgres:// | postgresql://  → node-pg-migrate over migrations/ (unchanged behavior)
//   mysql://                      → migrations-mysql/ via migrate-mysql.ts

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { vendorFromUrl } from '../src/vendor.js'
import { migrateMysql } from './migrate-mysql.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pgMigrations = 'migrations'
const mysqlMigrations = path.join(here, '..', 'migrations-mysql')

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set')
    return 1
  }
  const vendor = vendorFromUrl(url)
  if (vendor === 'postgresql') {
    const run = spawnSync('node-pg-migrate', ['-m', pgMigrations, '-j', 'sql', 'up'], {
      stdio: 'inherit',
      env: process.env,
    })
    return run.status ?? 1
  }
  await migrateMysql(url, mysqlMigrations)
  return 0
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  },
)
