// Database vendor is chosen by the DATABASE_URL scheme. Kept free of driver imports
// so the migration dispatcher (scripts/migrate.ts) can use it without loading pg/mysql2.

export type DbVendor = 'postgresql' | 'mysql'

export const ACCEPTED_DATABASE_SCHEMES = ['postgres://', 'postgresql://', 'mysql://'] as const

export function vendorFromUrl(url: string): DbVendor {
  // Never echo the URL itself: it carries the password.
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim())
  const scheme = match ? match[1].toLowerCase() : ''
  switch (scheme) {
    case 'postgres':
    case 'postgresql':
      return 'postgresql'
    case 'mysql':
      return 'mysql'
    default:
      throw new Error(
        `DATABASE_URL scheme "${scheme || '(none)'}" is not supported; ` +
          `use one of ${ACCEPTED_DATABASE_SCHEMES.join(', ')}`,
      )
  }
}
