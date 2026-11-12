export type SecretKey = 'site-password' | 'admin-password'

const ENV: Record<SecretKey, string> = {
  'site-password': 'BUZON_SITE_PASSWORD',
  'admin-password': 'BUZON_ADMIN_PASSWORD',
}

interface Keyring {
  name: string
  lookup: (key: SecretKey) => string[]
  store: (key: SecretKey) => string
}

const KEYRINGS: Partial<Record<NodeJS.Platform, Keyring>> = {
  linux: {
    name: 'secret-tool',
    lookup: (key) => ['secret-tool', 'lookup', 'service', 'buzon', 'key', key],
    store: (key) => `secret-tool store --label="buzon ${key}" service buzon key ${key}`,
  },
  darwin: {
    name: 'the macOS Keychain',
    lookup: (key) => ['security', 'find-generic-password', '-s', 'buzon', '-a', key, '-w'],
    store: (key) => `security add-generic-password -s buzon -a ${key} -w`,
  },
}

export type Run = (argv: string[]) => { success: boolean; stdout: string }

const run: Run = (argv) => {
  const result = Bun.spawnSync(argv, { stdout: 'pipe', stderr: 'pipe' })
  return { success: result.success, stdout: result.stdout?.toString() ?? '' }
}

/**
 * The environment variable, else the platform keyring: the Secret Service through `secret-tool`
 * on Linux, the Keychain through `security` on macOS. Other platforms use the variable only.
 */
export function secret(
  key: SecretKey,
  { env = process.env, platform = process.platform, spawn = run } = {},
): string {
  const fromEnv = env[ENV[key]]
  if (fromEnv) return fromEnv

  const keyring = KEYRINGS[platform]
  if (!keyring) throw new Error(`no ${key}: set ${ENV[key]}`)

  const store = keyring.store(key)
  let result: ReturnType<Run>
  try {
    result = spawn(keyring.lookup(key))
  } catch (error) {
    throw new Error(`no ${key}: set ${ENV[key]}, or store it in ${keyring.name}: \`${store}\``, {
      cause: error,
    })
  }
  const value = result.stdout.replace(/\n$/, '')
  if (!result.success || value === '') {
    throw new Error(`no ${key} in ${keyring.name}: run \`${store}\`, or set ${ENV[key]}`)
  }
  return value
}
