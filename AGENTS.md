# AI project guidelines

`buzon`: CLI and agent skill for a self-hosted cloudflare_temp_email instance.

- Key commands
  - `bun test`
  - `bun run lint`, `bun run typecheck`, `bun run format:check`

- Rules
  - Public repo: no real domain, email, account id or local path. Examples use `example.com`.

- Iron Laws
  - State of the art AI models/harnesses need minimal guidance. Don't repeat yourself, don't babysit, don't be over-specific.
  - Only document items here when model diverges repeatedly from expected behavior. Don't document behaviors implemented without errors.
  - No journaling: code comments / documentation describe current state, they don't carry a log of their own edit history.
