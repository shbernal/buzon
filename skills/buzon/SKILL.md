---
name: buzon
description: Create email addresses on the user's own temp-mail domain and read what arrives, including verification codes and magic links. Use when a sign-up form, trial, job application or service needs an email address, when a site sends a code or confirmation link, or when asked which address was used for an account.
---

# buzon

`buzon` creates addresses on the user's self-hosted mail domain and reads their inbox. It
keeps a local registry of every address with its tier, site and note.

buzon is the only interface. Never call the mail API yourself, and never print, log or pass
on the tokens buzon stores. Add `--json` to any command for machine-readable output; errors
then come on stderr as `{"error": …, "causes": […]}`.

## Pick the tier

| Situation                                                       | Tier                           |
| --------------------------------------------------------------- | ------------------------------ |
| One code or link, then nothing more                             | `ste`, deleted after use       |
| A process lasting weeks: a trial, one application cycle         | `mte`                          |
| A real account the user may need again: a job portal, a service | `lte --site <site> --note "…"` |

When the user asks for a specific name, such as `jane@`, use `buzon new custom jane --note "…"`.
It is kept like `lte`.

When unsure between `mte` and `lte`, pick `lte`: buzon keeps it and its site and note make
the account findable later.

`--site` is 1 to 12 lowercase letters or digits naming the platform, such as `greenhouse`,
`lever` or `github`. `ste` takes no `--site`.

An `lte` note says what the account is for and when it was made, in the user's words where
possible: `--note "Greenhouse account for Acme job applications, 2026-10"`. Fix a note later
with `buzon note <address> "…"`.

## Get a code or a link

```sh
buzon new ste --json                  # prints the address
# submit the form with that address
buzon wait <address> --code --since 10m --json
buzon delete <address>                # ste only
```

Delete an `ste` as soon as its code or link is in hand, without asking. If another code is
needed later, a new `ste` costs nothing.

`wait` takes `--code` for a verification code, `--link` for a confirmation or magic link,
or neither for the whole mail. `--since 10m` also takes mail that landed before `wait`
started; without it, `wait` only sees mail that arrives after it starts. Narrow a busy inbox
with `--from <regex>` or `--subject <regex>`. It gives up after `--timeout 300` seconds and
exits 1.

To read mail that is already there: `buzon read <address>` for the latest, `--all` for every
mail, `--id <n>` for one.

## When nothing arrives

1. `buzon read <address> --all`: the mail may be there but not match your filters, or carry
   the code in a form `--code` did not pick up.
2. Retry once: resend from the site if it offers that, then `wait` again.
3. Still nothing: stop and tell the user which address you used and what you waited for.

## Find and keep addresses

```sh
buzon list --site greenhouse --json   # also --tier ste|mte|lte|custom
buzon show <address> --json           # registry entry and mail count
```

Before creating an `lte`, check `list --site` for one the user already has on that platform.

Never delete an `lte` or `custom` address unless the user asks. buzon refuses without
`--force`; pass it only on that explicit request.

## Privacy

Mail bodies are the user's private mail. Quote a code or link where the task needs it, and
keep the rest out of unrelated outputs, files and commits.
