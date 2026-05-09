# Bucket Protocol

**Version:** `0.1`
**Status:** draft (pre-`v1.0`; breaking changes still permitted)
**Audience:** library implementers, third-party tools that read or write a bucket directly, anyone considering `@clearcms/bucket` as a storage substrate.

The protocol is the contract between any storage backend and any consumer. This document is the public, language-neutral specification. The TypeScript reference implementation (`@clearcms/bucket`) MUST conform; any other implementation that conforms can read and write the same buckets without coordination.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are used as defined in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

---

## 1. Overview

A **bucket** is a directory of plain JSON files arranged in a fixed layout. Every document is one file; every collection is one folder; bucket-level metadata lives in a reserved `_system/` directory. The wedge: human-readable on disk, portable by `cp -r`, diffable by `git`, and survivable without the library that wrote it.

A bucket is the document-database equivalent of a SQLite file: small, embedded, no server, file-format stable. It is not a synchronization protocol, not a transaction log, and not an opinion about hosting.

---

## 2. Directory layout

A bucket has a single root directory. Inside that root, the protocol reserves two top-level names:

```
<root>/
  _system/
    meta.json
  collections/
    <name>/
      <id>.json
```

Concrete example:

```
my-data/
  _system/
    meta.json
  collections/
    posts/
      01HXY3K9P0000000000000000.json
      01HXY4N1QA000000000000000.json
    comments/
      01HXY7B0Z0000000000000000.json
```

### 2.1 Top-level entries

| Entry | Purpose | Status |
|---|---|---|
| `_system/` | Bucket-level metadata and reserved control files. | Reserved. |
| `_audit/` | Future audit-log namespace. | Reserved (v0.2+). |
| `_revisions/` | Future per-document revision history. | Reserved (v0.2+). |
| `collections/` | Container for all named collections. | Required when any collection exists. |

Implementations MUST NOT write to any top-level name beginning with `_` other than `_system/`, and MUST NOT create or define top-level names not listed above without a protocol version bump.

### 2.2 The `collections/` tree

Every collection is a single directory directly under `collections/`. The directory name is the collection name (see §5). Inside that directory, every regular file whose name ends in `.json` is a document; the file's basename (without `.json`) is the document id.

There are no nested directories under a collection in v0.1. Implementations MUST ignore subdirectories under `<root>/collections/<name>/` when listing documents, but SHOULD NOT create them.

---

## 3. File contents

Every file in a bucket is UTF-8-encoded JSON. There is no binary format, no YAML, no custom envelope outside JSON.

JSON files SHOULD be pretty-printed with two-space indentation and a trailing newline so that diffs are readable. Readers MUST accept any valid JSON, regardless of formatting.

### 3.1 `_system/meta.json` — bucket-level metadata

```json
{
  "version": "0.1",
  "createdAt": "2026-05-09T12:00:00.000Z",
  "lastWriteAt": "2026-05-09T12:34:56.789Z"
}
```

Fields:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `version` | string | yes | Protocol version this bucket conforms to (semver `MAJOR.MINOR`). |
| `createdAt` | string (ISO 8601 UTC) | yes | When the bucket was first opened. Immutable. |
| `lastWriteAt` | string (ISO 8601 UTC) | yes | Updated on every successful collection write or delete. Best-effort, not a transaction log. |

A library opening a bucket MUST create `meta.json` with the current protocol version if it does not exist, and MUST refuse to start if `version` has a major component greater than the library supports (see §10).

### 3.2 `collections/<name>/<id>.json` — document envelope

Every document file is an object with this exact shape:

```json
{
  "id": "01HXY3K9P0000000000000000",
  "data": {
    "title": "Twelve Dinners",
    "body": "Last week we cooked twelve dinners...",
    "status": "published",
    "publishedAt": "2026-05-09T00:00:00Z",
    "tags": []
  },
  "createdAt": "2026-05-09T00:00:00.000Z",
  "updatedAt": "2026-05-09T00:00:00.000Z"
}
```

Envelope fields:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Stable identifier; matches the file's basename. Immutable for the lifetime of the document. |
| `data` | object | yes | The user-defined payload. Validated against the collection's schema (see §9). |
| `createdAt` | string (ISO 8601 UTC) | yes | Set on insert. Immutable. |
| `updatedAt` | string (ISO 8601 UTC) | yes | Set on insert; updated on every write. |

The envelope is the protocol's commitment. The `data` field is opaque to the protocol — its shape is the application's responsibility. Readers that do not understand a `data` shape MUST still be able to parse and round-trip the envelope without loss.

Implementations MUST reject any file in `collections/<name>/` ending in `.json` whose top-level shape does not satisfy: `id` is a non-empty string, `createdAt` and `updatedAt` are non-empty strings, and `data` is present. Implementations MAY surface this as a corruption error to the caller.

### 3.3 Files outside the protocol

Any other file in the bucket root, including hidden files (e.g. `.git/`, `.DS_Store`), is not part of the protocol. Implementations MUST NOT depend on such files for correctness and SHOULD ignore them when listing.

Temporary files used by an adapter for atomic writes (e.g. names beginning with `.tmp-`) are an internal detail of that adapter; other implementations MUST ignore such files when listing and MUST NOT treat them as documents.

---

## 4. Path syntax

All paths used in the adapter contract (§6) are *bucket paths*: forward-slash-separated, relative to the bucket root, ASCII-only. The path syntax is enforced by every adapter; violating paths MUST be rejected before any storage operation.

### 4.1 Rules

A bucket path:

1. MUST be a non-empty string.
2. MUST NOT exceed 1024 bytes (UTF-8) in total length.
3. MUST use `/` as the segment separator.
4. MUST NOT begin with `/` (no absolute paths).
5. MUST NOT end with `/`.
6. MUST NOT contain an empty segment (i.e. `//` is forbidden).
7. MUST NOT contain a segment equal to `.` or `..`.
8. Each segment MUST be at most 255 bytes (UTF-8).
9. Each segment MUST match the regex `^[A-Za-z0-9._-]+$`.
10. After normalisation, the path MUST resolve inside the bucket root. An adapter that maps to a real filesystem MUST reject any input whose resolved absolute path is not equal to, or a descendant of, the configured root.

Lifted directly from the reference implementation (`src/adapters/types.ts`):

```ts
if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
  throw new Error(
    `path component contains disallowed characters: "${segment}". Allowed: A-Z a-z 0-9 . _ -`,
  );
}
```

### 4.2 Notes

- Spaces, colons, backslashes, control characters, and any non-ASCII byte are rejected. This is intentional: it is the smallest character set that round-trips without escaping across Linux, macOS, Windows, S3-compatible object stores, and a URL.
- A leading underscore on a segment is permitted (`_system`, `_audit`, `_revisions`). A leading dot is permitted on a segment as long as the segment is not exactly `.` or `..` — but in practice no protocol path begins with a dot.
- Windows-reserved names like `CON`, `PRN`, `AUX` are NOT rejected by the protocol. An adapter targeting Windows MAY add stricter checks; portable buckets SHOULD avoid these names.
- Case sensitivity is the protocol default. Buckets created on a case-insensitive filesystem (HFS+, default APFS, NTFS) MAY collide; adopters who care about cross-platform portability SHOULD keep collection names and ids in a single case (lower-case is recommended for collection names per §5).

---

## 5. Identifiers

### 5.1 Collection names

A collection name MUST match:

```
^[a-z][a-z0-9_-]{0,62}$
```

That is: a lowercase ASCII letter, followed by up to 62 characters from `[a-z0-9_-]`. Maximum length is 63. Collection names are case-sensitive but lowercase-only by rule, so case is never ambiguous.

### 5.2 Document ids

A document id MUST match:

```
^[A-Za-z0-9_-]{1,64}$
```

That is: 1–64 characters from `[A-Za-z0-9_-]`. The id is the basename of the document file (without the `.json` suffix).

The reference implementation generates ids as [ULIDs](https://github.com/ulid/spec) by default — 26 uppercase Crockford-base32 characters, sortable by creation time. Adopters MAY supply their own ids on insert, subject to the regex above. Adopters SHOULD prefer ULIDs (or another time-ordered, collision-resistant scheme) for new records.

The id stored inside the envelope's `id` field MUST equal the file's basename. A document whose envelope `id` disagrees with its filename is malformed.

---

## 6. Adapter contract

An **adapter** is the seam between the bucket protocol and the underlying storage (a local filesystem, an S3-compatible object store, an in-memory map, a Cloudflare R2 bucket). An adapter exposes exactly six methods. Everything else in the library — collections, queries, schema validation — is built on top.

The TypeScript signature is:

```ts
type Adapter = {
  root(): string;
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, content: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  list(prefix: string): AsyncIterable<string>;
  exists(path: string): Promise<boolean>;
};
```

### 6.1 Method-by-method contract

| Method | Returns | Behaviour | Error semantics |
|---|---|---|---|
| `root()` | string | Stable, human-readable identifier for the bucket (an absolute filesystem path, a URI like `s3://bucket-name`, or a label like `memory://`). MUST NOT change for the lifetime of the adapter instance. | Pure; never throws. |
| `read(path)` | bytes or `null` | Returns the exact bytes previously written at `path`. Returns `null` if no file exists at `path`. The returned bytes MUST be a copy: caller mutation MUST NOT affect storage. | Throws on invalid path (§4) or on storage error (I/O failure, permission denied). MUST NOT throw for "not found" — return `null` instead. |
| `write(path, content)` | void | Atomically writes `content` to `path`. Creates parent containers (directories) as needed. After resolution, partial or corrupt content MUST NOT be observable to a concurrent reader. | Throws on invalid path or storage error. |
| `delete(path)` | void | Removes the file at `path`. Idempotent: deleting a non-existent path is a no-op and MUST NOT throw. | Throws only on invalid path or storage error other than "not found". |
| `list(prefix)` | async iterable of strings | Yields every path under `prefix` (including paths exactly equal to `prefix` if a file exists there) in ascending lexicographic order. The empty string prefix MUST list every path in the bucket. The caller MAY stop iteration early. | Throws on invalid (non-empty) prefix or storage error. A non-existent prefix yields zero items, not an error. |
| `exists(path)` | boolean | True iff a regular file exists at `path`. MUST NOT follow symlinks (or other indirection). | Throws on invalid path or storage error. |

### 6.2 Path normalisation

Every method that takes a `path` or `prefix` (other than `list("")`) MUST validate it against §4 before any storage call. The reference implementation centralises this in `normalizePath()` in `src/adapters/types.ts`; other implementations MAY inline the rules but MUST enforce all of them.

### 6.3 Symlinks and indirection

Adapters built on a real filesystem MUST refuse to read, write, or report `exists` for any path whose final or intermediate component is a symbolic link. This prevents an attacker who can plant a symlink in the bucket from causing the adapter to read or overwrite a file outside the root.

---

## 7. Adapter invariants

Every conforming adapter MUST satisfy these properties. They are the load-bearing guarantees the rest of the library and any third-party tool relies on.

1. **Atomic writes.** A `write` either fully succeeds or has no observable effect. Concurrent readers MUST never observe a partially-written or corrupt file. (Reference fs adapter: write to a temp file in the destination directory, fsync, rename, fsync the directory.)
2. **Read-your-writes.** Within a single adapter instance, a `read` issued after a `write` to the same path returns the bytes from that `write` (or a later one). There is no eventual consistency for the same path within the same process.
3. **Lexicographic listing.** `list(prefix)` yields paths in ascending lexicographic order over the byte values of the path string. Order MUST be deterministic across calls in the absence of intervening writes or deletes.
4. **Idempotent delete.** `delete(path)` on a non-existent path is a no-op that returns successfully.
5. **Path safety.** Any path that violates §4 — including traversal attempts (`a/../../escape.json`), absolute paths (`/etc/passwd`), empty paths, paths with disallowed characters — MUST be rejected before any storage operation.
6. **Read isolation.** The bytes returned from `read` are a defensive copy. Mutating them in the caller MUST NOT affect a subsequent `read` of the same path.
7. **Listing excludes adapter internals.** Temporary files an adapter uses for atomic writes (e.g. `.tmp-*`) MUST NOT appear in `list` output.
8. **No multi-file atomicity.** The adapter contract guarantees per-path atomicity only. Operations that span multiple paths (e.g. updating two documents) are NOT atomic at the protocol level.

---

## 8. Concurrency model

The protocol's concurrency model is intentionally minimal:

- **Last-writer-wins, per path.** If two concurrent writers `write` to the same path, one of them wins; the other's content is discarded. Which one wins is unspecified.
- **No compare-and-swap, no optimistic locking.** v0.1 has no `If-Match` / ETag / version-check. Adapters MAY return such information out-of-band, but the protocol does not require or use it. (See §15 for the future `If-Match` direction.)
- **No multi-file transactions.** Writing two documents is two independent `write` calls. There is no commit barrier. A crash between the two leaves one written and one not.
- **No locks.** The protocol does not provide a locking primitive. Higher-level coordination (single-writer through a queue, advisory file locks, a coordinator process) is the application's responsibility.

This is the same trade-off SQLite makes for its `journal_mode=DELETE` defaults applied to a much simpler model: cheap, deterministic, predictable; not a multi-master replication system.

---

## 9. Schema validation

In v0.1 each collection is opened with a schema supplied at runtime. The reference implementation accepts any [Standard Schema](https://standardschema.dev/)-compatible validator; [Zod](https://zod.dev) is the primary tested option.

Schemas are NOT serialized into the bucket in v0.1. A bucket on disk is therefore not self-describing for `data` shapes — readers need the schema definition (in code or a future serialized form) to validate or interpret `data`. The envelope (§3.2) is always interpretable without a schema.

A `write` whose `data` fails schema validation MUST be rejected before any adapter call. The reference implementation surfaces this as a `ValidationError` with the underlying validator's issue list.

> **Future work (v0.2+):** serialize each collection's schema as `_system/schemas/<name>.json` (or similar), so a third-party tool can validate documents without holding the application's source code. See §15.

---

## 10. Versioning

The protocol uses semantic versioning at the `MAJOR.MINOR` level. The current version is `0.1`.

The version is stored in `_system/meta.json` as the `version` field (see §3.1). Policy:

- A library opening a bucket whose `version` has a **major** component greater than the library supports MUST refuse to start, surfacing a clear error that names both the bucket version and the library's maximum supported version.
- A library opening a bucket whose `version` has a major equal to its own MAY proceed, even if the bucket's minor version is higher than the library's. (Forward-compatible reads within a major.)
- A library opening a bucket whose `version` is lower than its own MAY proceed and SHOULD upgrade `meta.json` to its current version on first write, provided no breaking on-disk change is required. Breaking changes within a major are disallowed by definition.
- Pre-1.0 (`0.x`) versions are explicitly unstable: minor bumps MAY include breaking changes. Adopters who pin to `0.x` accept this.

A new `meta.json` written by a library at protocol version `X.Y` MUST set `version` to exactly `X.Y` (no `+build`, no extensions). Unknown extra top-level fields in `meta.json` are reserved; readers SHOULD ignore unknown fields and SHOULD NOT delete them on rewrite.

---

## 11. Reserved namespaces

The following top-level names under the bucket root are reserved by the protocol:

| Prefix | Purpose | Status in v0.1 |
|---|---|---|
| `_system/` | Bucket-level control files (`meta.json`, future indexes, future schema serialization). | Active. |
| `_audit/` | Append-only audit log of bucket operations. | Reserved (v0.2+). |
| `_revisions/` | Per-document historical versions. | Reserved (v0.2+). |

Implementations and adopters MUST NOT write user data under any of these prefixes. Future protocol versions MAY define additional reserved prefixes; new reservations require a major or minor bump and an entry in this section.

`collections/` is the namespace for user data. All other top-level names are reserved for the protocol.

---

## 12. What this protocol does NOT specify

In v0.1, the protocol is deliberately small. The following are explicitly out of scope:

1. **References between documents.** A document's `data` MAY contain another document's id as a string, but the protocol does not model references, does not validate them, and does not provide cascading delete or dangling-reference detection. (See §15.)
2. **Indexes.** The reference library MAY maintain a SQLite-backed cache for query performance; that cache is an implementation detail, NOT part of the protocol. A bucket without any cache is fully readable.
3. **Multi-document transactions.** Per-path atomicity only (§7, §8). No commit barrier across paths.
4. **Streaming reads/writes.** The adapter contract works in whole-buffer terms (`Uint8Array`). Large blobs (images, video, binaries above a few MB) are not addressed in v0.1; a separate `BlobAdapter` interface is reserved for v0.2.
5. **Pagination on `list`.** `list` yields all matching paths. There is no cursor, no page size, no resumption. (See §15: `listPage` is reserved for v0.2.)
6. **Authentication and access control.** The adapter is trusted; access control is the host application's concern.
7. **Audit logging.** No protocol-level invariant in v0.1; the `_audit/` prefix is reserved for a future spec.
8. **Migrations.** Forward-only and idempotent in spirit, but not yet specified in detail. The reference library does not yet apply migrations; future minor versions will.
9. **Garbage collection / compaction.** Not applicable in v0.1 because deletes are immediate and complete; relevant if `_revisions/` is added.
10. **Sync / replication.** A bucket is a local artifact. Synchronisation between two buckets is the user's job (`rsync`, `git`, an object-store sync command).

---

## 13. Conformance

A storage backend is a valid `@clearcms/bucket` adapter if and only if it passes the conformance suite at `test/adapter-conformance.test.ts`. The suite is the contract; new test cases added there are protocol changes and are version-bump-worthy.

The current test cases (each MUST pass for both reference adapters and any third-party adapter):

- [ ] `read returns null for missing path`
- [ ] `write then read round-trips bytes`
- [ ] `exists is true after write, false after delete`
- [ ] `delete is idempotent`
- [ ] `list yields paths sorted lexicographically`
- [ ] `list filters by prefix`
- [ ] `rejects path traversal attempts` (covers `../escape.json`, `a/../../escape.json`, `/abs/path.json`, empty string)
- [ ] `rejects disallowed characters` (covers `file:colon.json`, `with spaces.json`)
- [ ] `read returns a copy that does not mutate stored bytes`

A higher-level set of bucket-protocol tests at `test/bucket.test.ts` exercises the `Bucket` and `Collection` surface and is informative; the adapter conformance suite is normative.

---

## 14. Comparison to prior art

**SQLite.** SQLite carved out a category for relational data: local, embeddable, single-file, format-stable, no server. `@clearcms/bucket` aims for the same category in the document-store world, with one trade-off SQLite did not make: the on-disk representation is human-readable. A bucket is a folder of JSON files; SQLite is a single binary file. The cost is performance and atomic multi-row commits; the win is portability and inspection without a tool.

**MongoDB.** MongoDB pioneered the document-store data model the protocol borrows (collections of JSON-shaped documents, ad-hoc query operators like `$gt`, `$in`, `$regex`). MongoDB stores those documents in a proprietary binary format (BSON in WiredTiger). `@clearcms/bucket` keeps the data model and discards the storage format: same shapes, plain JSON on disk, no daemon, no replica set.

**OCFL** ([Oxford Common File Layout](https://ocfl.io/)). An academic library specification for content preservation that established "self-describing files in a folder" as a serious design — every OCFL object carries enough metadata to be interpreted without external tooling. `@clearcms/bucket` borrows the philosophy without the heaviness: the bucket is interpretable in isolation; future work (`_system/inventory.json`, see §15) may adopt OCFL-style content addressing for integrity.

**git.** Git is content-addressable: a file's path inside a repo is incidental, and the same content at two paths is one blob. `@clearcms/bucket` is path-addressed: the document's id is its filename and that is the only handle. The trade-off: git deduplicates and gives you an immutable history for free, but reading a file requires walking the object graph; bucket gives you `cat <path>` and no history without a layer on top. A bucket can be put inside a git repo (and `git diff` is one of the design's selling points), but the protocol itself does not use git.

---

## 15. Future work

These items are explicitly deferred to v0.2 or later. They are noted here so adopters can predict the direction without building against unspecified surface today.

1. **`BlobAdapter`.** A separate interface for large binary content (images, video, attachments). Streaming reads/writes, content-type metadata, no JSON envelope. Likely a sibling of `Adapter`, attached to a bucket via a separate option.
2. **`listPage`.** A paginated variant of `list` returning a page plus an opaque cursor. Avoids unbounded memory on buckets with millions of documents per collection.
3. **Schema serialization.** Each collection's schema serialized into `_system/schemas/<name>.json` (Standard Schema or JSON Schema). Makes the bucket fully self-describing; enables third-party validators with no application source.
4. **Migrations spec.** Per-migration progress markers, idempotency guarantees, mixed-version state during a long-running migration, the file format for migration scripts.
5. **References + dangling resolution.** A typed `reference` field shape, a documented format for cross-collection references, and an optional integrity check that surfaces dangling references.
6. **Audit log invariant.** What goes into `_audit/`, append-only semantics, retention policy, who is responsible for writing it.
7. **OCFL-style integrity inventory.** `_system/inventory.json` listing every document path with a content hash; enables integrity verification and sync without trusting filesystem mtimes.
8. **R2 / Cloudflare Workers adapter.** A reference adapter for S3-compatible object stores that satisfies the conformance suite under a remote backend.
9. **Optimistic concurrency.** ETag-style version tokens returned from `read`/`write`, an optional `ifMatch` parameter on `write` that fails if the path's current version differs. Optional per adapter; the conformance suite would gain a separate "supports CAS" flag.

This list is not a roadmap commitment. It is the set of named gaps so adopters can plan around them.

---

## Appendix A — Reference paths in the implementation

For maintainers and reviewers, the canonical references for each section in the TypeScript reference library are:

- §3.1 `_system/meta.json` shape: `src/bucket.ts` (`readMeta`, `writeMeta`, `BucketMeta` in `src/types.ts`)
- §3.2 document envelope: `src/collection.ts` (`readDocument`, `writeDocument`, `Document<T>` in `src/types.ts`)
- §4 path syntax: `src/adapters/types.ts` (`normalizePath`)
- §5 identifier regexes: `src/collection.ts` (constructor + `pathFor`)
- §6 adapter contract: `src/adapters/types.ts` (`Adapter`)
- §6 reference adapters: `src/adapters/memory.ts`, `src/adapters/fs.ts`
- §10 version handling: `src/bucket.ts` (`Bucket.open`)
- §13 conformance suite: `test/adapter-conformance.test.ts`
