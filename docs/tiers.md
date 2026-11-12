# Tiers

Every address buzon creates has a tier, written into its name. The tier says how long the
address and its mail live, and the instance cleans up on its own from the name alone.

| Tier     | For                                                     | Mail kept | Address kept                    |
| -------- | ------------------------------------------------------- | --------- | ------------------------------- |
| `ste`    | One code or link, then nothing more                     | 7 days    | 30 days                         |
| `mte`    | A process lasting weeks: a trial, one application cycle | 180 days  | until 180 days without new mail |
| `lte`    | A real account the user may need again                  | forever   | forever                         |
| `custom` | An address with a chosen name: `new custom` or `adopt`  | forever   | forever                         |

`buzon delete` removes an `ste` or `mte` at once. `lte` and `custom` addresses need `--force`.

## Names

```
{tier}-{YYMM}[-{site}]-{rand3}
```

`YYMM` is the UTC month of creation, `site` is 1 to 12 of `[a-z0-9]` naming the platform
(`lte` and `mte` only), and `rand3` is three random `[a-z0-9]`. For example
`lte-2610-github-k3x@example.com` or `ste-2610-9qa@example.com`. The instance's
`ADDRESS_CHECK_REGEX` accepts nothing else from the public API, so every address made there
carries a tier prefix that the cleanup can match on.

`buzon new custom <name>` creates a name outside the scheme through the admin API, which skips
that check. buzon checks the name itself: 1 to 30 of `[a-z0-9.-]`, starting and ending with a
letter or digit, and never starting with `ste-`, `mte-` or `lte-`, which the cleanup would
match.

## Cleanup

The instance's daily cron runs the Custom SQL Cleanup list from the admin page (Maintenance).
Add these statements in this order, each as its own item, and keep the built-in cleanups off.

Some facts the statements rely on:

- `address.name` and `raw_mails.address` both hold the full `name@domain`.
- The items run in list order, so the rows that point at an address (mail, sender access,
  sendbox, auto reply, user binding) go before the address itself.
- The `mte` idle rule keeps `address IS NOT NULL` in its `NOT IN` subquery: a single NULL
  there would make `NOT IN` match nothing, and no `mte` address would ever expire.
- `mte` mail is kept as long as the idle window, 180 days, so the idle rule can still see the
  last mail an address received.

```sql
-- ste-mail: ste mail older than 7 days
DELETE FROM raw_mails WHERE address LIKE 'ste-%' AND created_at < datetime('now','-7 day');

-- ste-addr-raw-mails: ste expired address: mail
DELETE FROM raw_mails WHERE address IN (SELECT name FROM address WHERE name LIKE 'ste-%' AND created_at < datetime('now','-30 day'));

-- ste-addr-sender: ste expired address: sender access
DELETE FROM address_sender WHERE address IN (SELECT name FROM address WHERE name LIKE 'ste-%' AND created_at < datetime('now','-30 day'));

-- ste-addr-sendbox: ste expired address: sendbox
DELETE FROM sendbox WHERE address IN (SELECT name FROM address WHERE name LIKE 'ste-%' AND created_at < datetime('now','-30 day'));

-- ste-addr-auto-reply: ste expired address: auto reply
DELETE FROM auto_reply_mails WHERE address IN (SELECT name FROM address WHERE name LIKE 'ste-%' AND created_at < datetime('now','-30 day'));

-- ste-addr-users: ste expired address: user binding
DELETE FROM users_address WHERE address_id IN (SELECT id FROM address WHERE name LIKE 'ste-%' AND created_at < datetime('now','-30 day'));

-- ste-addr: ste address older than 30 days
DELETE FROM address WHERE name LIKE 'ste-%' AND created_at < datetime('now','-30 day');

-- mte-mail: mte mail older than 180 days
DELETE FROM raw_mails WHERE address LIKE 'mte-%' AND created_at < datetime('now','-180 day');

-- mte-addr-raw-mails: mte expired address: mail
DELETE FROM raw_mails WHERE address IN (SELECT name FROM address WHERE name LIKE 'mte-%' AND created_at < datetime('now','-180 day') AND name NOT IN (SELECT address FROM raw_mails WHERE address IS NOT NULL AND created_at >= datetime('now','-180 day')));

-- mte-addr-sender: mte expired address: sender access
DELETE FROM address_sender WHERE address IN (SELECT name FROM address WHERE name LIKE 'mte-%' AND created_at < datetime('now','-180 day') AND name NOT IN (SELECT address FROM raw_mails WHERE address IS NOT NULL AND created_at >= datetime('now','-180 day')));

-- mte-addr-sendbox: mte expired address: sendbox
DELETE FROM sendbox WHERE address IN (SELECT name FROM address WHERE name LIKE 'mte-%' AND created_at < datetime('now','-180 day') AND name NOT IN (SELECT address FROM raw_mails WHERE address IS NOT NULL AND created_at >= datetime('now','-180 day')));

-- mte-addr-auto-reply: mte expired address: auto reply
DELETE FROM auto_reply_mails WHERE address IN (SELECT name FROM address WHERE name LIKE 'mte-%' AND created_at < datetime('now','-180 day') AND name NOT IN (SELECT address FROM raw_mails WHERE address IS NOT NULL AND created_at >= datetime('now','-180 day')));

-- mte-addr-users: mte expired address: user binding
DELETE FROM users_address WHERE address_id IN (SELECT id FROM address WHERE name LIKE 'mte-%' AND created_at < datetime('now','-180 day') AND name NOT IN (SELECT address FROM raw_mails WHERE address IS NOT NULL AND created_at >= datetime('now','-180 day')));

-- mte-addr: mte address idle for 180 days
DELETE FROM address WHERE name LIKE 'mte-%' AND created_at < datetime('now','-180 day') AND name NOT IN (SELECT address FROM raw_mails WHERE address IS NOT NULL AND created_at >= datetime('now','-180 day'));
```

The admin page's manual cleanup button runs only the built-in presets, never this list. To
check a statement before the cron runs it, ask D1 for its plan from the upstream checkout's
`worker/` directory:

```sh
pnpm wrangler d1 execute buzon-db --remote --command "EXPLAIN QUERY PLAN <statement>"
```
