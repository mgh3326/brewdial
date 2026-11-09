// No database: the splitter must hand the server one statement at a time, including
// trigger bodies written under the mysql client's DELIMITER directive.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'
import { checksumOf, listMysqlMigrations, splitMysqlScript } from '../scripts/migrate-mysql.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(here, '..', 'migrations-mysql')

test('splits plain statements on the default delimiter', () => {
  expect(splitMysqlScript('select 1;\nselect 2;\n')).toEqual(['select 1', 'select 2'])
})

test('a DELIMITER $$ block keeps the semicolons inside a trigger body', () => {
  const script = [
    'DELIMITER $$',
    'create trigger t_bi before insert on t for each row',
    'begin',
    '  set new.a = 1;',
    '  set new.b = 2;',
    'end$$',
    'DELIMITER ;',
    'select 3;',
  ].join('\n')
  const statements = splitMysqlScript(script)
  expect(statements).toHaveLength(2)
  expect(statements[0]).toMatch(/^create trigger t_bi/)
  expect(statements[0]).toContain('set new.a = 1;')
  expect(statements[0]).toMatch(/end$/)
  expect(statements[1]).toBe('select 3')
})

test('semicolons inside quotes and comments do not end a statement; trailing comments are dropped', () => {
  const script = [
    "insert into t values ('a;b', 'it''s; ok', \"x;y\", `z;w`);",
    '-- a comment; with a semicolon',
    'select 1 /* block; comment */ + 1;',
    '-- trailing comment only',
  ].join('\n')
  expect(splitMysqlScript(script)).toEqual([
    "insert into t values ('a;b', 'it''s; ok', \"x;y\", `z;w`)",
    'select 1 /* block; comment */ + 1',
  ])
})

test('backslash escapes inside string literals are honored', () => {
  expect(splitMysqlScript("select 'a\\';b'; select 2;")).toEqual(["select 'a\\';b'", 'select 2'])
})

test('migrations split into statements with no client directives left', async () => {
  const names = await listMysqlMigrations(migrationsDir)
  expect(names).toEqual(['001_baseline.sql', '002_feedback_recipe_snapshot.sql'])
  const scripts = await Promise.all(names.map((name) => readFile(path.join(migrationsDir, name), 'utf8')))
  const statements = scripts.map(splitMysqlScript)
  expect(statements.flat().some((s) => /^delimiter/i.test(s))).toBe(false)
  expect(statements[0].filter((s) => /^create trigger /i.test(s))).toHaveLength(15)
  expect(statements[0].filter((s) => /^create table /i.test(s)).length).toBeGreaterThan(10)
  expect(statements[0].filter((s) => /^create sql security invoker view bean_summaries/i.test(s))).toHaveLength(1)
  expect(statements[1]).toHaveLength(1)
})

test('checksums are stable and content-sensitive', () => {
  expect(checksumOf('select 1')).toBe(checksumOf('select 1'))
  expect(checksumOf('select 1')).not.toBe(checksumOf('select 2'))
  expect(checksumOf('select 1')).toMatch(/^[0-9a-f]{64}$/)
})
