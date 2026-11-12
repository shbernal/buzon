# Deploying an instance

buzon runs against [cloudflare_temp_email](https://github.com/dreamhunter2333/cloudflare_temp_email),
an open-source mail server that lives entirely on Cloudflare: a Worker receives mail through
Email Routing, D1 stores it, and the same Worker serves the web UI and the API. This guide goes
from nothing to a running instance at `mail.example.com` that receives mail for `example.com`.

## Before you start

- A domain on Cloudflare, here `example.com`.
- Email Routing enabled on that zone, with at least one verified destination address.
  Cloudflare asks for one before it turns routing on, even though the Worker receives the mail.
- A workers.dev subdomain on the account. The daily cleanup is a Cron Trigger, and Cloudflare
  refuses cron triggers without one (error 10063). The instance itself stays off workers.dev:
  with `routes` set, Wrangler does not publish the workers.dev URL.
- `git` and `pnpm` on `PATH`, and Wrangler logged in: run
  `pnpm dlx wrangler login` once. Every later Wrangler call runs from the upstream checkout.
- `CLOUDFLARE_ACCOUNT_ID` in the environment if the login sees more than one account.

## 1. Write the config files

buzon reads two files from `~/.config/buzon/` ([files.md](files.md)). `buzon init` writes the
first one, but it checks a live instance, so for a first deploy write it by hand:

```toml
url = "https://mail.example.com"
domain = "example.com"
```

The second is the `wrangler.toml` that buzon copies into the upstream worker on every deploy.
This one keeps the web UI and the API on one Worker, at a custom domain:

```toml
name = "buzon"
main = "src/worker.ts"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]
keep_vars = true
routes = [{ pattern = "mail.example.com", custom_domain = true }]

[assets]
directory = "../frontend/dist/"
binding = "ASSETS"
run_worker_first = true

[triggers]
crons = ["0 3 * * *"]

# JWT_SECRET, PASSWORDS and ADMIN_PASSWORDS are Wrangler secrets, not vars.
[vars]
PREFIX = ""
DOMAINS = ["example.com"]
DEFAULT_DOMAINS = ["example.com"]
ADDRESS_REGEX = "[^a-z0-9.-]"
ADDRESS_CHECK_REGEX = "^(ste|mte|lte)-[0-9]{4}(-[a-z0-9]{1,12})?-[a-z0-9]{3}$"
ENABLE_USER_CREATE_EMAIL = true
ENABLE_USER_DELETE_EMAIL = true
ENABLE_AI_EMAIL_EXTRACT = true
DEFAULT_LANG = "en"

[[d1_databases]]
binding = "DB"
database_name = "buzon-db"
database_id = "<filled in below>"
```

What the vars do for agent use:

| Var                        | Why                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `PREFIX = ""`              | Addresses are exactly the names buzon generates                                            |
| `ADDRESS_REGEX`            | Strips anything outside `[a-z0-9.-]` from a requested name                                 |
| `ADDRESS_CHECK_REGEX`      | Accepts only names in the [tier scheme](tiers.md), so the cleanup SQL can trust the prefix |
| `ENABLE_USER_CREATE_EMAIL` | Lets `buzon new` create addresses through the site API                                     |
| `ENABLE_USER_DELETE_EMAIL` | Lets `buzon delete` remove an address with its own credential                              |
| `ENABLE_AI_EMAIL_EXTRACT`  | Saves a verification code with each mail; `wait --code` prefers it over its own parsing    |

Extraction runs in local mode by default: rule-based, no AI binding, and no mail content sent
to a model. It reads the plain-text part, so HTML-only mail gets no saved code, and buzon
falls back to parsing the HTML itself.

## 2. Get the upstream checkout

```sh
buzon deploy --tag v1.13.0 --dry-run
```

This clones the release into `~/.cache/buzon/upstream/v1.13.0`, installs its dependencies,
builds the frontend and checks the Worker bundle without deploying it. The remaining Wrangler
commands run from its `worker/` directory.

## 3. Create the database

```sh
pnpm wrangler d1 create buzon-db
```

Put the printed id in `database_id` of `~/.config/buzon/wrangler.toml`, then load the schema:

```sh
pnpm wrangler d1 execute buzon-db --remote --file=../db/schema.sql
```

## 4. Set the secrets

Pick a site password (every API call needs it) and an admin password, and store both in the
keyring, where buzon reads them. On Linux, through the Secret Service:

```sh
secret-tool store --label="buzon site-password" service buzon key site-password
```

```sh
secret-tool store --label="buzon admin-password" service buzon key admin-password
```

On macOS, in the Keychain:

```sh
security add-generic-password -s buzon -a site-password -w
```

```sh
security add-generic-password -s buzon -a admin-password -w
```

`BUZON_SITE_PASSWORD` and `BUZON_ADMIN_PASSWORD` override the keyring, and are the only source
on other platforms, in containers and in CI.

Then put them on the Worker, with a random `JWT_SECRET` for the address credentials.
`PASSWORDS` and `ADMIN_PASSWORDS` are JSON arrays of strings. A bare string fails to parse and
the instance silently treats it as an empty list, so type `["your-site-password"]`, brackets
and quotes included:

```sh
pnpm wrangler secret put JWT_SECRET
```

```sh
pnpm wrangler secret put PASSWORDS
```

```sh
pnpm wrangler secret put ADMIN_PASSWORDS
```

On a Worker that does not exist yet, Wrangler offers to create it with the secret. `buzon
deploy` never sends secrets, so they stay as set here across deploys and upgrades.

## 5. Deploy

```sh
buzon deploy --tag v1.13.0
```

buzon deploys, waits until the instance reports `v1.13.0` and accepts the site password, then
records the tag in `config.toml`. Later deploys of the same release need no `--tag`. Run
`buzon init` any time to check the instance and the domain again.

`/health_check` does not answer `OK` on this setup: with the web UI on the same Worker, the
Worker hands every non-API path to the frontend. To probe by hand, ask the admin API:

```sh
curl -H "x-custom-auth: $SITE_PASSWORD" -H "x-admin-auth: $ADMIN_PASSWORD" \
  "https://mail.example.com/admin/address?limit=1&offset=0"
```

A fresh instance answers `{"results":[],"count":0}`.

## 6. Route all mail to the Worker

A catch-all rule sends every address on the zone to the Worker. In the dashboard: Email,
Email Routing, Routing rules, Catch-all address, action "Send to a Worker", Worker `buzon`.
Or through the API, where the Wrangler OAuth token is enough:

```sh
curl -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/email/routing/rules/catch_all" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data '{"matchers":[{"type":"all"}],"actions":[{"type":"worker","value":["buzon"]}],"enabled":true}'
```

## 7. Admin settings

Two settings live in the database, not in `wrangler.toml`. Set them in the admin page at
`https://mail.example.com/admin`:

- Global Mailbox Settings: turn on "Block receive unknow address email". The Worker then rejects
  mail for an address that does not exist, so the sender gets a bounce and D1 stores nothing.
  Without it, mail to a deleted address keeps landing in the database.
- Maintenance, Custom SQL Cleanup: add the statements from [tiers.md](tiers.md), in order.

Next: [tiers.md](tiers.md) for what the cleanup does, [upgrading.md](upgrading.md) for moving to
a newer release.
