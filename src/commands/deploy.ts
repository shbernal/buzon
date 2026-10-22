import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { stringFlag, UsageError, type Parsed } from '../core/args.ts'
import { normalizeTag, writeConfig, type Config } from '../core/config.ts'
import { paths } from '../core/paths.ts'
import { withPrompt, type Ask } from '../core/prompt.ts'
import {
  addedDbFiles,
  changelogMentions,
  checkout,
  databaseName,
  prepare,
  requireTools,
  run,
  templateDiff,
  wrangler,
} from '../core/upstream.ts'
import type { Context } from './context.ts'
import { verify } from './init.ts'

export type DeployResult = { tag: string; url: string; dryRun: boolean; version?: string }
export type ExportResult = { file: string; pruned: string[] }
export type UpgradeResult = {
  from: string
  to: string
  backup?: string
  applied: string[]
  skipped: string[]
  version: string
}

/** Backups kept by `export-db`, oldest pruned first. */
const KEEP = 12

const say = (line: string) => console.error(line)

function deployedTag(config: Config): string {
  if (!config.tag) throw new UsageError('no tag in the config: run `buzon deploy --tag vX.Y.Z`')
  return config.tag
}

/** The new Worker can take a few seconds to answer everywhere. */
async function awaitVersion(context: Context, tag: string): Promise<string> {
  let version = ''
  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await Bun.sleep(3000)
    version = await verify(context.config, context.api)
    if (version === tag) return version
  }
  throw new Error(`${context.config.url} still reports ${version} after deploying ${tag}`)
}

async function ship(context: Context, tag: string, dryRun: boolean): Promise<DeployResult> {
  const dir = await prepare(tag)
  await run(['pnpm', 'run', 'build:pages'], join(dir, 'frontend'))
  const { url } = context.config
  if (dryRun) {
    await wrangler(dir, ['deploy', '--minify', '--dry-run'])
    return { tag, url, dryRun }
  }
  await wrangler(dir, ['deploy', '--minify'])
  const version = await awaitVersion(context, tag)
  writeConfig({ ...context.config, tag })
  return { tag, url, dryRun, version }
}

/** Secrets already live on the Worker: a deploy never sends them. */
export function deploy({ flags }: Pick<Parsed, 'flags'>, context: Context): Promise<DeployResult> {
  const raw = stringFlag(flags, 'tag')
  const tag = raw ? normalizeTag(raw) : deployedTag(context.config)
  return ship(context, tag, flags['dry-run'] === true)
}

export function deployText(result: DeployResult): string {
  if (result.dryRun) return `${result.tag} built and checked, nothing deployed`
  return `${result.url} runs ${result.version}`
}

const stamp = () =>
  new Date()
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replaceAll(':', '-')

/** The dump goes through `wrangler` in the checkout, so `dir` is made absolute first. */
async function exportTo(out: string, tag: string): Promise<ExportResult> {
  const dir = resolve(out)
  mkdirSync(dir, { recursive: true })
  const checkoutDir = await prepare(tag)
  const file = join(dir, `${stamp()}.sql`)
  await wrangler(checkoutDir, ['d1', 'export', databaseName(), '--remote', '--output', file])
  const dumps = readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T[\d-]+Z\.sql$/.test(name))
    .toSorted()
  const pruned = dumps.slice(0, Math.max(0, dumps.length - KEEP)).map((name) => join(dir, name))
  for (const old of pruned) rmSync(old)
  return { file, pruned }
}

export function exportDb(
  { flags }: Pick<Parsed, 'flags'>,
  context: Context,
): Promise<ExportResult> {
  return exportTo(stringFlag(flags, 'out') ?? paths.backups, deployedTag(context.config))
}

export function exportDbText(result: ExportResult): string {
  const pruned = result.pruned.length > 0 ? `\npruned ${result.pruned.length} older dumps` : ''
  return `wrote ${result.file}${pruned}`
}

type Answer = 'yes' | 'skip' | 'stop'

async function confirm(ask: Ask, question: string, skippable: boolean): Promise<Answer> {
  const choices = skippable ? 'y/s/N' : 'y/N'
  const answer = (await ask(`${question} (${choices})`)).toLowerCase()
  if (answer === 'y' || answer === 'yes') return 'yes'
  if (skippable && (answer === 's' || answer === 'skip')) return 'skip'
  return 'stop'
}

function review(older: string, newer: string, patches: string[]): void {
  const diff = templateDiff(older, newer)
  say(diff ? `wrangler.toml.template changes:\n${diff}` : 'wrangler.toml.template is unchanged')
  if (patches.length === 0) {
    say('no new db/ files')
    return
  }
  say('new db/ files:')
  for (const patch of patches) {
    const mentions = changelogMentions(newer, patch)
    say(`  ${patch}${mentions.length === 0 ? ' (not in the changelog)' : ''}`)
    for (const line of mentions) say(`    ${line}`)
  }
}

/** Every step is asked for: nothing runs against the live database unreviewed. */
export async function upgrade(
  { flags }: Pick<Parsed, 'flags'>,
  context: Context,
  interactive: boolean,
): Promise<UpgradeResult> {
  const raw = stringFlag(flags, 'to')
  if (!raw) throw new UsageError('usage: buzon upgrade --to vX.Y.Z')
  const to = normalizeTag(raw)
  const from = deployedTag(context.config)
  if (from === to) throw new UsageError(`the instance already runs ${to}`)
  if (!interactive)
    throw new UsageError('buzon upgrade asks before each step: run it on a terminal')

  requireTools()
  const older = await checkout(from)
  const newer = await checkout(to)
  const patches = addedDbFiles(older, newer)
  review(older, newer, patches)

  return withPrompt(async (ask) => {
    const result: UpgradeResult = { from, to, applied: [], skipped: [], version: from }
    if ((await confirm(ask, 'Export the database first?', false)) === 'yes') {
      result.backup = (await exportTo(paths.backups, from)).file
      say(`wrote ${result.backup}`)
    }
    const dir = await prepare(to)
    for (const patch of patches) {
      const answer = await confirm(ask, `Run db/${patch} against the live database?`, true)
      if (answer === 'stop') throw new Error(`upgrade stopped before db/${patch}`)
      if (answer === 'skip') {
        result.skipped.push(patch)
        continue
      }
      await wrangler(dir, ['d1', 'execute', databaseName(), '--remote', `--file=../db/${patch}`])
      result.applied.push(patch)
    }
    if ((await confirm(ask, `Deploy ${to}?`, false)) !== 'yes') {
      throw new Error(`upgrade stopped before deploying ${to}`)
    }
    result.version = (await ship(context, to, false)).version ?? to
    return result
  })
}

export function upgradeText(result: UpgradeResult): string {
  const lines = [`${result.from} -> ${result.version}`]
  if (result.backup) lines.push(`backup: ${result.backup}`)
  if (result.applied.length > 0) lines.push(`applied: ${result.applied.join(', ')}`)
  if (result.skipped.length > 0) lines.push(`skipped: ${result.skipped.join(', ')}`)
  return lines.join('\n')
}
