# @clearcms/bucket

A document database that lives in a folder of plain JSON files.

```
your-data/
├── _system/
│   └── meta.json
└── collections/
    └── posts/
        ├── 01HXY3...json
        └── 01HXY4...json
```

That's it. Each document is one file. Each collection is one folder. You can `cat` any document, `cp -r` the whole thing as a backup, `git diff` to see what changed, and walk away with your data at any time.

## What it is

A **document database** — like MongoDB, but the storage is just files in a folder you own.

A **multi-runtime library** — runs on Node, Bun, Cloudflare Workers (with the right adapter), Vercel Edge.

A **schema-validated** store — define what each document looks like; invalid writes are rejected.

A **Mongo-flavored API** — `bucket.collection("posts").find({ status: "published" })`.

It's the storage substrate underneath [clear](https://github.com/clearcms/clear) (the CMS), but it's useful on its own — for anything that needs flexible document storage with file-system-native portability.

## Quick start

```bash
pnpm add @clearcms/bucket
```

```ts
import { createBucket } from "@clearcms/bucket";
import { fsAdapter } from "@clearcms/bucket/adapters/fs";
import { z } from "zod";

const bucket = await createBucket({
  adapter: fsAdapter({ root: "./my-data" }),
});

const posts = bucket.collection("posts", {
  schema: z.object({
    title: z.string().min(1).max(200),
    body: z.string(),
    status: z.enum(["draft", "published"]).default("draft"),
    publishedAt: z.string().datetime().optional(),
  }),
});

// Insert
const post = await posts.insert({
  title: "Twelve Dinners",
  body: "Last week we cooked twelve dinners...",
  status: "published",
  publishedAt: "2026-05-09T00:00:00Z",
});
// → { id: "01HXY...", title: "Twelve Dinners", ... }

// Read by id
const loaded = await posts.findById(post.id);

// Query
const published = await posts.find({ status: "published" });
const recent = await posts.find({
  publishedAt: { $gt: "2026-01-01T00:00:00Z" },
}).limit(10);

// Update
await posts.update(post.id, { title: "Twelve Dinners, Twelve Weeks" });

// Delete
await posts.delete(post.id);
```

## Why does this exist?

Every other document database stores data in its own format. MongoDB has WiredTiger. CouchDB has its own binary log. Pocketbase puts everything in one SQLite blob. The data is portable in theory but opaque in practice — you need their software to read it.

`@clearcms/bucket` flips this. Your data is plain JSON files in a folder you control. The library reads and writes those files. If the library disappears, your data is still there, still readable by any text editor, still backup-able with `cp -r`, still diff-able with `git`.

This is the same wedge that [SQLite](https://www.sqlite.org/) carved out for relational databases — small, embedded, file-format-stable, no server to run. `@clearcms/bucket` aims for the document-database equivalent.

## Status

`v0.1.0-alpha.0` — early prototype. The protocol is being stabilized; the API surface may change before `v1.0`.

## Documentation

- [Protocol spec](docs/protocol.md) — the file layout, the adapter interface, the invariants
- [API reference](docs/api.md) — every public function and option
- [Adapters](docs/adapters.md) — fs, memory, and how to write your own
- [Examples](examples/) — `notes-cli` (a small notes app), more coming

## License

MIT — see [LICENSE](LICENSE).
