import { paths } from './paths.ts'
import { readJson, writeJson } from './files.ts'
import type { Tier } from './names.ts'

/** `custom` is an address named outside the scheme and adopted later. It is kept like `lte`. */
export type RegistryTier = Tier | 'custom'

/** What an address is for. Kept in the user's dotfiles, so it never holds a secret. */
export type RegistryEntry = {
  tier: RegistryTier
  site?: string
  note?: string
  createdAt: string
  addressId: number
}

/** Keyed by full address. */
export type Registry = {
  addresses: Record<string, RegistryEntry>
}

export function readRegistry(file = paths.registry): Registry {
  return (readJson(file) as Registry | undefined) ?? { addresses: {} }
}

export function writeRegistry(registry: Registry, file = paths.registry): void {
  writeJson(file, registry)
}
