export type SecretKey = 'site-password' | 'admin-password' | 'jwt-secret' | 'cloudflare-token'

export const SECRET_ENV: Record<SecretKey, string> = {
  'site-password': 'BUZON_SITE_PASSWORD',
  'admin-password': 'BUZON_ADMIN_PASSWORD',
  'jwt-secret': 'BUZON_JWT_SECRET',
  'cloudflare-token': 'BUZON_CLOUDFLARE_TOKEN',
}

interface Keyring {
  name: string
  lookup: (key: SecretKey) => string[]
  store: (key: SecretKey) => string
  /** The command that saves a value, and what it reads on stdin: the value never goes in argv. */
  save: (key: SecretKey, value: string) => { argv: string[]; stdin: string }
}

const KEYRINGS: Partial<Record<NodeJS.Platform, Keyring>> = {
  linux: {
    name: 'secret-tool',
    lookup: (key) => ['secret-tool', 'lookup', 'service', 'buzon', 'key', key],
    store: (key) => `secret-tool store --label="buzon ${key}" service buzon key ${key}`,
    save: (key, value) => ({
      argv: ['secret-tool', 'store', `--label=buzon ${key}`, 'service', 'buzon', 'key', key],
      stdin: value,
    }),
  },
  darwin: {
    name: 'the macOS Keychain',
    lookup: (key) => ['security', 'find-generic-password', '-s', 'buzon', '-a', key, '-w'],
    store: (key) => `security add-generic-password -s buzon -a ${key} -w`,
    // `security -i` reads its commands on stdin, which keeps the value out of the process list.
    save: (key, value) => ({
      argv: ['security', '-i'],
      stdin: `add-generic-password -U -s buzon -a ${key} -w ${JSON.stringify(value)}\n`,
    }),
  },
}

export type Run = (argv: string[], stdin?: string) => { success: boolean; stdout: string }

const run: Run = (argv, stdin) => {
  const result = Bun.spawnSync(argv, {
    stdin: stdin === undefined ? 'ignore' : Buffer.from(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { success: result.success, stdout: result.stdout?.toString() ?? '' }
}

export type SecretOptions = { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; spawn?: Run }

/**
 * The environment variable, else the platform keyring: the Secret Service through `secret-tool`
 * on Linux, the Keychain through `security` on macOS. Other platforms use the variable only.
 */
export function secret(
  key: SecretKey,
  { env = process.env, platform = process.platform, spawn = run }: SecretOptions = {},
): string {
  const variable = SECRET_ENV[key]
  const fromEnv = env[variable]
  if (fromEnv) return fromEnv

  const keyring = KEYRINGS[platform]
  if (!keyring) throw new Error(`no ${key}: set ${variable}`)

  const store = keyring.store(key)
  let result: ReturnType<Run>
  try {
    result = spawn(keyring.lookup(key))
  } catch (error) {
    throw new Error(`no ${key}: set ${variable}, or store it in ${keyring.name}: \`${store}\``, {
      cause: error,
    })
  }
  const value = result.stdout.replace(/\n$/, '')
  if (!result.success || value === '') {
    throw new Error(`no ${key} in ${keyring.name}: run \`${store}\`, or set ${variable}`)
  }
  return value
}

/** Like `secret`, but `undefined` when neither the variable nor the keyring has it. */
export function findSecret(key: SecretKey, options: SecretOptions = {}): string | undefined {
  try {
    return secret(key, options)
  } catch {
    return undefined
  }
}

/** Saves `value` in the platform keyring, replacing any earlier one. */
export function storeSecret(
  key: SecretKey,
  value: string,
  { platform = process.platform, spawn = run }: Omit<SecretOptions, 'env'> = {},
): void {
  const keyring = KEYRINGS[platform]
  if (!keyring) {
    throw new Error(`no keyring on ${platform} to keep the ${key} in: set ${SECRET_ENV[key]}`)
  }
  const { argv, stdin } = keyring.save(key, value)
  let success = false
  try {
    success = spawn(argv, stdin).success
  } catch (error) {
    throw new Error(`could not store the ${key} in ${keyring.name}`, { cause: error })
  }
  if (!success) throw new Error(`could not store the ${key} in ${keyring.name}`)
}
