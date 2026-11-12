import { randomBytes } from 'node:crypto'
import { stringFlag, UsageError, type Parsed } from '../core/args.ts'
import { normalizeTag, readConfig } from '../core/config.ts'
import {
  findSecret,
  secret,
  SECRET_ENV,
  storeSecret,
  type SecretKey,
  type SecretOptions,
} from '../core/secrets.ts'
import { prepare, wranglerIn, type Wrangler } from '../core/upstream.ts'

/**
 * What to do with `JWT_SECRET`, which signs every address credential: `keep` pushes the stored
 * one, or leaves the Worker's as it is when none is stored; `rotate` makes and stores a new
 * one, which invalidates every address credential.
 */
export type JwtMode = 'keep' | 'rotate'

export type SecretsResult = { pushed: string[]; jwt: 'pushed' | 'rotated' | 'kept' }

export type SecretsDeps = {
  read?: (key: SecretKey) => string
  find?: (key: SecretKey) => string | undefined
  store?: (key: SecretKey, value: string) => void
  generate?: () => string
  env?: SecretOptions['env']
}

export const newJwtSecret = () => randomBytes(48).toString('base64url')

/** The worker parses both password lists as JSON, and a bare string becomes an empty list. */
const list = (password: string) => JSON.stringify([password])

/**
 * Every value is read before the first `wrangler secret put`, so a missing password stops the
 * push before it starts. A new JWT secret is stored before it is pushed: a failed push then
 * leaves it in the keyring for the next try, never only on the Worker.
 */
export async function pushSecrets(
  wrangler: Wrangler,
  mode: JwtMode,
  {
    read = secret,
    find = findSecret,
    store = storeSecret,
    generate = newJwtSecret,
    env = process.env,
  }: SecretsDeps = {},
): Promise<SecretsResult> {
  if (mode === 'rotate' && env[SECRET_ENV['jwt-secret']]) {
    throw new UsageError(`unset ${SECRET_ENV['jwt-secret']} to rotate the JWT secret`)
  }
  const values: [name: string, value: string][] = [
    ['PASSWORDS', list(read('site-password'))],
    ['ADMIN_PASSWORDS', list(read('admin-password'))],
  ]
  let jwt: SecretsResult['jwt'] = 'kept'
  const stored = mode === 'keep' ? find('jwt-secret') : undefined
  if (stored) {
    values.unshift(['JWT_SECRET', stored])
    jwt = 'pushed'
  } else if (mode === 'rotate') {
    const fresh = generate()
    store('jwt-secret', fresh)
    values.unshift(['JWT_SECRET', fresh])
    jwt = 'rotated'
  }
  for (const [name, value] of values) await wrangler.run(['secret', 'put', name], value)
  return { pushed: values.map(([name]) => name), jwt }
}

export const SECRETS_USAGE = 'usage: buzon secrets push [--tag vX.Y.Z] [--rotate-jwt]'

function tagFor(flags: Parsed['flags']): string {
  const raw = stringFlag(flags, 'tag')
  if (raw) return normalizeTag(raw)
  let tag: string | undefined
  try {
    tag = readConfig().tag
  } catch {
    tag = undefined
  }
  if (!tag) throw new UsageError('no deployed tag in the config: pass --tag vX.Y.Z')
  return tag
}

export async function secrets({ positionals, flags }: Pick<Parsed, 'positionals' | 'flags'>) {
  if (positionals[0] !== 'push' || positionals.length > 1) throw new UsageError(SECRETS_USAGE)
  const mode: JwtMode = flags['rotate-jwt'] === true ? 'rotate' : 'keep'
  const dir = await prepare(tagFor(flags))
  return pushSecrets(wranglerIn(dir), mode)
}

const JWT_TEXT: Record<SecretsResult['jwt'], string> = {
  pushed: 'JWT_SECRET pushed from the keyring',
  rotated: 'JWT_SECRET rotated: every address credential is now invalid, run `buzon reissue --all`',
  kept: 'JWT_SECRET left as it is on the Worker: none stored, `--rotate-jwt` makes one',
}

export function secretsText(result: SecretsResult): string {
  return `pushed ${result.pushed.join(', ')}\n${JWT_TEXT[result.jwt]}`
}
