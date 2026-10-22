export type SecretKey = 'site-password' | 'admin-password'

const ENV: Record<SecretKey, string> = {
  'site-password': 'BUZON_SITE_PASSWORD',
  'admin-password': 'BUZON_ADMIN_PASSWORD',
}

/** The Secret Service through `secret-tool`. An environment variable overrides it. */
export function secret(key: SecretKey): string {
  const fromEnv = process.env[ENV[key]]
  if (fromEnv) return fromEnv

  const store = `secret-tool store --label="buzon ${key}" service buzon key ${key}`
  let result: ReturnType<typeof Bun.spawnSync>
  try {
    result = Bun.spawnSync(['secret-tool', 'lookup', 'service', 'buzon', 'key', key], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
  } catch (error) {
    throw new Error(`no ${key}: set ${ENV[key]}, or install secret-tool and run \`${store}\``, {
      cause: error,
    })
  }
  const value = result.stdout?.toString().replace(/\n$/, '') ?? ''
  if (!result.success || value === '') {
    throw new Error(`no ${key} in the keyring: run \`${store}\`, or set ${ENV[key]}`)
  }
  return value
}
