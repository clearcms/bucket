# Roadmap

A rough sequence for getting `@clearcms/bucket` from prototype (`v0.1`) to first stable release (`v1.0`).

## Where we are — `v0.1` (alpha)

The core protocol works. Bucket + Collection + fs/memory adapters + Mongo-flavored filters + schema validation + tests all green. Suitable for:
- Toy projects
- Prototyping the storage layer underneath clear (the CMS)
- Experimentation in Node and Bun

Not yet suitable for:
- Production CMS deployments (no streaming, no pagination, no SQLite cache)
- Cloudflare Workers (no R2 adapter, fs adapter doesn't apply)
- Multi-million-document datasets

## Toward `v0.2` — durability and scale

The release that makes the prototype usable for real projects.

### `BlobAdapter` for large files
The current `Adapter.read` returns `Uint8Array` — fine for JSON, fatal for video. v0.2 splits storage into `Adapter` (JSON, all six methods) and `BlobAdapter` (large files via `ReadStream` / `WriteStream`). Filesystem adapter implements both; new media files would use `BlobAdapter`.

### Paginated list
`Adapter.listPage(prefix, cursor)` returns `{ paths, nextCursor }`. Current `list` becomes a convenience wrapper that loops. Required to make R2 adapter scale.

### SQLite cache layer
Optional cache over `Adapter` that maintains an index of every document for fast `find`. Eliminates the O(n) scan for queries on large collections. Sits behind the same `Collection` API.

### R2 / S3 adapter
Cloudflare R2 and S3-compatible. Leans on the AWS SDK v3 (works in Node and Bun; the Workers variant uses the native `R2Bucket` binding). With this and `BlobAdapter`, a clear bucket can fully live in R2.

### Cloudflare Workers adapter
Native Workers binding for R2. Makes `@clearcms/bucket` usable inside a Worker without bringing in the AWS SDK.

### Schema serialization
Optional: write each collection's schema to `_system/schemas/<name>.json` so the bucket is fully self-describing. A consumer reading a stray bucket can recover the schemas without code.

## Toward `v0.3` — references and integrity

### References
First-class reference field type. A document declares its references; the library validates that targets exist on write (optional strict mode), and resolves them on read.

### Audit log
Optional `_audit/` namespace with append-only event files. Captures every write with actor + timestamp. Invariant: audit-log files are write-once.

### Integrity (OCFL-style inventory)
Optional `_system/inventory.json` carrying SHA-256 of every file. CLI: `bucket verify` walks the bucket, recomputes hashes, reports drift. Foundation for trustworthy backups.

### Migrations spec
Forward-only, idempotent migrations registered against the protocol version. Per-migration progress markers in `_system/meta.json`. Resume-on-crash semantics.

## Toward `v1.0` — stability

The release we recommend for production.

### Frozen protocol
Bucket protocol is `1.0`. Future minor versions are additive; major versions need a migration path.

### Conformance test suite as a published package
`@clearcms/bucket-conformance` — anyone writing a third-party adapter can `import { runConformance }` and verify their implementation.

### Comprehensive docs
- Protocol spec at `docs/protocol.md` (frozen)
- API reference (every public symbol)
- Migration guide (from `0.x` to `1.0`)
- Cookbook (common patterns, performance tips)

### Performance baselines
Benchmarks committed to repo. Targets:
- 1k documents / 100 KB each: insert in <2s, find by id in <1ms (warm cache), full scan in <500ms.
- 100k documents: find with SQLite cache in <50ms p95.

### Stability promise
Once `1.0` ships: no breaking changes to the public API or the bucket protocol within the major version. Deprecations with one-major-version overlap.

## Beyond `v1.0`

Things being thought about but not committed:

- **Browser adapter.** OPFS + sqlite-wasm for full read/write inside a tab. Useful for offline-first PWAs.
- **Sync.** Two-way replication between buckets (fs ↔ R2, R2 ↔ R2). Useful for editor-on-laptop / production-on-edge workflows.
- **Realtime.** Subscriptions (WebSocket / SSE) to changes in a collection. Useful for collaborative editing.
- **Encryption-at-rest.** Adapter wrapper that transparently encrypts/decrypts JSON files with a key. Useful for sensitive content.
- **Compression.** Same shape — wrapper adapter that gzips on write, decompresses on read.

These are signals to track, not commitments. Each requires the adopter base to ask for it.

## How decisions get made

- Adopter feedback shapes priorities. Open an issue for what you need.
- Protocol changes need a written rationale and one approving review.
- Implementation changes follow normal PR review.
- Anything that breaks `cp -r` portability of the bucket is a hard no without an exceptional reason.

The wedge — *plain JSON files in a folder you own* — is non-negotiable. Everything else is on the table.
