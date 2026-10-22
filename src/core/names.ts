import { UsageError } from './args.ts'

/** `ste` is one-shot, `mte` lives for a process, `lte` is tied to a real account. */
export const TIERS = ['ste', 'mte', 'lte'] as const
export type Tier = (typeof TIERS)[number]

/** The instance's `ADDRESS_CHECK_REGEX`, and `MAX_ADDRESS_LEN`. */
export const NAME_REGEX = /^(ste|mte|lte)-[0-9]{4}(-[a-z0-9]{1,12})?-[a-z0-9]{3}$/
export const MAX_NAME_LENGTH = 30

const SITE = /^[a-z0-9]{1,12}$/
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function parseTier(raw: string | undefined): Tier {
  if (!TIERS.includes(raw as Tier)) throw new UsageError(`tier must be one of: ${TIERS.join(', ')}`)
  return raw as Tier
}

export function parseSite(tier: Tier, raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  if (tier === 'ste') throw new UsageError('ste addresses are one-shot and take no --site')
  const site = raw.toLowerCase()
  if (!SITE.test(site)) throw new UsageError(`--site must be 1 to 12 of [a-z0-9], not "${raw}"`)
  return site
}

/** Rejection sampling, so every character is equally likely. */
export function randomChars(count: number): string {
  let out = ''
  while (out.length < count) {
    for (const byte of crypto.getRandomValues(new Uint8Array(count))) {
      if (byte < 252 && out.length < count) out += ALPHABET[byte % ALPHABET.length]
    }
  }
  return out
}

/** `{tier}-{YYMM}[-{site}]-{rand3}`, with the UTC month. */
export function generateName(
  tier: Tier,
  site: string | undefined,
  now = new Date(),
  random = randomChars,
): string {
  const yymm = now.toISOString().slice(2, 7).replace('-', '')
  const name = [tier, yymm, site, random(3)].filter(Boolean).join('-')
  if (!NAME_REGEX.test(name) || name.length > MAX_NAME_LENGTH) {
    throw new Error(`generated "${name}", which the instance would reject`)
  }
  return name
}

/** Tier and site of a name that follows the scheme, or `undefined` for a custom one. */
export function parseName(name: string): { tier: Tier; site?: string } | undefined {
  const match = NAME_REGEX.exec(name)
  if (!match) return undefined
  const site = match[2]?.slice(1)
  return site ? { tier: match[1] as Tier, site } : { tier: match[1] as Tier }
}
