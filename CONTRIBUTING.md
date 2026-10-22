# Contributing

Issues and pull requests are welcome, including ones written entirely by an AI.

## Setup

The Bun version is pinned in `package.json`.

```sh
bun install
```

Run the CLI from the checkout with `bin/buzon`.

## Checks

A pull request passes all of these:

```sh
bun test
```

```sh
bun run lint && bun run typecheck && bun run format:check && bun run prose
```

The tests use a fake instance and never touch the network. Changes to `skills/buzon/SKILL.md`
are checked against the CLI by `tests/skill.test.ts`.

## Pull requests

- Say in the PR body which AI harness and model helped write it, if any. Commit messages carry
  no AI attribution.
- Examples use `example.com`. No real domain, address, account id or local path.
- Docs describe what the code does now, not how it got there.
