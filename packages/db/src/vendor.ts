// The database is MySQL (HeatWave in production). DATABASE_URL must be a mysql:// URL.
// Kept free of driver imports so the migration dispatcher (scripts/migrate.ts) can use
// it without loading mysql2.

export type DbVendor = 'mysql'

export const ACCEPTED_DATABASE_SCHEMES = ['mysql://'] as const

export function vendorFromUrl(url: string): DbVendor {
  // Never echo the URL itself: it carries the password.
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim())
  const scheme = match ? match[1].toLowerCase() : ''
  switch (scheme) {
    case 'mysql':
      return 'mysql'
    case 'postgres':
    case 'postgresql':
      throw new Error('DATABASE_URL points at PostgreSQL, which is no longer supported; use a mysql:// URL')
    default:
      throw new Error(
        `DATABASE_URL scheme "${scheme || '(none)'}" is not supported; ` +
          `use ${ACCEPTED_DATABASE_SCHEMES.join(', ')}`,
      )
  }
}
