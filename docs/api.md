# API reference

Every public symbol in `@clearcms/bucket`. For the conceptual overview see [README](../README.md); for the on-disk format and adapter contract see [protocol.md](./protocol.md).

All examples assume TypeScript with `strict: true` and Zod 3.x.

---

## 1. Quick example

```ts
import { createBucket } from "@clearcms/bucket";
import { fsAdapter } from "@clearcms/bucket/adapters/fs";
import { z } from "zod";

const PostSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string(),
  status: z.enum(["draft", "published"]).default("draft"),
  tags: z.array(z.string()).default([]),
});
type Post = z.infer<typeof PostSchema>;

const bucket = await createBucket({
  adapter: fsAdapter({ root: "./my-data" }),
});

const posts = bucket.collection<Post>("posts", { schema: PostSchema });

// Insert
const post = await posts.insert({
  title: "Hello",
  body: "World",
  status: "draft",
  tags: ["intro"],
});

// Find
const drafts = await posts.find({ status: "draft" }, { limit: 10 });

// Update (partial merge, validation re-runs)
await posts.update(post.id, { title: "Hello, world" });

// Delete (idempotent)
await posts.delete(post.id);
```

---

## 2. `createBucket(options)`

Open a bucket. Convenience wrapper around `Bucket.open`.

```ts
function createBucket(options: BucketOptions): Promise<Bucket>;

type BucketOptions = {
  adapter: Adapter;
};
```

**Behaviour.** On open, reads `_system/meta.json`. If missing (fresh bucket), writes a new meta file with the current timestamp and protocol version `"0.1"`. If present but at a higher major protocol version than this library supports, throws — upgrade the library.

```ts
const bucket = await createBucket({ adapter: fsAdapter({ root: "./data" }) });
```

---

## 3. `Bucket`

Top-level handle. Construct via `createBucket` (the constructor is private).

### `bucket.collection<T>(name, options)`

```ts
collection<T extends Record<string, unknown>>(
  name: string,
  options: CollectionOptions<T>,
): Collection<T>;

type CollectionOptions<T> = {
  schema: z.ZodType<T>;
};
```

Returns a typed `Collection`. Cached per bucket — calling `bucket.collection("posts", ...)` twice returns the same instance.

**Name validation.** Must match `/^[a-z][a-z0-9_-]{0,62}$/`: starts with a lowercase letter, then lowercase letters, digits, `_`, or `-`, up to 63 chars total. Invalid names throw at construction.

**Schema is required** — every write is validated. Reads also re-validate; if a document on disk no longer matches the current schema, reads throw `ValidationError`.

```ts
const posts = bucket.collection<Post>("posts", { schema: PostSchema });
```

### `bucket.meta()`

```ts
meta(): Promise<BucketMeta>;
```

Returns the current bucket meta. Throws if the meta file has been deleted externally.

### `bucket.rawAdapter()`

```ts
rawAdapter(): Adapter;
```

Escape hatch — returns the underlying adapter for low-level reads/writes (custom indices, sidecar files, debug tooling). Use sparingly; bypassing the collection layer skips schema validation and timestamp updates.

---

## 4. `Collection<T>`

A named group of similarly-shaped documents. One JSON file per document under `collections/<name>/<id>.json`.

### `insert(data, options?)`

```ts
insert(data: T, options?: { id?: string }): Promise<Document<T>>;
```

Validate, then write a new document. Default id is a fresh [ULID](https://github.com/ulid/spec) (26 chars, lexically sortable, time-prefixed). Pass `options.id` to use a specific id; must match `/^[A-Za-z0-9_-]{1,64}$/`.

Throws if a document with the same id already exists. Throws `ValidationError` if `data` fails the schema.

```ts
const post = await posts.insert({ title: "Hello", body: "...", status: "draft", tags: [] });
const fixed = await posts.insert(data, { id: "my-stable-id" });
```

### `findById(id)`

```ts
findById(id: string): Promise<Document<T> | null>;
```

Returns the document, or `null` if not found.

```ts
const post = await posts.findById("01HXY...");
if (post === null) { /* handle missing */ }
```

### `getById(id)`

```ts
getById(id: string): Promise<Document<T>>;
```

Like `findById` but throws `NotFoundError` instead of returning `null`.

```ts
const post = await posts.getById("01HXY..."); // throws if missing
```

### `update(id, partial)`

```ts
update(id: string, partial: Partial<T>): Promise<Document<T>>;
```

Shallow-merge `partial` into the existing document's `data`, re-validate, write. `createdAt` is preserved; `updatedAt` is bumped to now.

Throws `NotFoundError` if the id is missing. Throws `ValidationError` if the merged result fails the schema (e.g. a defaulted field is now invalid).

Merge is shallow — nested objects are replaced, not merged. For nested merges, fetch first, transform, then `replace`.

```ts
await posts.update(post.id, { title: "New title" });
```

### `replace(id, data)`

```ts
replace(id: string, data: T): Promise<Document<T>>;
```

Full overwrite of `data`. `createdAt` preserved, `updatedAt` bumped. Validates the new data against the schema. Throws `NotFoundError` if missing.

```ts
await posts.replace(post.id, { title: "...", body: "...", status: "published", tags: [] });
```

### `delete(id)`

```ts
delete(id: string): Promise<void>;
```

Idempotent — deleting a missing id is a no-op, no error. Touches the bucket's `lastWriteAt`.

```ts
await posts.delete(post.id);
```

### `list()`

```ts
list(): AsyncIterable<Document<T>>;
```

Async iterator over every document in the collection, in lexical id order. No filter, no pagination — for streaming. Each document is read and validated lazily.

```ts
for await (const post of posts.list()) {
  console.log(post.id, post.data.title);
}
```

### `find(filter, options?)`

```ts
find(filter?: Filter<T>, options?: FindOptions<T>): Promise<Document<T>[]>;
```

Return all documents matching `filter`, optionally sorted, sliced, and limited. Empty filter `{}` matches everything. See [Filters](#5-filters) and [Sort, limit, skip](#6-sort-limit-skip).

Implementation note: `find` scans the full collection (no indices in v0.1). Use `count` for cardinality without payload reads via `list`+filter cost being similar.

```ts
const published = await posts.find({ status: "published" }, { sort: { createdAt: -1 }, limit: 20 });
```

### `findOne(filter)`

```ts
findOne(filter?: Filter<T>): Promise<Document<T> | null>;
```

First match or `null`. Equivalent to `find(filter, { limit: 1 })[0] ?? null`.

```ts
const latest = await posts.findOne({ status: "published" });
```

### `count(filter?)`

```ts
count(filter?: Filter<T>): Promise<number>;
```

Total matching documents. With no filter, returns the collection's total size.

```ts
const total = await posts.count();
const drafts = await posts.count({ status: "draft" });
```

---

## 5. Filters

A `Filter<T>` is an object whose keys are either fields of `T` or one of the logical operators `$and` / `$or`. A field's value can be either a literal (equality match, deep-equal for arrays/objects) or a `FilterOperator` object.

| Operator | Meaning | Example |
|---|---|---|
| `$eq` | Equal (deep) | `{ status: { $eq: "published" } }` |
| `$ne` | Not equal | `{ status: { $ne: "draft" } }` |
| `$gt` | Greater than (numbers/strings) | `{ views: { $gt: 100 } }` |
| `$gte` | Greater than or equal | `{ views: { $gte: 100 } }` |
| `$lt` | Less than | `{ priority: { $lt: 5 } }` |
| `$lte` | Less than or equal | `{ priority: { $lte: 5 } }` |
| `$in` | Field equals any value in list | `{ status: { $in: ["draft", "review"] } }` |
| `$nin` | Field equals none of values in list | `{ status: { $nin: ["archived"] } }` |
| `$exists` | Field is present (`true`) / absent (`false`) | `{ publishedAt: { $exists: true } }` |
| `$regex` | String matches regex pattern | `{ title: { $regex: "^Hello" } }` |
| `$and` | All branches match | `{ $and: [{ status: "published" }, { views: { $gt: 100 } }] }` |
| `$or` | Any branch matches | `{ $or: [{ status: "draft" }, { status: "review" }] }` |

**Notes.**

- Comparison operators (`$gt`, `$gte`, `$lt`, `$lte`) work on numbers and strings. Other types compare as not-matching.
- `$regex` uses the JavaScript `RegExp` constructor on the pattern string; pass flags inline (`"(?i)hello"` is **not** supported — use `"[Hh]ello"` or pre-compose).
- `$exists: true` requires `value !== undefined`. A field set to `null` counts as existing.
- Equality literals on object/array fields use deep-equal — `{ tags: ["food"] }` matches a document whose `tags` array equals `["food"]` exactly, not a document containing `"food"`.

**Combining.**

Top-level keys of a filter are AND-ed together. To express OR, wrap in `$or`. To group disjunctions inside a conjunction, nest `$or` inside `$and`:

```ts
// status is published AND (tags is exactly ["food"] OR views > 1000)
const hits = await posts.find({
  $and: [
    { status: "published" },
    { $or: [{ tags: ["food"] }, { views: { $gt: 1000 } }] },
  ],
});
```

---

## 6. Sort, limit, skip

```ts
type FindOptions<T> = {
  filter?: Filter<T>;
  limit?: number;
  skip?: number;
  sort?: { [K in keyof T]?: 1 | -1 } & { createdAt?: 1 | -1; updatedAt?: 1 | -1 };
};
```

- `sort` — object whose keys are field names (or the envelope keys `createdAt` / `updatedAt`) and values are `1` (ascending) or `-1` (descending). Multiple keys are applied left-to-right (first key is primary). Undefined values sort last regardless of direction.
- `limit` — max documents returned. Default: all matches.
- `skip` — number of leading matches to drop. Default: 0.

Sort happens after filtering, then `skip` and `limit` slice the result. This means `skip + limit` is stable across calls only if the underlying data hasn't changed.

```ts
const page = await posts.find(
  { status: "published" },
  { sort: { createdAt: -1 }, skip: 20, limit: 10 },
);
```

---

## 7. Adapters

An `Adapter` is the storage backend. Bucket ships two; you can write your own.

### `fsAdapter({ root })`

```ts
function fsAdapter(options: { root: string }): Adapter;
```

Local filesystem adapter for Node and Bun. The `root` is resolved to an absolute path; the directory is created on first use.

**Guarantees.**

- **Atomic writes.** Each write goes to a `.tmp-<random>` file in the same directory, is `fsync`'d, then renamed to the target. Readers never see a partial file. The parent directory is `fsync`'d too on Linux for crash durability.
- **Symlink rejection.** Reads, writes, and existence checks `lstat` first and refuse to follow symlinks. This prevents an attacker who can plant a symlink in the bucket from exfiltrating files outside the root.
- **Path containment.** All paths are resolved against `root`; anything that escapes throws.
- **Lexical list order.** `list(prefix)` walks the tree and yields paths sorted lexicographically. `.tmp-*` files are skipped.

```ts
const adapter = fsAdapter({ root: "./my-data" });
```

### `memoryAdapter({ root? })`

```ts
function memoryAdapter(options?: { root?: string }): Adapter;
```

In-memory adapter backed by a `Map`. For tests and ephemeral fixtures. Writes are atomic by nature (single map key). `root` is just a label for logs; defaults to `"memory://"`.

Stored bytes are copied on both `read` and `write`, so callers cannot mutate the stored value through the returned reference.

```ts
const adapter = memoryAdapter();
const adapter2 = memoryAdapter({ root: "test-bucket-1" });
```

### Writing your own adapter

Implement six methods. The contract is in [protocol.md](./protocol.md); the short version:

```ts
type Adapter = {
  root(): string;
  read(path: AdapterPath): Promise<Uint8Array | null>;       // null if absent
  write(path: AdapterPath, content: Uint8Array): Promise<void>; // atomic
  delete(path: AdapterPath): Promise<void>;                  // idempotent
  list(prefix: AdapterPath): AsyncIterable<AdapterPath>;     // sorted
  exists(path: AdapterPath): Promise<boolean>;
};
```

**Rules.**

1. **Validate every input path** with `normalizePath(path)` before using it. Forward-slash separated, relative, no `..`, no leading `/`, no trailing `/`, segments match `/^[A-Za-z0-9._-]+$/`, max 1024 bytes total, max 255 bytes per segment.
2. **`write` must be atomic.** Partial bytes must never be observable to a concurrent `read`. Use temp-and-rename, conditional puts, or whatever your backend supports.
3. **`delete` must be idempotent.** No error on missing paths.
4. **`list` must be sorted lexicographically** by full path, and may be lazy.
5. **`read` returns `null`** for missing paths (not an error).
6. **`root()` is a stable identifier** — used in logs/meta; must not change for the adapter's lifetime.

```ts
import { normalizePath, type Adapter } from "@clearcms/bucket";

export function s3Adapter(opts: { bucket: string; client: S3Client }): Adapter {
  return {
    root: () => `s3://${opts.bucket}`,
    async read(path) {
      const key = normalizePath(path);
      // ...
    },
    // ...
  };
}
```

Run the conformance suite (see [protocol.md](./protocol.md)) against your adapter to verify.

### `normalizePath(path)`

```ts
function normalizePath(path: AdapterPath): AdapterPath;
```

Validate a path against the protocol's syntax rules. Returns the path unchanged on success; throws `Error` with a specific reason on failure. Use this in custom adapters as the first step of every method.

---

## 8. Errors

All bucket errors extend `BucketError` and have a stable `code` string for programmatic handling.

### `BucketError`

```ts
class BucketError extends Error {
  readonly code: string;
}
```

Base class. Catch this to handle any bucket-specific error.

### `ValidationError`

```ts
class ValidationError extends BucketError {
  readonly code: "VALIDATION_FAILED";
  readonly issues: unknown; // Zod issues array
}
```

Thrown when an `insert`, `update`, or `replace` fails schema validation. `issues` is the raw `result.error.issues` from Zod — an array of `{ path, message, code, ... }` objects. Also thrown on read if a document on disk no longer matches the current schema.

```ts
try {
  await posts.insert(data);
} catch (err) {
  if (err instanceof ValidationError) {
    console.error(err.issues);
  }
}
```

### `NotFoundError`

```ts
class NotFoundError extends BucketError {
  readonly code: "NOT_FOUND";
}
```

Thrown by `getById`, and by `update` / `replace` when the target id does not exist. `findById`, `findOne`, and `delete` do **not** throw on missing — they return `null` or no-op.

---

## 9. Types

### `Document<T>`

```ts
type Document<T> = {
  readonly id: string;
  readonly data: T;
  readonly createdAt: string; // ISO 8601
  readonly updatedAt: string; // ISO 8601
};
```

The envelope returned by every read/write method. `id` is the document id; `data` is the validated payload; timestamps are ISO 8601 strings (UTC, millisecond precision).

### `Filter<T>`

```ts
type Filter<T> = {
  [K in keyof T]?: T[K] | FilterOperator<T[K]>;
} & {
  $and?: Filter<T>[];
  $or?: Filter<T>[];
};
```

Mongo-flavoured filter object. See [Filters](#5-filters).

### `FilterOperator<V>`

```ts
type FilterOperator<V> = {
  $eq?: V;
  $ne?: V;
  $gt?: V;
  $gte?: V;
  $lt?: V;
  $lte?: V;
  $in?: V[];
  $nin?: V[];
  $exists?: boolean;
  $regex?: string;
};
```

Operator object for a single field. Multiple operators can be combined in one object — they AND together.

### `FindOptions<T>`

```ts
type FindOptions<T> = {
  filter?: Filter<T>;
  limit?: number;
  skip?: number;
  sort?: { [K in keyof T]?: 1 | -1 } & { createdAt?: 1 | -1; updatedAt?: 1 | -1 };
};
```

See [Sort, limit, skip](#6-sort-limit-skip). The `filter` field on this type is currently unused by `Collection.find` (filter is the first positional argument); it's there for future API symmetry.

### `BucketMeta`

```ts
type BucketMeta = {
  readonly version: string;     // protocol version, e.g. "0.1"
  readonly createdAt: string;   // ISO 8601, when the bucket was first opened
  readonly lastWriteAt: string; // ISO 8601, last successful write
};
```

Returned by `bucket.meta()`. Stored at `_system/meta.json` inside the bucket.

### `SchemaType<T>`

```ts
type SchemaType<T> = z.ZodType<T>;
```

Re-export of Zod's schema type so callers needn't import Zod themselves when typing helpers.

### `Adapter`, `AdapterPath`

See [Adapters](#7-adapters).

---

## 10. Common patterns

### Pagination via skip + limit

```ts
async function page(n: number, size = 20) {
  return posts.find(
    { status: "published" },
    { sort: { createdAt: -1 }, skip: n * size, limit: size },
  );
}
```

For large collections, prefer cursor-style pagination using a sorted field (e.g. `createdAt`):

```ts
async function after(cursor: string, size = 20) {
  return posts.find(
    { createdAt: { $lt: cursor } },
    { sort: { createdAt: -1 }, limit: size },
  );
}
```

This avoids the cost of skipping N matches every page.

### Tagging and querying

Store tags as a string array on the document. Equality on array fields is deep-equal — to match "tag X is one of the document's tags" you currently need to fetch and filter in user code, or denormalise into per-tag boolean fields:

```ts
// schema: tags: z.array(z.string())
// to find docs tagged "food":
const all = await posts.find({});
const food = all.filter((p) => p.data.tags.includes("food"));
```

A first-class array-contains operator is on the roadmap.

### Bulk imports

```ts
async function importMany(rows: Post[]) {
  for (const row of rows) {
    await posts.insert(row);
  }
}
```

Each `insert` is one atomic write plus a meta touch. For very large imports, use the raw adapter to batch writes and skip per-document meta updates, then call `bucket.meta()` once at the end (or write `_system/meta.json` yourself).

### Bucket-level backup

Because everything is plain files, snapshot the whole folder:

```bash
cp -r ./my-data ./my-data.backup-2026-05-09
# or
tar czf my-data.tar.gz ./my-data
# or just commit it to git
git -C ./my-data add -A && git -C ./my-data commit -m "snapshot"
```

To restore: copy back. To inspect: `cat ./my-data/collections/posts/01HXY...json`.
