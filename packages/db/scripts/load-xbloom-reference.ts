#!/usr/bin/env tsx
// #589: load the xbloom.lodywgumce.tv reference recipes (25 YAML: hot 17 + iced 8)
// as status='reference' recipes, or verify already-loaded rows.
// Logic, idempotency key and storage rules: src/xbloom-reference.ts (header).
//
//   pnpm --filter @brewdial/db load:xbloom-reference [options]
//
//   --verify            roundtrip-check loaded rows instead of loading
//   --expect <n>        (--verify) also fail unless exactly n rows exist
//   --cache-dir <dir>   store fetched pages/YAML here (keep it OUTSIDE the repo —
//                       the site has no license notice); --verify reads it first
//   --offline           serve everything from --cache-dir, never hit the network
//   --site <url>        default https://xbloom.lodywgumce.tv/
//   --delay-ms <n>      gap between requests, default 1500, min 1000 for a remote site
//   --allow-remote-db   required when DATABASE_URL is not localhost / a unix socket
//   --json <file>       also write the summary as JSON
//
// Exit code: number of failed items (0 = all loaded / verified), capped at 254;
// 255 = fatal (bad args, non-local DB without --allow-remote-db, migration 007
// missing, index unreachable, or --expect count mismatch).

import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import {
  closeDb,
  describeDatabaseUrl,
  FATAL_EXIT_CODE,
  getDb,
  loadXBloomReferences,
  MIN_SITE_DELAY_MS,
  PoliteFetcher,
  verifyXBloomReferences,
  XBLOOM_REFERENCE_SITE,
} from '../src/index.js'

const LOCAL_SITE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function fatal(msg: string): never {
  console.error(`fatal: ${msg}`)
  process.exit(FATAL_EXIT_CODE)
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      verify: { type: 'boolean', default: false },
      expect: { type: 'string' },
      'cache-dir': { type: 'string' },
      offline: { type: 'boolean', default: false },
      site: { type: 'string', default: XBLOOM_REFERENCE_SITE },
      'delay-ms': { type: 'string', default: '1500' },
      'allow-remote-db': { type: 'boolean', default: false },
      json: { type: 'string' },
    },
    strict: true,
  })

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) fatal('DATABASE_URL is not set')
  const target = describeDatabaseUrl(dbUrl)
  if (!target.local && !values['allow-remote-db']) {
    fatal(`refusing non-local DATABASE_URL (${target.label}) without --allow-remote-db`)
  }

  const site = new URL(values.site!)
  const siteIsLocal = LOCAL_SITE_HOSTS.has(site.hostname)
  if (site.protocol !== 'https:' && !siteIsLocal) fatal(`--site must be https: ${site.href}`)
  const delayMs = Number(values['delay-ms'])
  if (!Number.isInteger(delayMs) || delayMs < 0) fatal(`--delay-ms must be a non-negative integer`)
  if (delayMs < MIN_SITE_DELAY_MS && !siteIsLocal) {
    fatal(`--delay-ms must be >= ${MIN_SITE_DELAY_MS} for a remote site`)
  }
  if (values.offline && !values['cache-dir']) fatal('--offline requires --cache-dir')
  const expect = values.expect !== undefined ? Number(values.expect) : undefined
  if (expect !== undefined && !Number.isInteger(expect)) fatal('--expect must be an integer')

  const fetcher = new PoliteFetcher({
    delayMs,
    cacheDir: values['cache-dir'],
    offline: values.offline,
    preferCache: values.verify,
  })
  console.log(`${values.verify ? 'verify' : 'load'}: site=${site.href} db=${target.label} delay=${delayMs}ms`)

  const db = getDb()
  try {
    if (values.verify) {
      const s = await verifyXBloomReferences(db, { siteUrl: site.href, fetcher, expect })
      for (const i of s.items) {
        console.log(`${i.ok ? 'PASS' : 'FAIL'} ${i.code} ${i.sourceUrl}${i.ok ? '' : `\n     ${i.reasons.join('\n     ')}`}`)
      }
      if (s.countMismatch) console.log(`COUNT ${s.countMismatch}`)
      console.log(`verify: rows=${s.rows} passed=${s.passed} failed=${s.failed} requests=${s.requests} exit=${s.exitCode}`)
      if (values.json) await writeFile(values.json, JSON.stringify(s, null, 2))
      return s.exitCode
    }
    const s = await loadXBloomReferences(db, { siteUrl: site.href, fetcher, log: (l) => console.log(l) })
    for (const f of s.items.filter((i) => i.outcome === 'failed')) console.log(`SKIPPED ${f.url}: ${f.reason}`)
    if (s.fatal) console.log(`FATAL ${s.fatal}`)
    console.log(
      `load: pages=${s.pages} inserted=${s.inserted} updated=${s.updated} unchanged=${s.unchanged} ` +
        `failed=${s.failed} requests=${s.requests} exit=${s.exitCode}`,
    )
    if (values.json) await writeFile(values.json, JSON.stringify(s, null, 2))
    return s.exitCode
  } finally {
    await closeDb()
  }
}

main().then(
  (code) => process.exit(code),
  (err) => fatal(err instanceof Error ? (err.stack ?? err.message) : String(err)),
)
