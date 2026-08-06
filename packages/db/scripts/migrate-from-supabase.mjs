#!/usr/bin/env node
// M6 data migration: pull every BrewDial table from Supabase (PostgREST,
// service_role) and load it into the OCI Postgres. Idempotent full-replace
// (TRUNCATE + load). Runs as the brewdial_app role (table owner) — no superuser
// needed: recipes' user triggers (bean-link + owner guard) are disabled around
// the recipes load so owner_id/is_official/created_by/bean_id import verbatim;
// FK integrity is preserved by insert order. recipe_code_seq is set from MAX(code).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL (brewdial_app).
// Run from packages/db so `pg` resolves: `node scripts/migrate-from-supabase.mjs`
import pg from 'pg'

const SUPABASE_URL = req('SUPABASE_URL')
const SERVICE_KEY = req('SUPABASE_SERVICE_ROLE_KEY')
const DATABASE_URL = req('DATABASE_URL')

function req(k) { const v = process.env[k]; if (!v) { console.error(`missing env ${k}`); process.exit(1) } return v }

// FK-dependency order: parents before children.
const LOAD_ORDER = [
  'grinders', 'drippers', 'beans', 'app_users', 'preferences', 'bd_migration_meta',
  'recipes', 'feedback', 'user_gear', 'grinder_calibration', 'saved_recipes', 'saved_beans',
  'bean_photos', 'bean_purchase_links',
]

async function fetchAll(table) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=100000`
  const res = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } })
  if (!res.ok) throw new Error(`Supabase GET ${table} -> ${res.status} ${await res.text()}`)
  return res.json()
}

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    console.log('== TRUNCATE target tables (full replace) ==')
    await client.query(`truncate ${LOAD_ORDER.join(', ')} restart identity cascade`)

    const summary = []
    for (const t of LOAD_ORDER) {
      const rows = await fetchAll(t)
      if (t === 'recipes') await client.query('alter table recipes disable trigger user')
      let n = 0
      for (const row of rows) {
        // jsonb_populate_record coerces every column type (jsonb/text[]/timestamptz/uuid) from the JSON row.
        await client.query(
          `insert into ${t} select * from jsonb_populate_record(null::${t}, $1::jsonb) on conflict do nothing`,
          [JSON.stringify(row)],
        )
        n++
      }
      if (t === 'recipes') await client.query('alter table recipes enable trigger user')
      const got = (await client.query(`select count(*)::int n from ${t}`)).rows[0].n
      summary.push({ table: t, supabase: rows.length, oci: got, match: rows.length === got })
      console.log(`  ${t.padEnd(22)} supabase=${rows.length}  oci=${got}  ${rows.length === got ? 'OK' : 'MISMATCH'}`)
    }

    // Advance recipe_code_seq past the max imported COF code so new codes don't collide.
    const seq = await client.query(
      `select setval('recipe_code_seq', (select coalesce(max((substring(code from 5))::int),0) from recipes), true) as v`,
    )
    console.log(`== recipe_code_seq set to ${seq.rows[0].v} ==`)

    const bad = summary.filter((s) => !s.match)
    if (bad.length) { console.error('COUNT MISMATCH:', bad); process.exit(2) }
    console.log('== ALL TABLES MATCH — migration load complete ==')
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error('MIGRATION FAILED:', e); process.exit(1) })
