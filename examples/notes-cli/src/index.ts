#!/usr/bin/env node
/**
 * notes-cli — example app for @clearcms/bucket.
 *
 * Usage: notes <command> [args] [flags]
 *
 *   init                      create a bucket at ./.notes (or --dir <path>)
 *   add <title>               add a note (--body, --tag, repeatable)
 *   list                      list notes (--tag <tag> filter)
 *   show <id>                 print one note
 *   edit <id>                 update --title and/or --body
 *   rm <id>                   delete a note (-f to skip confirmation)
 *   find <query>              substring search on title (regex via $regex)
 *   stats                     count + most-recent timestamp
 *
 * Global flags: --dir <path>  (defaults to ./.notes)
 *               --help / -h
 */

import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Document } from "@clearcms/bucket";
import { NotFoundError, ValidationError } from "@clearcms/bucket";
import { type Note, openNotes } from "./notes.js";
import {
  c,
  formatTags,
  formatTime,
  renderTable,
  shortId,
  shortTitle,
} from "./render.js";

// ---------- argv parser ----------

type Argv = {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string | boolean>;
  multi: Record<string, string[]>;
};

function parseArgv(argv: string[]): Argv {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const multi: Record<string, string[]> = {};
  // Flags that can repeat (collected into `multi`).
  const repeatable = new Set(["tag"]);
  // Short-flag aliases.
  const aliases: Record<string, string> = { f: "force", h: "help" };

  let i = 0;
  while (i < argv.length) {
    const a = argv[i] as string;
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        if (repeatable.has(name)) {
          (multi[name] ??= []).push(next);
        } else {
          flags[name] = next;
        }
        i += 2;
      } else {
        flags[name] = true;
        i += 1;
      }
    } else if (a.startsWith("-") && a.length > 1) {
      const short = a.slice(1);
      const name = aliases[short] ?? short;
      flags[name] = true;
      i += 1;
    } else {
      positional.push(a);
      i += 1;
    }
  }
  return { command: positional.shift(), positional, flags, multi };
}

// ---------- helpers ----------

const HELP = `notes — a tiny notes CLI built on @clearcms/bucket

Commands
  init                       create a bucket at ./.notes (or --dir <path>)
  add <title>                add a note. body via stdin, or --body "..."
                             tags via --tag t1 --tag t2 (repeatable)
  list                       list notes; filter with --tag <tag>
  show <id>                  print one note in full (full id or last-8 short)
  edit <id>                  update --title and/or --body
  rm <id>                    delete a note (-f to skip confirmation)
  find <query>               substring search on title
  stats                      count + most-recent updatedAt

Global flags
  --dir <path>               bucket directory (default: ./.notes)
  --help, -h                 this message
`;

function getDir(flags: Record<string, string | boolean>): string {
  const flag = flags.dir;
  return resolve(typeof flag === "string" ? flag : "./.notes");
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    process.stderr.write(c.dim("Enter body. End with Ctrl-D on its own line.\n"));
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8").replace(/\n+$/, "");
}

async function confirm(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer: string = await new Promise((resolveP) =>
      rl.question(prompt, (ans) => resolveP(ans)),
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * Resolve the "id" the user typed against stored documents.
 *
 * Bucket ids are 26-char ULIDs. The list/show output prints the last 8 for
 * readability, so we accept either the full id or that short suffix as long
 * as the suffix is unambiguous.
 */
async function resolveId(
  notes: Awaited<ReturnType<typeof openNotes>>["notes"],
  given: string,
): Promise<Document<Note>> {
  // Fast path: full id lookup.
  if (/^[A-Za-z0-9_-]{20,64}$/.test(given)) {
    const direct = await notes.findById(given);
    if (direct) return direct;
  }
  // Fallback: scan and match suffix.
  const matches: Document<Note>[] = [];
  for await (const doc of notes.list()) {
    if (doc.id === given || doc.id.endsWith(given)) matches.push(doc);
  }
  if (matches.length === 0) {
    throw new NotFoundError(`no note matching id "${given}"`);
  }
  if (matches.length > 1) {
    const list = matches.map((m) => shortId(m.id)).join(", ");
    throw new Error(`id "${given}" is ambiguous: ${list}`);
  }
  return matches[0] as Document<Note>;
}

// ---------- commands ----------

async function cmdInit(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  // openNotes writes _system/meta.json on first open.
  await openNotes(dir);
  process.stdout.write(`Initialised bucket at ${c.green(dir)}\n`);
}

async function cmdAdd(
  dir: string,
  title: string,
  flags: Record<string, string | boolean>,
  tags: string[],
): Promise<void> {
  const { notes } = await openNotes(dir);
  const body =
    typeof flags.body === "string" ? flags.body : await readStdin();
  const doc = await notes.insert({ title, body, tags });
  process.stdout.write(
    `Added ${c.green(shortId(doc.id))}  ${c.bold(shortTitle(doc.data.title))}\n`,
  );
}

async function cmdList(
  dir: string,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const { notes } = await openNotes(dir);
  const tagFilter = typeof flags.tag === "string" ? flags.tag : undefined;
  const docs = await notes.find({}, { sort: { updatedAt: -1 } });
  const filtered = tagFilter
    ? docs.filter((d) => d.data.tags.includes(tagFilter))
    : docs;

  if (filtered.length === 0) {
    process.stdout.write(c.dim("No notes.\n"));
    return;
  }

  const rows = filtered.map((d) => [
    c.dim(shortId(d.id)),
    shortTitle(d.data.title, 50),
    formatTags(d.data.tags),
    c.dim(formatTime(d.updatedAt)),
  ]);
  process.stdout.write(
    `${renderTable(["ID", "TITLE", "TAGS", "UPDATED"], rows)}\n`,
  );
}

async function cmdShow(dir: string, id: string): Promise<void> {
  const { notes } = await openNotes(dir);
  const doc = await resolveId(notes, id);
  const out = [
    `${c.bold(doc.data.title)}  ${c.dim(`(${shortId(doc.id)})`)}`,
    `${c.dim("tags")}     ${formatTags(doc.data.tags)}`,
    `${c.dim("created")}  ${formatTime(doc.createdAt)}`,
    `${c.dim("updated")}  ${formatTime(doc.updatedAt)}`,
    "",
    doc.data.body || c.dim("(empty body)"),
    "",
  ].join("\n");
  process.stdout.write(out);
}

async function cmdEdit(
  dir: string,
  id: string,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const { notes } = await openNotes(dir);
  const doc = await resolveId(notes, id);
  const partial: Partial<Note> = {};
  if (typeof flags.title === "string") partial.title = flags.title;
  if (typeof flags.body === "string") partial.body = flags.body;
  if (Object.keys(partial).length === 0) {
    throw new Error("nothing to edit. pass --title and/or --body");
  }
  const updated = await notes.update(doc.id, partial);
  process.stdout.write(
    `Updated ${c.green(shortId(updated.id))}  ${c.bold(shortTitle(updated.data.title))}\n`,
  );
}

async function cmdRm(
  dir: string,
  id: string,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const { notes } = await openNotes(dir);
  const doc = await resolveId(notes, id);
  if (flags.force !== true) {
    const ok = await confirm(
      `Delete "${doc.data.title}" (${shortId(doc.id)})? [y/N] `,
    );
    if (!ok) {
      process.stdout.write("Aborted.\n");
      return;
    }
  }
  await notes.delete(doc.id);
  process.stdout.write(`Deleted ${c.red(shortId(doc.id))}\n`);
}

async function cmdFind(dir: string, query: string): Promise<void> {
  const { notes } = await openNotes(dir);
  // Escape regex specials so substring search behaves like substring.
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const docs = await notes.find({ title: { $regex: escaped } });
  if (docs.length === 0) {
    process.stdout.write(c.dim(`No matches for "${query}".\n`));
    return;
  }
  const rows = docs.map((d) => [
    c.dim(shortId(d.id)),
    shortTitle(d.data.title, 50),
    formatTags(d.data.tags),
    c.dim(formatTime(d.updatedAt)),
  ]);
  process.stdout.write(
    `${renderTable(["ID", "TITLE", "TAGS", "UPDATED"], rows)}\n`,
  );
}

async function cmdStats(dir: string): Promise<void> {
  const { bucket, notes } = await openNotes(dir);
  const total = await notes.count();
  const meta = await bucket.meta();
  const newest = await notes.find({}, { sort: { updatedAt: -1 }, limit: 1 });
  const mostRecent = newest[0]?.updatedAt ?? null;
  process.stdout.write(
    [
      `${c.bold("notes")}        ${total}`,
      `${c.bold("most recent")}  ${mostRecent ? formatTime(mostRecent) : c.dim("—")}`,
      `${c.bold("bucket dir")}   ${dir}`,
      `${c.bold("created")}      ${formatTime(meta.createdAt)}`,
      `${c.bold("last write")}   ${formatTime(meta.lastWriteAt)}`,
      "",
    ].join("\n"),
  );
}

// ---------- main ----------

async function main(): Promise<number> {
  const argv = parseArgv(process.argv.slice(2));

  if (argv.flags.help === true || argv.command === undefined || argv.command === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  const dir = getDir(argv.flags);
  const tags = argv.multi.tag ?? [];
  const requireBucket = argv.command !== "init";
  if (requireBucket && !(await dirExists(dir))) {
    process.stderr.write(
      `${c.red("error:")} no bucket at ${dir}. Run \`notes init${argv.flags.dir ? ` --dir ${dir}` : ""}\` first.\n`,
    );
    return 1;
  }

  switch (argv.command) {
    case "init":
      await cmdInit(dir);
      return 0;
    case "add": {
      const title = argv.positional[0];
      if (!title) throw new Error("usage: notes add <title>");
      await cmdAdd(dir, title, argv.flags, tags);
      return 0;
    }
    case "list":
      await cmdList(dir, argv.flags);
      return 0;
    case "show": {
      const id = argv.positional[0];
      if (!id) throw new Error("usage: notes show <id>");
      await cmdShow(dir, id);
      return 0;
    }
    case "edit": {
      const id = argv.positional[0];
      if (!id) throw new Error("usage: notes edit <id> --title ... --body ...");
      await cmdEdit(dir, id, argv.flags);
      return 0;
    }
    case "rm": {
      const id = argv.positional[0];
      if (!id) throw new Error("usage: notes rm <id> [-f]");
      await cmdRm(dir, id, argv.flags);
      return 0;
    }
    case "find": {
      const query = argv.positional[0];
      if (!query) throw new Error("usage: notes find <query>");
      await cmdFind(dir, query);
      return 0;
    }
    case "stats":
      await cmdStats(dir);
      return 0;
    default:
      process.stderr.write(`unknown command: ${argv.command}\n\n${HELP}`);
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof ValidationError) {
      process.stderr.write(`${c.red("validation error:")} ${err.message}\n`);
      const issues = err.issues as Array<{ path?: unknown[]; message?: string }>;
      if (Array.isArray(issues)) {
        for (const issue of issues) {
          const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
          process.stderr.write(`  ${path ? `${path}: ` : ""}${issue.message ?? ""}\n`);
        }
      }
    } else if (err instanceof NotFoundError) {
      process.stderr.write(`${c.red("not found:")} ${err.message}\n`);
    } else {
      process.stderr.write(
        `${c.red("error:")} ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    process.exit(1);
  },
);
