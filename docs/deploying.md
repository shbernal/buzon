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

## 1. Write the Worker config

buzon copies `~/.config/buzon/wrangler.toml` ([files.md](files.md)) into the upstream worker on
every deploy. This one keeps the web UI and the API on one Worker, at a custom domain, and
leaves `database_id` for buzon to fill in:

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
database_id = "<filled in by buzon init --deploy>"
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

## 2. Store the passwords

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

## 3. Install

```sh
buzon init --deploy --tag v1.13.0 --url https://mail.example.com --domain example.com
```

This runs the whole first install:

1. Writes `~/.config/buzon/config.toml` with the URL and the domain.
2. Clones the release into `~/.cache/buzon/upstream/v1.13.0` and installs its dependencies.
   Every Wrangler call runs from its `worker/` directory.
3. Creates the D1 database named in `database_name`, writes its id to `database_id` of
   `~/.config/buzon/wrangler.toml`, and loads upstream's `db/schema.sql` into it.
4. Puts the secrets on the Worker, as `buzon secrets push` does (section 4).
5. Builds and deploys the release, waits until the instance reports `v1.13.0` and accepts the
   site password, then records the tag in `config.toml`.

Before it creates anything, it checks that both passwords are readable and stores a new random
`JWT_SECRET` in the keyring, unless one is there already. It stops without creating anything
when `wrangler.toml` already has a database id, or when the account already has a D1 database
of that name: it never makes a second one. To finish an install that stopped after the
database was made, run the remaining steps by hand. If the schema did not load, load it from
the checkout's `worker/` directory first:

```sh
pnpm wrangler d1 execute buzon-db --remote --file=../db/schema.sql
```

Then push the secrets and deploy:

```sh
buzon secrets push --tag v1.13.0
```

```sh
buzon deploy --tag v1.13.0
```

Later deploys of the same release need no `--tag`. Run `buzon init` without `--deploy` any time
to check the instance and the domain again.

`/health_check` does not answer `OK` on this setup: with the web UI on the same Worker, the
Worker hands every non-API path to the frontend. To probe by hand, ask the admin API:

```sh
curl -H "x-custom-auth: $SITE_PASSWORD" -H "x-admin-auth: $ADMIN_PASSWORD" \
  "https://mail.example.com/admin/address?limit=1&offset=0"
```

A fresh instance answers `{"results":[],"count":0}`.

## 4. Secrets

The Worker reads three secrets: `JWT_SECRET`, which signs every address credential, and
`PASSWORDS` and `ADMIN_PASSWORDS`, the site and admin passwords. Put them there, after a
password change for example, with:

```sh
buzon secrets push
```

It runs `wrangler secret put` for each, from the checkout of the deployed release (`--tag`
picks another), with the value on stdin. The passwords come from the same place as for every
other command, and go up as one-element JSON lists: the Worker treats a bare string as an
empty list, and then accepts no password at all.

`JWT_SECRET` comes from `BUZON_JWT_SECRET`, or else the keyring entry `jwt-secret`, where
`init --deploy` stores it. With neither, `secrets push` leaves the Worker's `JWT_SECRET` as it
is. To replace it:

```sh
buzon secrets push --rotate-jwt
```

This makes a new random secret, stores it in the keyring, and pushes it. Every address
credential signed with the old one stops working, so fetch new ones from the admin API:

```sh
buzon reissue --all
```

On a platform without a keyring, set `BUZON_JWT_SECRET` to the secret to push instead.
`buzon deploy` and `buzon upgrade` never send secrets, so they stay as pushed here.

## 5. Route all mail to the Worker

A catch-all rule sends every address on the zone to the Worker. In the dashboard: Email,
Email Routing, Routing rules, Catch-all address, action "Send to a Worker", Worker `buzon`.
Or through the API, where the Wrangler OAuth token is enough:

```sh
curl -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/email/routing/rules/catch_all" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data '{"matchers":[{"type":"all"}],"actions":[{"type":"worker","value":["buzon"]}],"enabled":true}'
```

## 6. Admin settings

Two settings live in the database, not in `wrangler.toml`. Set them in the admin page at
`https://mail.example.com/admin`:

- Global Mailbox Settings: turn on "Block receive unknow address email". The Worker then rejects
  mail for an address that does not exist, so the sender gets a bounce and D1 stores nothing.
  Without it, mail to a deleted address keeps landing in the database.
- Maintenance, Custom SQL Cleanup: add the statements from [tiers.md](tiers.md), in order.

Next: [tiers.md](tiers.md) for what the cleanup does, [upgrading.md](upgrading.md) for moving to
a newer release.
