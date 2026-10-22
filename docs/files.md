# Files

buzon follows the XDG base directories. Each `XDG_*_HOME` variable moves its directory; unset
or relative, it falls back to the default below.

| File                                    | Holds                                                     | Secret |
| --------------------------------------- | --------------------------------------------------------- | ------ |
| `~/.config/buzon/config.toml`           | Instance URL, mail domain, deployed release tag           | no     |
| `~/.config/buzon/wrangler.toml`         | The Worker config copied into every deploy                | no     |
| `~/.local/share/buzon/registry.json`    | Every address with its tier, site, note and creation date | no     |
| `~/.local/share/buzon/backups/`         | `export-db` dumps, the last 12 kept                       | yes    |
| `~/.local/state/buzon/credentials.json` | One JWT per address, mode `0600`                          | yes    |
| `~/.cache/buzon/upstream/<tag>/`        | Shallow clones of upstream releases                       | no     |

The site and admin passwords are in neither: they live in the Secret Service keyring under
`service buzon key site-password` and `service buzon key admin-password`, or in
`BUZON_SITE_PASSWORD` and `BUZON_ADMIN_PASSWORD`.

## What to version

`config.toml`, `wrangler.toml` and `registry.json` hold no secret and are worth keeping in
private dotfiles: together they rebuild a machine's setup. They do name the user's domain, the
D1 database id and every account address, so keep that repo private.

Keep `credentials.json` and the backups out of any repo. A database dump holds every mail.
Lost credentials come back from the admin API:

```sh
buzon reissue --all
```

## The registry and the instance

The registry is buzon's own record, and the instance never sees it. `buzon new` creates the
address on the instance, saves its credential, then writes the registry entry. An address made
elsewhere, in the web UI or on another machine, joins with `buzon adopt <address>`; one that
follows the naming scheme gets its tier and site from its name, any other becomes `custom`.

A cleanup on the instance does not touch the registry, so an expired `ste` or `mte` stays
listed until `buzon delete` removes it.

The cache is safe to delete. A checkout with local edits stops `deploy`, so a patched release
never ships by accident.
