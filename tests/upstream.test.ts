import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addedDbFiles,
  changelogMentions,
  databaseName,
  templateDiff,
} from '../src/core/upstream.ts'

/** A fake checkout holding only what the upgrade review reads. */
function release(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'buzon-upstream-'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  return dir
}

const older = release({
  'db/schema.sql': '',
  'db/2025-12-06-metadata.sql': '',
  'worker/wrangler.toml.template': '[vars]\nPREFIX = "tmp"\n',
})
const newer = release({
  'db/schema.sql': '',
  'db/2025-12-06-metadata.sql': '',
  'db/2026-09-01-redeem-codes.sql': '',
  'db/2026-04-03-raw-blob.sql': '',
  'db/README.md': '',
  'CHANGELOG_EN.md': '# v2\n- feat: need to execute `db/2026-04-03-raw-blob.sql`\n- other\n',
  'worker/wrangler.toml.template': '[vars]\nPREFIX = "tmp"\nNEW_VAR = true\n',
})

describe('upgrade review', () => {
  test('lists only the SQL files the newer release adds, oldest first', () => {
    expect(addedDbFiles(older, newer)).toEqual([
      '2026-04-03-raw-blob.sql',
      '2026-09-01-redeem-codes.sql',
    ])
  })

  test('finds the changelog lines that name a patch', () => {
    expect(changelogMentions(newer, '2026-04-03-raw-blob.sql')).toEqual([
      '- feat: need to execute `db/2026-04-03-raw-blob.sql`',
    ])
    expect(changelogMentions(newer, '2026-09-01-redeem-codes.sql')).toEqual([])
  })

  test('diffs the wrangler templates, and gives nothing when they match', () => {
    expect(templateDiff(older, newer)).toContain('+NEW_VAR = true')
    expect(templateDiff(older, older)).toBe('')
  })
})

describe('databaseName', () => {
  test('reads the first D1 binding', () => {
    const dir = release({
      'wrangler.toml': '[[d1_databases]]\nbinding = "DB"\ndatabase_name = "mail-db"\n',
    })
    expect(databaseName(join(dir, 'wrangler.toml'))).toBe('mail-db')
  })

  test('fails when there is none', () => {
    const dir = release({ 'wrangler.toml': 'name = "x"\n' })
    expect(() => databaseName(join(dir, 'wrangler.toml'))).toThrow('names no D1 database')
  })
})
