// Applies packages/db/migrations-mysql/*.sql in name order, once each.
//
// The baseline uses the mysql CLI's DELIMITER directive for its triggers, which the
// server cannot parse, so splitMysqlScript() implements the same rule client-side:
// statements end at the current delimiter outside quotes and comments.

import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createConnection } from 'mysql2/promise'

export const MYSQL_MIGRATION_TABLE = 'schema_migrations'
const LOCK_NAME = 'brewdial_schema_migrations'
const MIGRATION_FILE = /^\d{3}_[a-z0-9_]+\.sql$/

export function splitMysqlScript(script: string): string[] {
  const statements: string[] = []
  const n = script.length
  let delimiter = ';'
  let buf = ''
  let i = 0

  const pushStatement = () => {
    const text = buf.trim()
    if (text !== '') statements.push(text)
    buf = ''
  }

  while (i < n) {
    const blank = buf.trim() === ''

    // `DELIMITER x` is a client directive: it only appears between statements.
    if (blank) {
      const directive = /^DELIMITER[ \t]+(\S+)[ \t]*(?:\r?\n|$)/i.exec(script.slice(i, i + 200))
      if (directive) {
        delimiter = directive[1]
        buf = ''
        i += directive[0].length
        continue
      }
    }

    const ch = script[i]

    // Line comments: `-- ` (dash dash whitespace) and `#`. Dropped between statements.
    const isDashComment =
      ch === '-' && script[i + 1] === '-' && (i + 2 >= n || /\s/.test(script[i + 2]))
    if (isDashComment || ch === '#') {
      const end = script.indexOf('\n', i)
      const stop = end === -1 ? n : end
      if (!blank) buf += script.slice(i, stop)
      i = stop
      continue
    }

    // Block comments are opaque, so a `;` inside one does not end a statement.
    if (ch === '/' && script[i + 1] === '*') {
      const end = script.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      if (!blank) buf += script.slice(i, stop)
      i = stop
      continue
    }

    // Quoted strings and identifiers. '\' escapes inside string literals, and a doubled
    // quote is a literal quote character.
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < n) {
        if (script[j] === '\\' && ch !== '`') {
          j += 2
          continue
        }
        if (script[j] === ch) {
          if (script[j + 1] === ch) {
            j += 2
            continue
          }
          break
        }
        j += 1
      }
      buf += script.slice(i, j + 1)
      i = j + 1
      continue
    }

    if (script.startsWith(delimiter, i)) {
      pushStatement()
      i += delimiter.length
      continue
    }

    buf += ch
    i += 1
  }
  pushStatement()
  return statements
}

export interface MysqlMigrationResult {
  applied: string[]
  alreadyApplied: string[]
}

export function checksumOf(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export async function listMysqlMigrations(dir: string): Promise<string[]> {
  const names = (await readdir(dir)).filter((f) => MIGRATION_FILE.test(f))
  return names.sort()
}

/**
 * Apply every pending migration in `dir` over one connection. Each file is recorded in
 * `schema_migrations` with its SHA-256; a recorded file whose content has since changed
 * is an error, not a silent skip. DDL commits per statement in MySQL, so a failed file
 * is not recorded and is retried on the next run.
 */
export async function migrateMysql(
  url: string,
  dir: string,
  log: (line: string) => void = console.log,
): Promise<MysqlMigrationResult> {
  const files = await listMysqlMigrations(dir)
  const connection = await createConnection({ uri: url, timezone: 'Z', multipleStatements: false })
  try {
    await connection.query("set time_zone = '+00:00'")
    const [lockRows] = await connection.query('select get_lock(?, 60) as locked', [LOCK_NAME])
    if ((lockRows as unknown as Array<{ locked: number | null }>)[0]?.locked !== 1) {
      throw new Error(`could not take migration lock ${LOCK_NAME}`)
    }
    try {
      await connection.query(`
        create table if not exists ${MYSQL_MIGRATION_TABLE} (
          version    varchar(128) not null primary key,
          checksum   char(64)     not null,
          applied_at datetime(6)  not null default (utc_timestamp(6))
        ) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs`)

      const [rows] = await connection.query(`select version, checksum from ${MYSQL_MIGRATION_TABLE}`)
      const recorded = new Map(
        (rows as unknown as Array<{ version: string; checksum: string }>).map((r) => [r.version, r.checksum]),
      )

      const result: MysqlMigrationResult = { applied: [], alreadyApplied: [] }
      for (const file of files) {
        const version = file.replace(/\.sql$/, '')
        const text = await readFile(path.join(dir, file), 'utf8')
        const checksum = checksumOf(text)
        const known = recorded.get(version)
        if (known !== undefined) {
          if (known !== checksum) {
            throw new Error(`migration ${version} changed after it was applied (checksum mismatch)`)
          }
          result.alreadyApplied.push(version)
          continue
        }

        // The Kotlin copy tool starts Spring Boot against the MySQL target, so
        // Flyway applies V1__baseline.sql before copying. That file's SQL body
        // is kept byte-identical to 001_baseline.sql. Adopt only Flyway's
        // successful V1 record; trying to replay the baseline would fail on
        // the already-created tables and prevent the Node service from booting.
        if (version === '001_baseline') {
          const [flywayTableRows] = await connection.query(
            `select count(*) as count from information_schema.tables
             where table_schema = database() and table_name = 'flyway_schema_history'`,
          )
          const flywayTableExists = Number(
            (flywayTableRows as unknown as Array<{ count: number }>)[0]?.count ?? 0,
          ) > 0
          if (flywayTableExists) {
            const [flywayRows] = await connection.query(
              `select script from flyway_schema_history
               where version = '1' and success = 1 and script = 'V1__baseline.sql' limit 1`,
            )
            if ((flywayRows as unknown[]).length > 0) {
              await connection.query(
                `insert into ${MYSQL_MIGRATION_TABLE} (version, checksum) values (?, ?)`,
                [version, checksum],
              )
              result.alreadyApplied.push(version)
              log(`adopted ${version} from successful Flyway V1__baseline.sql`)
              continue
            }
          }
        }

        const statements = splitMysqlScript(text)
        for (const [index, statement] of statements.entries()) {
          try {
            await connection.query(statement)
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err)
            throw new Error(`migration ${version} failed at statement ${index + 1}/${statements.length}: ${reason}`)
          }
        }
        await connection.query(
          `insert into ${MYSQL_MIGRATION_TABLE} (version, checksum) values (?, ?)`,
          [version, checksum],
        )
        result.applied.push(version)
        log(`applied ${version} (${statements.length} statements)`)
      }

      if (result.applied.length === 0) {
        log(`nothing to apply (${result.alreadyApplied.length} already applied)`)
      }
      return result
    } finally {
      await connection.query('select release_lock(?)', [LOCK_NAME])
    }
  } finally {
    await connection.end()
  }
}
