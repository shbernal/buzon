import { paths } from './paths.ts'
import { readJson, writeJson } from './files.ts'

/** Address JWTs by address. Owner-only, and outside the tracked data directory. */
export type Credentials = Record<string, string>

export function readCredentials(file = paths.credentials): Credentials {
  return (readJson(file) as Credentials | undefined) ?? {}
}

export function writeCredentials(credentials: Credentials, file = paths.credentials): void {
  writeJson(file, credentials, 0o600)
}

export function addressJwt(address: string, file = paths.credentials): string {
  const jwt = readCredentials(file)[address]
  if (!jwt) throw new Error(`no credential for ${address}: run \`buzon reissue ${address}\``)
  return jwt
}
