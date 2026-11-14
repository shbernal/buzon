import { VALUE_FLAGS } from './args.ts'

export const SHELLS = ['bash', 'zsh', 'fish'] as const
export type Shell = (typeof SHELLS)[number]

/** Every flag each command takes. A test holds this to the help text and to `VALUE_FLAGS`. */
export const COMMAND_FLAGS: Record<string, string[]> = {
  init: ['url', 'domain', 'deploy', 'tag'],
  new: ['site', 'note', 'domain', 'show-token'],
  list: ['tier', 'site'],
  show: [],
  note: [],
  delete: ['force'],
  reissue: ['all'],
  adopt: ['note'],
  route: ['all'],
  read: ['latest', 'id', 'all', 'raw'],
  wait: ['code', 'link', 'from', 'subject', 'timeout', 'since'],
  'delete-mail': [],
  deploy: ['tag', 'dry-run'],
  secrets: ['tag', 'rotate-jwt'],
  upgrade: ['to'],
  'export-db': ['out'],
  completion: [],
}

const GLOBAL_FLAGS = ['json', 'help']

/** Commands whose first positional is an address from the registry. */
const ADDRESS_COMMANDS = new Set([
  'show',
  'note',
  'delete',
  'reissue',
  'route',
  'read',
  'wait',
  'delete-mail',
])

/** What completion reads from the local files, loaded only when asked for. */
export type Sources = {
  addresses: () => string[]
  sites: () => string[]
  domains: () => string[]
}

function flagValues(flag: string, sources: Sources): string[] {
  switch (flag) {
    case 'tier':
      return ['ste', 'mte', 'lte', 'custom']
    case 'site':
      return sources.sites()
    case 'domain':
      return sources.domains()
    case 'since':
      return ['now']
    default:
      return []
  }
}

const flagName = (word: string) => word.replace(/^--?/, '')

/**
 * Candidates for the last of `words`, the arguments after `buzon` up to the cursor. The shell
 * filters them by what is typed. Bash splits `--tier=ste` into `--tier`, `=` and `ste`.
 */
export function complete(words: string[], sources: Sources): string[] {
  const current = words.at(-1) ?? ''
  const before = words.slice(0, -1)
  if (before.at(-1) === '=' && before.length >= 2) before.pop()

  const positionals: string[] = []
  for (let i = 0; i < before.length; i++) {
    const word = before[i]!
    if (!word.startsWith('-')) positionals.push(word)
    else if (!word.includes('=') && VALUE_FLAGS.has(flagName(word))) i++
  }

  const previous = before.at(-1)
  if (previous?.startsWith('-') && !previous.includes('=') && VALUE_FLAGS.has(flagName(previous))) {
    return flagValues(flagName(previous), sources)
  }

  const [command, ...args] = positionals
  if (command === undefined) {
    if (current.startsWith('-')) return ['--help', '--version']
    return [...Object.keys(COMMAND_FLAGS), 'help']
  }
  const flags = COMMAND_FLAGS[command]
  if (!flags) return []

  if (current.startsWith('--') && current.includes('=')) {
    const name = current.slice(2, current.indexOf('='))
    return flags.includes(name) ? flagValues(name, sources).map((v) => `--${name}=${v}`) : []
  }
  if (current.startsWith('-')) return [...flags, ...GLOBAL_FLAGS].map((flag) => `--${flag}`)

  if (args.length > 0) return []
  if (command === 'new') return ['ste', 'mte', 'lte', 'custom']
  if (command === 'secrets') return ['push']
  if (command === 'completion') return [...SHELLS]
  if (ADDRESS_COMMANDS.has(command)) return sources.addresses()
  return []
}

/** The scripts call `buzon __complete` with the words typed so far. */
export const SCRIPTS: Record<Shell, string> = {
  bash: `_buzon() {
  local IFS=$'\\n'
  COMPREPLY=($(compgen -W "$(buzon __complete "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null)" -- "\${COMP_WORDS[COMP_CWORD]}"))
}
complete -F _buzon buzon`,
  zsh: `#compdef buzon
_buzon() {
  local -a candidates
  candidates=(\${(f)"$(buzon __complete "\${(@)words[2,CURRENT]}" 2>/dev/null)"})
  compadd -a candidates
}
if [[ "\${funcstack[1]}" == _buzon ]]; then _buzon "$@"; else compdef _buzon buzon; fi`,
  fish: `complete -c buzon -f -a '(buzon __complete (commandline -opc)[2..-1] (commandline -ct) 2>/dev/null)'`,
}
