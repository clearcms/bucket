# notes-cli

A tiny terminal notes app built on [`@clearcms/bucket`](../..). It's the smallest end-to-end example of the library: one schema, one collection, all CRUD verbs, plus a substring search.

Notes live in `./.notes/` as plain JSON — open the folder in any editor, or `cp -r` it to back up.

## Run it

From this directory:

```bash
pnpm install   # or npm install
pnpm dev init
pnpm dev add "Coffee" --body "Try the new beans" --tag drink --tag morning
pnpm dev list
```

`pnpm dev` is just `tsx src/index.ts` — same flags work with `npx tsx src/index.ts ...` if you don't have pnpm.

## Commands

```
notes init                          create a bucket at ./.notes
notes add <title>                   add a note (--body "..." or pipe via stdin)
                                    tags via --tag t1 --tag t2 (repeatable)
notes list                          list notes (--tag <t> to filter)
notes show <id>                     print one note in full
notes edit <id> --title "..." --body "..."
notes rm <id>                       delete (-f to skip confirmation)
notes find <query>                  substring search on title
notes stats                         count + most-recent timestamp

# global
--dir <path>                        bucket directory (default: ./.notes)
--help, -h
```

`<id>` accepts the full ULID or the short last-8 suffix shown in `list` output, as long as the suffix is unambiguous.

## What this example shows

- Opening a bucket with the filesystem adapter:
  `createBucket({ adapter: fsAdapter({ root: dir }) })`
- Defining a Zod schema and getting a typed `Collection<Note>`.
- Insert / find / update / delete via the Mongo-flavoured API.
- A `$regex` query for substring search on `title`.
- Sorting by the envelope-level `updatedAt` field.

The whole CLI is roughly 300 lines across `src/index.ts`, `src/notes.ts`, and `src/render.ts`. No CLI framework, no colour library — just the standard library, `@clearcms/bucket`, and `zod`.

## Layout on disk

After a few `add`s:

```
.notes/
├── _system/
│   └── meta.json
└── collections/
    └── notes/
        ├── 01J...A.json
        └── 01J...B.json
```

Each `.json` file is one note. `cat` it, `git diff` it, walk away with it.
