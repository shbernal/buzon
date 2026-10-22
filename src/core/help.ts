export const HELP = `buzon: tiered addresses on a self-hosted cloudflare_temp_email instance

usage: buzon <command> [options]

commands:
  init      write the instance URL and mail domain, then check both
            --url <https://mail.example.com>  --domain <example.com>
  new       create an address: new <ste|mte|lte> [--site <site>] [--note "…"]
            [--domain <example.com>] [--show-token]
  list      registry addresses: [--tier <ste|mte|lte|custom>] [--site <site>]
  show      registry entry and inbox count: show <address>
  note      set or clear the registry note: note <address> "<note>"
  delete    delete on the instance and locally: delete <address> [--force]
            (lte and custom addresses need --force)
  reissue   fresh credentials from the admin API: reissue <address> | --all
  adopt     add an address made elsewhere: adopt <address> [--note "…"]

tiers: ste is one-shot, mte lives for a process, lte is tied to a real account.
An <address> without @ gets the configured domain.

options:
  --json     machine-readable output
  --help     show this help
  --version  show the version`
