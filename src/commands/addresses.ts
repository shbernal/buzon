import { stringFlag, UsageError } from '../core/args.ts'
import { ApiError } from '../core/api.ts'
import {
  findServerAddress,
  listServerAddresses,
  mintJwt,
  type ServerAddress,
} from '../core/admin.ts'
import { isRouted, normalizeDomain, type Config } from '../core/config.ts'
import { addressJwt, readCredentials, writeCredentials } from '../core/credentials.ts'
import { serverDate } from '../core/time.ts'
import {
  domainOf,
  generateName,
  parseCustomName,
  parseName,
  parseSite,
  parseTier,
} from '../core/names.ts'
import type { Routing, Rule } from '../core/routing.ts'
import { type Context, type Input, resolveAddress } from './context.ts'
import { readRegistry, writeRegistry, type Registry, type RegistryEntry } from '../core/registry.ts'

export type AddressView = RegistryEntry & { address: string }

/** Tries at a free name before giving up: three random characters rarely collide twice. */
const CREATE_ATTEMPTS = 5

const KEPT = new Set(['lte', 'custom'])

type Created = { jwt: string; address: string; address_id: number }

function view(address: string, entry: RegistryEntry): AddressView {
  return { address, ...entry }
}

function registered(address: string): { registry: Registry; entry: RegistryEntry } {
  const registry = readRegistry()
  const entry = registry.addresses[address]
  if (!entry) throw new Error(`${address} is not in the registry`)
  return { registry, entry }
}

const routed = (config: Config, address: string) => isRouted(config, domainOf(address))

function routingOf(context: Pick<Context, 'routing'>): Routing {
  if (!context.routing) throw new Error('this command needs Email Routing access')
  return context.routing
}

class RoutingConflict extends Error {}

/**
 * The rule that sends `address` to the Worker: an existing one, else a new one. A rule for the
 * address that does anything else is the user's, and is left alone.
 */
async function ensureRule(
  routing: Routing,
  address: string,
  rules?: Rule[],
): Promise<{ ruleId: string; created: boolean }> {
  const matching = (rules ?? (await routing.rules(domainOf(address)))).filter(
    (rule) => rule.to === address,
  )
  const worker = routing.worker()
  const ours = matching.find((rule) => rule.worker === worker)
  if (ours) return { ruleId: ours.id, created: false }
  if (matching.length > 0) {
    throw new RoutingConflict(
      `${address} has an Email Routing rule that does not send it to the Worker ${worker}`,
    )
  }
  return { ruleId: await routing.create(address), created: true }
}

/** A routed address with its rule, or a usable error that names `buzon route`. */
async function routeNew(
  context: Pick<Context, 'routing'>,
  address: string,
  entry: RegistryEntry,
  what: string,
): Promise<RegistryEntry> {
  let ruleId: string
  try {
    ruleId = (await ensureRule(routingOf(context), address)).ruleId
  } catch (error) {
    throw new Error(
      `${what} ${address}, but it has no routing rule and receives no mail: ` +
        `run \`buzon route ${address}\``,
      { cause: error },
    )
  }
  const updated = { ...entry, ruleId }
  const registry = readRegistry()
  writeRegistry({ addresses: { ...registry.addresses, [address]: updated } })
  return updated
}

const NEW_USAGE = 'usage: buzon new <ste|mte|lte> | buzon new custom <name>'

/** A tiered name is generated and retried on collision; a custom name is taken as given. */
async function createOnInstance(
  api: Context['api'],
  tier: RegistryEntry['tier'],
  site: string | undefined,
  custom: string | undefined,
  domain: string,
): Promise<Created> {
  if (tier === 'custom') {
    const address = `${custom}@${domain}`
    try {
      return await api.request<Created>('/admin/new_address', {
        body: { name: custom, domain, enablePrefix: false },
      })
    } catch (error) {
      if (error instanceof ApiError && /already exists/i.test(error.message)) {
        throw new Error(`${address} already exists: \`buzon adopt ${address}\` adds it`, {
          cause: error,
        })
      }
      throw error
    }
  }
  for (let attempt = 1; ; attempt++) {
    const name = generateName(tier, site)
    try {
      return await api.request<Created>('/api/new_address', { body: { name, domain } })
    } catch (error) {
      const taken = error instanceof ApiError && /already exists/i.test(error.message)
      if (!taken || attempt >= CREATE_ATTEMPTS) throw error
    }
  }
}

/**
 * The credential is saved before the registry entry, so a failure leaves at worst a server
 * address without a registry entry, and the error names it with the way to recover it.
 */
export async function create(
  { positionals, flags }: Input,
  context: Context,
): Promise<AddressView & { token?: string }> {
  const { config, api } = context
  const custom = positionals[0] === 'custom'
  if (positionals.length !== (custom ? 2 : 1)) throw new UsageError(NEW_USAGE)
  const tier = custom ? 'custom' : parseTier(positionals[0])
  const name = custom ? parseCustomName(positionals[1]!) : undefined
  const site = parseSite(tier, stringFlag(flags, 'site'))
  const note = stringFlag(flags, 'note')
  const domainFlag = stringFlag(flags, 'domain')
  const domain = domainFlag ? normalizeDomain(domainFlag) : config.domain
  if (isRouted(config, domain) && !KEPT.has(tier)) {
    throw new UsageError(
      `${domain} routes each address with its own rule, which is kept for lte and custom: ` +
        `make the ${tier} on a catch-all domain`,
    )
  }

  const registry = readRegistry()
  const credentials = readCredentials()
  const created = await createOnInstance(api, tier, site, name, domain)

  const { address, jwt } = created
  const recover = `run \`buzon adopt ${address}\` to recover it`
  try {
    writeCredentials({ ...credentials, [address]: jwt })
  } catch (error) {
    throw new Error(`created ${address}, but its credential was not saved: ${recover}`, {
      cause: error,
    })
  }
  const entry: RegistryEntry = {
    tier,
    ...(site && { site }),
    ...(note && { note }),
    createdAt: new Date().toISOString(),
    addressId: created.address_id,
  }
  try {
    writeRegistry({ addresses: { ...registry.addresses, [address]: entry } })
  } catch (error) {
    throw new Error(
      `created ${address} and saved its credential, but not its registry entry: ${recover}`,
      {
        cause: error,
      },
    )
  }
  const saved = routed(config, address) ? await routeNew(context, address, entry, 'created') : entry
  return { ...view(address, saved), ...(flags['show-token'] === true && { token: jwt }) }
}

/** Email Routing applies a new rule after a short delay, and bounces mail until then. */
const ROUTING_DELAY =
  'receives mail once Cloudflare applies its new routing rule, within a few minutes'

export function createText(result: AddressView & { token?: string }): string {
  const lines = [result.address]
  if (result.token) lines.push(result.token)
  if (result.ruleId) lines.push(ROUTING_DELAY)
  return lines.join('\n')
}

export function list({ flags }: Input): AddressView[] {
  const tierFlag = stringFlag(flags, 'tier')
  if (tierFlag && tierFlag !== 'custom') parseTier(tierFlag)
  const site = stringFlag(flags, 'site')?.toLowerCase()
  return Object.entries(readRegistry().addresses)
    .filter(([, entry]) => (!tierFlag || entry.tier === tierFlag) && (!site || entry.site === site))
    .map(([address, entry]) => view(address, entry))
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function listText(rows: AddressView[]): string {
  if (rows.length === 0) return 'no addresses'
  const width = Math.max(...rows.map((row) => row.address.length))
  return rows
    .map((row) => {
      const columns = [row.address.padEnd(width), row.tier.padEnd(6), row.createdAt.slice(0, 10)]
      if (row.note) columns.push(row.note)
      return columns.join('  ')
    })
    .join('\n')
}

const SHOW_USAGE = 'usage: buzon show <address>'

export async function show(
  { positionals }: Input,
  { config, api }: Context,
): Promise<AddressView & { mails: number }> {
  const address = resolveAddress(positionals[0], config, SHOW_USAGE)
  const { entry } = registered(address)
  const jwt = addressJwt(address)
  const { count } = await api.request<{ count: number }>('/api/mails?limit=1&offset=0', { jwt })
  return { ...view(address, entry), mails: count }
}

export function showText(result: AddressView & { mails: number }): string {
  const lines = [result.address, `tier     ${result.tier}`]
  if (result.site) lines.push(`site     ${result.site}`)
  if (result.note) lines.push(`note     ${result.note}`)
  lines.push(`created  ${result.createdAt}`, `mails    ${result.mails}`)
  return lines.join('\n')
}

const NOTE_USAGE = 'usage: buzon note <address> "<note>" (an empty note clears it)'

export function setNote({ positionals }: Input, { config }: Pick<Context, 'config'>): AddressView {
  const address = resolveAddress(positionals[0], config, NOTE_USAGE)
  const text = positionals[1]
  if (text === undefined || positionals.length > 2) throw new UsageError(NOTE_USAGE)
  const { registry, entry } = registered(address)
  const { note: _, ...rest } = entry
  const updated: RegistryEntry = text.trim() ? { ...rest, note: text.trim() } : rest
  writeRegistry({ addresses: { ...registry.addresses, [address]: updated } })
  return view(address, updated)
}

export const setNoteText = (result: AddressView) =>
  result.note ? `${result.address}: ${result.note}` : `${result.address}: note cleared`

const DELETE_USAGE = 'usage: buzon delete <address> [--force]'

export type DeleteResult = { address: string; alreadyGone: boolean }

/**
 * A deleted address answers 401 to its own JWT, and so does a JWT signed with a rotated
 * secret. The admin list tells the two apart before anything local is removed.
 */
export async function remove(
  { positionals, flags }: Input,
  context: Context,
): Promise<DeleteResult> {
  const { config, api } = context
  const address = resolveAddress(positionals[0], config, DELETE_USAGE)
  const { registry, entry } = registered(address)
  if (KEPT.has(entry.tier) && flags.force !== true) {
    throw new UsageError(`${address} is ${entry.tier}, which is kept: pass --force to delete it`)
  }

  const credentials = readCredentials()
  const jwt = credentials[address]
  let rejected: ApiError | undefined
  if (jwt) {
    try {
      const { success } = await api.request<{ success: boolean }>('/api/delete_address', {
        method: 'DELETE',
        jwt,
      })
      if (!success) throw new Error(`the instance did not delete ${address}`)
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error
      rejected = error
    }
  }
  const alreadyGone = !jwt || rejected !== undefined
  if (alreadyGone && (await findServerAddress(api, address))) {
    const why = jwt ? 'the instance rejects its credential' : 'no credential'
    throw new Error(`cannot delete ${address}, ${why}: run \`buzon reissue ${address}\``, {
      cause: rejected,
    })
  }
  if (entry.ruleId || routed(config, address)) await removeRule(context, address, entry)

  const { [address]: _entry, ...addresses } = registry.addresses
  writeRegistry({ addresses })
  const { [address]: _jwt, ...rest } = credentials
  writeCredentials(rest)
  return { address, alreadyGone }
}

/**
 * Runs after the instance lets the address go and before the local entries do, so a failure
 * here leaves the registry entry for a second `delete` to finish from.
 */
async function removeRule(context: Context, address: string, entry: RegistryEntry) {
  const domain = domainOf(address)
  try {
    const routing = routingOf(context)
    const ids = entry.ruleId
      ? [entry.ruleId]
      : (await routing.rules(domain))
          .filter((rule) => rule.to === address && rule.worker === routing.worker())
          .map((rule) => rule.id)
    for (const id of ids) await routing.remove(domain, id)
  } catch (error) {
    throw new Error(
      `${address} is off the instance, but its routing rule is still there: run the same ` +
        `\`buzon delete\` again`,
      { cause: error },
    )
  }
}

export const removeText = (result: DeleteResult) =>
  result.alreadyGone
    ? `${result.address} was already gone from the instance, removed it locally`
    : `deleted ${result.address}`

const REISSUE_USAGE = 'usage: buzon reissue <address> | --all'

export type ReissueResult = { reissued: string[]; missing: string[] }

/** Fresh JWTs from the admin API, for a lost credentials file or a rotated `JWT_SECRET`. */
export async function reissue(
  { positionals, flags }: Input,
  { config, api }: Context,
): Promise<ReissueResult> {
  const all = flags.all === true
  if (all === positionals.length > 0) throw new UsageError(REISSUE_USAGE)
  const registry = readRegistry()
  const targets = all
    ? Object.keys(registry.addresses)
    : [resolveAddress(positionals[0], config, REISSUE_USAGE)]
  for (const address of targets) {
    if (!registry.addresses[address]) {
      throw new Error(`${address} is not in the registry: \`buzon adopt ${address}\` adds it`)
    }
  }

  const server = new Map<string, ServerAddress>()
  if (all) {
    for (const row of await listServerAddresses(api)) server.set(row.name, row)
  } else {
    const row = await findServerAddress(api, targets[0]!)
    if (row) server.set(row.name, row)
  }

  const credentials = readCredentials()
  const result: ReissueResult = { reissued: [], missing: [] }
  for (const address of targets) {
    const row = server.get(address)
    if (!row) {
      result.missing.push(address)
      continue
    }
    credentials[address] = await mintJwt(api, row.id)
    registry.addresses[address] = { ...registry.addresses[address]!, addressId: row.id }
    result.reissued.push(address)
  }
  writeCredentials(credentials)
  writeRegistry(registry)
  return result
}

export function reissueText(result: ReissueResult): string {
  const lines = result.reissued.map((address) => `reissued ${address}`)
  for (const address of result.missing) {
    lines.push(`${address} is not on the instance: \`buzon delete ${address} --force\` drops it`)
  }
  return lines.join('\n') || 'nothing to reissue'
}

const ADOPT_USAGE = 'usage: buzon adopt <address> [--note "…"]'

/** An address made elsewhere, such as the admin UI. A name outside the scheme is `custom`. */
export async function adopt({ positionals, flags }: Input, context: Context): Promise<AddressView> {
  const { config, api } = context
  const address = resolveAddress(positionals[0], config, ADOPT_USAGE)
  const note = stringFlag(flags, 'note')
  const registry = readRegistry()
  if (registry.addresses[address]) throw new Error(`${address} is already in the registry`)
  const row = await findServerAddress(api, address)
  if (!row) throw new Error(`${address} is not on the instance`)
  const jwt = await mintJwt(api, row.id)

  const scheme = parseName(address.split('@')[0]!)
  const entry: RegistryEntry = {
    ...(scheme ?? { tier: 'custom' }),
    ...(note && { note }),
    createdAt: serverDate(row.created_at) ?? new Date().toISOString(),
    addressId: row.id,
  }
  writeCredentials({ ...readCredentials(), [address]: jwt })
  writeRegistry({ addresses: { ...registry.addresses, [address]: entry } })
  const saved = routed(config, address) ? await routeNew(context, address, entry, 'adopted') : entry
  return view(address, saved)
}

export const adoptText = (result: AddressView) => `adopted ${result.address} as ${result.tier}`

const ROUTE_USAGE = 'usage: buzon route <address> | --all'

export type RouteResult = {
  routed: { address: string; ruleId: string; created: boolean }[]
  conflicts: { address: string; error: string }[]
}

/**
 * Gives registry addresses on routed domains the rule that sends them to the Worker, and
 * records it. An existing rule to the Worker is recorded as it is.
 */
export async function route({ positionals, flags }: Input, context: Context): Promise<RouteResult> {
  const { config } = context
  const all = flags.all === true
  if (all === positionals.length > 0) throw new UsageError(ROUTE_USAGE)
  const registry = readRegistry()
  let targets: string[]
  if (all) {
    targets = Object.keys(registry.addresses).filter((address) => routed(config, address))
  } else {
    const address = resolveAddress(positionals[0], config, ROUTE_USAGE)
    if (!registry.addresses[address]) {
      throw new Error(`${address} is not in the registry: \`buzon adopt ${address}\` adds it`)
    }
    if (!routed(config, address)) {
      throw new UsageError(`${domainOf(address)} is not in \`routed\` in the config`)
    }
    targets = [address]
  }

  const routing = routingOf(context)
  const rules = new Map<string, Rule[]>()
  const result: RouteResult = { routed: [], conflicts: [] }
  for (const address of targets) {
    const domain = domainOf(address)
    if (!rules.has(domain)) rules.set(domain, await routing.rules(domain))
    try {
      const { ruleId, created } = await ensureRule(routing, address, rules.get(domain))
      registry.addresses[address] = { ...registry.addresses[address]!, ruleId }
      result.routed.push({ address, ruleId, created })
    } catch (error) {
      if (!(error instanceof RoutingConflict)) {
        writeRegistry(registry)
        throw error
      }
      result.conflicts.push({ address, error: error.message })
    }
  }
  writeRegistry(registry)
  return result
}

export function routeText(result: RouteResult): string {
  const lines = result.routed.map(({ address, created }) =>
    created ? `routed ${address}, ${ROUTING_DELAY}` : `${address} was already routed`,
  )
  for (const { error } of result.conflicts) {
    lines.push(`${error}: change or delete that rule, then run \`buzon route\` again`)
  }
  return lines.join('\n') || 'no addresses on a routed domain'
}
