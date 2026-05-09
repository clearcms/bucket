# Changelog

All notable changes to `@clearcms/bucket` are recorded here.

This project follows [Semantic Versioning](https://semver.org/) once it reaches `1.0.0`. Pre-1.0 releases (`0.x`) may include breaking changes between minor versions; pin exact versions until `1.0`.

## [0.1.0-alpha.0] — 2026-05-09

Initial prototype release.

### Added
- `Bucket` and `Collection<T>` core classes with full CRUD plus `find`, `findOne`, `count`.
- Mongo-flavored filter operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$regex`, `$contains` (array-element match), plus logical `$and` / `$or`.
- `find` options: `limit`, `skip`, `sort` (with envelope keys `createdAt` / `updatedAt` plus any data field).
- Schema validation via any Zod schema (parsed on every read and write).
- Filesystem adapter (`fsAdapter`) — atomic writes via temp-file-rename + fsync, symlink rejection, path-traversal hardening.
- In-memory adapter (`memoryAdapter`) — for tests and ephemeral use.
- Adapter conformance suite — runs against any adapter implementation.
- Bucket protocol v0.1: directory layout, `_system/meta.json`, document envelope, path syntax.
- TypeScript types throughout. Strict-mode codebase.
- Build via `tsup` → ESM, ~20 KB unminified.
- CI on GitHub Actions: Node 20 + 22 + Bun.

### Known limitations
- No streaming reads/writes (planned for v0.2 via separate `BlobAdapter`).
- `list` returns the full set; no pagination yet (planned for v0.2 via `listPage`).
- Schemas live in code only — not serialized into the bucket.
- No references between collections at the protocol level (callers store ids and resolve manually).
- No SQLite cache layer yet (planned for v0.2 to back `find` queries against large collections).
- No R2 / Cloudflare Workers adapter yet (planned for v0.2).
- No migrations spec yet — `_system/meta.json` carries a `version` but the migration mechanism is unspecified.

### Protocol version
- Bucket protocol: `0.1`

[0.1.0-alpha.0]: https://github.com/clearcms/bucket/releases/tag/v0.1.0-alpha.0
