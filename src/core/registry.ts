import { paths } from './paths.ts'
import { readJson, writeJson } from './files.ts'

/** What an address is for. Kept in the user's dotfiles, so it never holds a secret. */
export type RegistryEntry = {
  createdAt: string
  purpose?: string
}

export type Registry = {
  addresses: Record<string, RegistryEntry>
}

export function readRegistry(file = paths.registry): Registry {
  return (readJson(file) as Registry | undefined) ?? { addresses: {} }
}

export function writeRegistry(registry: Registry, file = paths.registry): void {
  writeJson(file, registry)
}
