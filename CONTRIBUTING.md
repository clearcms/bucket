# Contributing to @clearcms/bucket

Thanks for considering a contribution.

## Quick start

```sh
git clone https://github.com/clearcms/bucket.git
cd bucket
pnpm install
pnpm test
```

## Loop

```sh
pnpm typecheck   # tsc --noEmit
pnpm lint        # biome check
pnpm format      # biome format --write
pnpm test        # vitest run
pnpm test:watch  # vitest watch mode
pnpm build       # tsup → dist/
```

CI runs the same commands on Node 20 + 22 and Bun (latest).

## Conventions

- TypeScript, strict mode. No `any`, no non-null assertion (`!`).
- ESM only. No CommonJS.
- Two-space indent. Double quotes. Trailing commas. Lines ≤100 cols. Biome enforces.
- Identifiers carry meaning. Comment only the *why*, never the *what*.
- One concern per commit. Imperative mood in commit subject ("add", not "added").
- Tests are required for new functionality. Follow the existing structure in `test/`.

## What goes in the protocol

The bucket protocol is a public contract. Changes that affect the on-disk layout, the adapter interface, the `_system/meta.json` shape, or the document envelope are **protocol changes** and need a brief written rationale (issue or PR description). Implementation-internal changes (refactors, perf wins, new query operators) do not.

If you're proposing a protocol change, open an issue first to discuss before writing the PR.

## Writing a new adapter

The adapter contract is in `src/adapters/types.ts`. Implement the six methods (`root`, `read`, `write`, `delete`, `list`, `exists`) and ensure your adapter passes the conformance suite at `test/adapter-conformance.test.ts`. Add your adapter to the test factories in that file.

Adapter PRs are welcome. We are particularly interested in:
- R2 / S3-compatible (Cloudflare R2, AWS S3, Backblaze B2)
- Cloudflare Workers (using the Workers Cache API or KV)
- Browser (using OPFS + sqlite-wasm if a derived index is wanted)
- GitHub (read-only, fetches blobs via the GitHub API)

## Filing bugs

Open an issue with:
- The runtime (Node version / Bun version / Workers)
- A minimal reproduction (the smaller the better)
- Expected vs. actual behaviour

If the bug touches the bucket protocol invariants, prioritise the spec — protocol bugs are higher severity than implementation bugs.

## Code of conduct

Be kind. We're all here to build something useful.

## License

By contributing you agree your contributions are licensed under the project's MIT license.
