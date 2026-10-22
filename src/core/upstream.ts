import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths.ts'

const REPO = 'https://github.com/dreamhunter2333/cloudflare_temp_email'

/** Upstream builds with pnpm, and the checkout is a git clone. */
export function requireTools(): void {
  for (const tool of ['git', 'pnpm']) {
    if (!Bun.which(tool)) throw new Error(`${tool} is not on PATH: buzon needs it to deploy`)
  }
}

/** The child's stdout goes to stderr, so `--json` output stays alone on stdout. */
export async function run(cmd: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(cmd, { cwd, stdin: 'inherit', stdout: 2 as never, stderr: 'inherit' })
  const code = await child.exited
  if (code !== 0) throw new Error(`\`${cmd.join(' ')}\` failed (exit ${code}) in ${cwd}`)
}

function capture(cmd: string[], cwd?: string): { code: number; out: string } {
  const result = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'inherit' })
  return { code: result.exitCode, out: result.stdout.toString() }
}

/** A shallow clone of `tag`, made on first use. Local edits stop a deploy from shipping them. */
export async function checkout(tag: string): Promise<string> {
  const dir = paths.upstream(tag)
  if (!existsSync(dir)) {
    await run(['git', 'clone', '--quiet', '--depth', '1', '--branch', tag, REPO, dir], '/')
    return dir
  }
  const status = capture(['git', 'status', '--porcelain'], dir)
  if (status.code !== 0) throw new Error(`${dir} is not a git checkout: remove it and retry`)
  if (status.out.trim()) throw new Error(`${dir} has local changes:\n${status.out.trimEnd()}`)
  return dir
}

/** Dependencies installed and the user's `wrangler.toml` copied into the worker. */
export async function prepare(tag: string): Promise<string> {
  requireTools()
  if (!existsSync(paths.wrangler)) throw new Error(`no wrangler config at ${paths.wrangler}`)
  const dir = await checkout(tag)
  for (const part of ['worker', 'frontend']) {
    await run(['pnpm', 'install', '--frozen-lockfile'], join(dir, part))
  }
  copyFileSync(paths.wrangler, join(dir, 'worker', 'wrangler.toml'))
  return dir
}

type WranglerToml = { d1_databases?: { database_name?: string }[] }

export function databaseName(file = paths.wrangler): string {
  const parsed = Bun.TOML.parse(readFileSync(file, 'utf8')) as WranglerToml
  const name = parsed.d1_databases?.[0]?.database_name
  if (!name) throw new Error(`${file} names no D1 database`)
  return name
}

/** `wrangler`, from the checkout's own dependencies. */
export function wrangler(dir: string, args: string[]): Promise<void> {
  return run(['pnpm', 'wrangler', ...args], join(dir, 'worker'))
}

/** The `db/` files the newer checkout has and the older one lacks, oldest first. */
export function addedDbFiles(older: string, newer: string): string[] {
  const before = new Set(readdirSync(join(older, 'db')))
  return readdirSync(join(newer, 'db'))
    .filter((file) => file.endsWith('.sql') && !before.has(file))
    .toSorted()
}

/** Changelog lines that name `file`. Some patches are never named there. */
export function changelogMentions(dir: string, file: string): string[] {
  const changelog = readFileSync(join(dir, 'CHANGELOG_EN.md'), 'utf8')
  return changelog
    .split('\n')
    .filter((line) => line.includes(file))
    .map((line) => line.trim())
}

/** A unified diff of the two `wrangler.toml.template` files, empty when they match. */
export function templateDiff(older: string, newer: string): string {
  const file = join('worker', 'wrangler.toml.template')
  const { code, out } = capture([
    'git',
    'diff',
    '--no-index',
    '--no-color',
    '--',
    join(older, file),
    join(newer, file),
  ])
  if (code > 1) throw new Error('could not diff the wrangler templates')
  return out
}
