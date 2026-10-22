import { readFileSync } from 'node:fs'
import { paths } from './paths.ts'
import { writeAtomic } from './files.ts'

export type Config = {
  /** Origin of the instance, without a trailing slash: `https://mail.example.com`. */
  url: string
  /** Domain the addresses are created on: `example.com`. */
  domain: string
  /** Upstream release the instance runs, as `buzon deploy` last shipped it: `v1.13.0`. */
  tag?: string
}

export class ConfigMissingError extends Error {
  constructor(file: string) {
    super(`no config at ${file}. Run \`buzon init\` first.`)
  }
}

export function normalizeUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`"${raw}" is not a URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`"${raw}" is not an http(s) URL`)
  }
  return url.origin
}

export function normalizeDomain(raw: string): string {
  const domain = raw.trim().toLowerCase()
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new Error(`"${raw}" is not a domain`)
  return domain
}

export function normalizeTag(raw: string): string {
  const tag = raw.trim()
  if (!/^v\d+\.\d+\.\d+$/.test(tag))
    throw new Error(`"${raw}" is not a release tag such as v1.13.0`)
  return tag
}

export function parseConfig(text: string, file = paths.config): Config {
  let raw: Record<string, unknown>
  try {
    raw = Bun.TOML.parse(text) as Record<string, unknown>
  } catch (error) {
    throw new Error(`${file} is not valid TOML`, { cause: error })
  }
  const { url, domain, tag } = raw
  if (typeof url !== 'string') throw new Error(`${file}: \`url\` is missing`)
  if (typeof domain !== 'string') throw new Error(`${file}: \`domain\` is missing`)
  const config: Config = { url: normalizeUrl(url), domain: normalizeDomain(domain) }
  if (tag !== undefined) {
    if (typeof tag !== 'string') throw new Error(`${file}: \`tag\` must be a string`)
    config.tag = normalizeTag(tag)
  }
  return config
}

export function readConfig(file = paths.config): Config {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ConfigMissingError(file)
    throw error
  }
  return parseConfig(text, file)
}

/** JSON string escapes are valid TOML basic-string escapes, so `JSON.stringify` quotes safely. */
export function serializeConfig(config: Config): string {
  const lines = [`url = ${JSON.stringify(config.url)}`, `domain = ${JSON.stringify(config.domain)}`]
  if (config.tag) lines.push(`tag = ${JSON.stringify(config.tag)}`)
  return `${lines.join('\n')}\n`
}

export function writeConfig(config: Config, file = paths.config): void {
  writeAtomic(file, serializeConfig(config))
}
