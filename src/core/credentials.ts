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
