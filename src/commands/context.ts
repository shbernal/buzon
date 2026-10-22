import { UsageError, type Parsed } from '../core/args.ts'
import type { Api } from '../core/api.ts'
import type { Config } from '../core/config.ts'

export type Context = { config: Config; api: Api }
export type Input = Pick<Parsed, 'positionals' | 'flags'>

/** A bare name gets the configured domain. */
export function resolveAddress(raw: string | undefined, config: Config, usage: string): string {
  if (!raw) throw new UsageError(usage)
  const address = raw.trim().toLowerCase()
  return address.includes('@') ? address : `${address}@${config.domain}`
}
