# Upgrading

```sh
buzon upgrade --to v1.14.0
```

`upgrade` needs a terminal, because it asks before every step that touches the live instance:

1. It clones both releases and shows what changed for a self-hosted deploy: the diff of
   upstream's `wrangler.toml.template`, and each new file under `db/` with the changelog lines
   that name it. A patch the changelog never mentions is flagged.
2. Export the database first? A yes writes a dump to `~/.local/share/buzon/backups/`.
3. For each new `db/` patch: run it against the live database, skip it, or stop.
4. Deploy the new release, wait until the instance reports it, and record the tag.

Answering no, or stopping at a patch, leaves the instance on the old release with the patches
applied so far. Running `upgrade` again offers the same patches, so skip the ones already
applied.

Read the template diff before deploying. Upstream adds vars there, and a new one that matters
for agent use belongs in `~/.config/buzon/wrangler.toml`, which buzon copies over upstream's
and an upgrade never edits. Secrets stay on the Worker across upgrades.

To redeploy the current release, after an edit to `wrangler.toml` for example:

```sh
buzon deploy
```

To take a dump at any time:

```sh
buzon export-db
```
