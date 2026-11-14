import { parseArgv, UsageError } from './core/args.ts'
import { causeChain } from './core/errors.ts'
import { HELP } from './core/help.ts'
import pkg from '../package.json' with { type: 'json' }

export const COMMANDS = [
  'init',
  'new',
  'list',
  'show',
  'note',
  'delete',
  'reissue',
  'adopt',
  'route',
  'read',
  'wait',
  'delete-mail',
  'deploy',
  'secrets',
  'upgrade',
  'export-db',
  'completion',
] as const

type Command = (typeof COMMANDS)[number]

const isCommand = (command: string): command is Command =>
  (COMMANDS as readonly string[]).includes(command)

const interactive = () => process.stdout.isTTY && process.stdin.isTTY

function print<T>(json: boolean, payload: T, text: (payload: T) => string): void {
  console.log(json ? JSON.stringify(payload, null, 2) : text(payload))
}

async function createContext() {
  const { readConfig } = await import('./core/config.ts')
  const { createApi } = await import('./core/api.ts')
  const { createRouting } = await import('./core/routing.ts')
  const { secret } = await import('./core/secrets.ts')
  const { workerName } = await import('./core/upstream.ts')
  const config = readConfig()
  const routing = createRouting(
    () => secret('cloudflare-token'),
    () => workerName(),
  )
  return { config, api: createApi(config), routing }
}

async function completeWords(words: string[]): Promise<void> {
  const { complete } = await import('./core/complete.ts')
  const { readRegistry } = await import('./core/registry.ts')
  const { readConfig } = await import('./core/config.ts')
  const entries = () => Object.entries(readRegistry().addresses)
  const candidates = complete(words, {
    addresses: () => entries().map(([address]) => address),
    sites: () => [...new Set(entries().flatMap(([, entry]) => entry.site ?? []))],
    domains: () => {
      const config = readConfig()
      return [config.domain, ...(config.routed ?? [])]
    },
  })
  if (candidates.length > 0) console.log(candidates.join('\n'))
}

export async function run(argv: string[]): Promise<number> {
  if (argv[0] === '__complete') {
    await completeWords(argv.slice(1))
    return 0
  }
  const parsed = parseArgv(argv)
  const { command, flags } = parsed
  const json = flags.json === true

  if (flags.version || flags.v) {
    console.log(pkg.version)
    return 0
  }
  if (flags.help || flags.h || command === 'help' || command === '') {
    console.log(HELP)
    return 0
  }

  if (!isCommand(command)) throw new UsageError(`unknown command "${command}"\n\n${HELP}`)
  switch (command) {
    case 'init': {
      if (flags.deploy === true) {
        const { install, installText } = await import('./commands/deploy.ts')
        print(json, await install(flags, !json && interactive()), installText)
        return 0
      }
      const { init, initText } = await import('./commands/init.ts')
      print(json, await init(flags, !json && interactive()), initText)
      return 0
    }
    case 'new':
    case 'list':
    case 'show':
    case 'note':
    case 'delete':
    case 'reissue':
    case 'adopt':
    case 'route': {
      const commands = await import('./commands/addresses.ts')
      const context = await createContext()
      switch (command) {
        case 'new':
          print(json, await commands.create(parsed, context), commands.createText)
          break
        case 'list':
          print(json, commands.list(parsed), commands.listText)
          break
        case 'show':
          print(json, await commands.show(parsed, context), commands.showText)
          break
        case 'note':
          print(json, commands.setNote(parsed, context), commands.setNoteText)
          break
        case 'delete':
          print(json, await commands.remove(parsed, context), commands.removeText)
          break
        case 'reissue': {
          const result = await commands.reissue(parsed, context)
          print(json, result, commands.reissueText)
          return result.missing.length > 0 ? 1 : 0
        }
        case 'adopt':
          print(json, await commands.adopt(parsed, context), commands.adoptText)
          break
        case 'route': {
          const result = await commands.route(parsed, context)
          print(json, result, commands.routeText)
          return result.conflicts.length > 0 ? 1 : 0
        }
      }
      return 0
    }
    case 'read':
    case 'wait':
    case 'delete-mail': {
      const commands = await import('./commands/mail.ts')
      const context = await createContext()
      if (command === 'read') print(json, await commands.read(parsed, context), commands.readText)
      if (command === 'wait') print(json, await commands.wait(parsed, context), commands.waitText)
      if (command === 'delete-mail') {
        print(json, await commands.removeMail(parsed, context), commands.removeMailText)
      }
      return 0
    }
    case 'secrets': {
      const { secrets, secretsText } = await import('./commands/secrets.ts')
      print(json, await secrets(parsed), secretsText)
      return 0
    }
    case 'deploy':
    case 'upgrade':
    case 'export-db': {
      const commands = await import('./commands/deploy.ts')
      const context = await createContext()
      if (command === 'deploy')
        print(json, await commands.deploy(parsed, context), commands.deployText)
      if (command === 'upgrade') {
        const result = await commands.upgrade(parsed, context, interactive())
        print(json, result, commands.upgradeText)
      }
      if (command === 'export-db') {
        print(json, await commands.exportDb(parsed, context), commands.exportDbText)
      }
      return 0
    }
    case 'completion': {
      const { SHELLS, SCRIPTS } = await import('./core/complete.ts')
      const shell = SHELLS.find((name) => name === parsed.positionals[0])
      if (!shell || parsed.positionals.length > 1) {
        throw new UsageError(`usage: buzon completion <${SHELLS.join('|')}>`)
      }
      console.log(SCRIPTS[shell])
      return 0
    }
    default:
      return command satisfies never
  }
}

export async function main(argv: string[]): Promise<void> {
  const json = argv.includes('--json')
  try {
    process.exitCode = await run(argv)
  } catch (error) {
    const usage = error instanceof UsageError
    const [message, ...causes] = usage ? [error.message] : causeChain(error)
    if (json) {
      console.error(JSON.stringify({ error: message, causes }))
    } else {
      console.error(message)
      for (const cause of causes) console.error(`  caused by: ${cause}`)
    }
    if (process.env.BUZON_DEBUG && error instanceof Error && error.stack) {
      console.error(error.stack)
    }
    process.exitCode = usage ? 2 : 1
  }
}
