// `pnpm db:migrate` entry point. The database is MySQL only: DATABASE_URL must be a
// mysql:// URL. Any other scheme (postgres:// included) fails here, before any connection.
//   mysql://  → migrations-mysql/ via migrate-mysql.ts

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { vendorFromUrl } from '../src/vendor.js'
import { migrateMysql } from './migrate-mysql.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const mysqlMigrations = path.join(here, '..', 'migrations-mysql')

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set')
    return 1
  }
  vendorFromUrl(url) // throws for postgres:// and every other non-mysql scheme
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
