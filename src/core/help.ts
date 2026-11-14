export const HELP = `buzon: tiered addresses on a self-hosted cloudflare_temp_email instance

usage: buzon <command> [options]

commands:
  init      write the instance URL and mail domain, then check both
            --url <https://mail.example.com>  --domain <example.com>
            --deploy --tag vX.Y.Z: first install instead, from ~/.config/buzon/wrangler.toml:
            write the config, create the D1 database, load its schema, push the secrets, deploy
  new       create an address: new <ste|mte|lte> | new custom <name>
            [--site <site>] [--note "…"] [--domain <example.com>] [--show-token]
  list      registry addresses: [--tier <ste|mte|lte|custom>] [--site <site>]
  show      registry entry and inbox count: show <address>
  note      set or clear the registry note: note <address> "<note>"
  delete    delete on the instance and locally: delete <address> [--force]
            (lte and custom addresses need --force)
  reissue   fresh credentials from the admin API: reissue <address> | --all
  adopt     add an address made elsewhere: adopt <address> [--note "…"]
  route     give addresses on a routed domain their Email Routing rule to the Worker:
            route <address> | --all  (new, adopt and delete do it on their own)
  read      print mail: read <address> [--latest | --id <n> | --all] [--raw]
  wait      wait for new mail, print its code, link or whole text:
            wait <address> [--code | --link] [--from <regex>] [--subject <regex>]
            [--timeout 300] [--since now|<duration>|<date>]
            (exits 1 on timeout; --since 10m also takes mail that came before)
  delete-mail  delete one mail: delete-mail <address> <id>
  deploy    build and deploy the pinned upstream release with the local wrangler.toml:
            [--tag vX.Y.Z] [--dry-run]  (secrets stay as they are on the Worker)
  secrets   put JWT_SECRET, PASSWORDS and ADMIN_PASSWORDS on the Worker from the keyring:
            secrets push [--tag vX.Y.Z] [--rotate-jwt]
            (without a stored jwt-secret, JWT_SECRET stays as it is; --rotate-jwt makes and
            stores a new one, which invalidates every address credential)
  upgrade   move to a newer release, asking before the backup, each db patch and the
            deploy: upgrade --to vX.Y.Z
  export-db dump the D1 database: [--out <dir>]  (keeps the last 12)
  completion  print a shell completion script: completion <bash|zsh|fish>

tiers: ste is one-shot, mte lives for a process, lte is tied to a real account.
An <address> without @ gets the configured domain. A domain listed in \`routed\` in the
config has no catch-all, so each address there gets its own rule and only lte and custom fit.

options:
  --json     machine-readable output
  --help     show this help
  --version  show the version`
