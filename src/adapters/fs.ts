/**
 * Filesystem adapter — for Node and Bun.
 *
 * Writes are atomic via temp-file-rename. Reads use `lstat` to reject symlinks
 * (which would otherwise allow exfiltration of files outside the bucket root).
 * Lists use `readdir` recursively, sorted lexicographically.
 */

import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { type Adapter, type AdapterPath, normalizePath } from "./types.js";

export type FsAdapterOptions = {
  /** Absolute or relative path to the bucket root directory on disk. */
  root: string;
};

export function fsAdapter(options: FsAdapterOptions): Adapter {
  const rootAbsolute = resolve(options.root);

  async function ensureRoot(): Promise<void> {
    await fs.mkdir(rootAbsolute, { recursive: true });
  }

  function resolveInside(path: AdapterPath): string {
    const normalised = normalizePath(path);
    // Convert protocol-style forward slashes to platform separator.
    const platformPath = normalised.split("/").join(sep);
    const full = resolve(rootAbsolute, platformPath);
    if (full !== rootAbsolute && !full.startsWith(rootAbsolute + sep)) {
      throw new Error(`path resolves outside bucket root: ${path}`);
    }
    return full;
  }

  async function rejectIfSymlink(full: string): Promise<void> {
    try {
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) {
        throw new Error(`refusing to follow symlink: ${full}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  return {
    root() {
      return rootAbsolute;
    },

    async read(path: AdapterPath): Promise<Uint8Array | null> {
      await ensureRoot();
      const full = resolveInside(path);
      await rejectIfSymlink(full);
      try {
        const buf = await fs.readFile(full);
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },

    async write(path: AdapterPath, content: Uint8Array): Promise<void> {
      await ensureRoot();
      const full = resolveInside(path);
      await rejectIfSymlink(full);
      const dir = dirname(full);
      await fs.mkdir(dir, { recursive: true });
      const tempName = `.tmp-${randomBytes(8).toString("hex")}`;
      const tempPath = join(dir, tempName);
      try {
        await fs.writeFile(tempPath, Buffer.from(content));
        // fsync the file before rename to ensure durability.
        const handle = await fs.open(tempPath, "r+");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(tempPath, full);
        // fsync the parent directory so the rename is durable on Linux.
        try {
          const dirHandle = await fs.open(dir, "r");
          try {
            await dirHandle.sync();
          } finally {
            await dirHandle.close();
          }
        } catch {
          // Some platforms (Windows) cannot fsync a directory; ignore.
        }
      } catch (error) {
        try {
          await fs.unlink(tempPath);
        } catch {
          // Cleanup best-effort.
        }
        throw error;
      }
    },

    async delete(path: AdapterPath): Promise<void> {
      const full = resolveInside(path);
      try {
        await fs.unlink(full);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
    },

    async *list(prefix: AdapterPath): AsyncIterable<AdapterPath> {
      await ensureRoot();
      const start = prefix === "" ? rootAbsolute : resolveInside(prefix);
      const collected: string[] = [];
      async function walk(dir: string): Promise<void> {
        let entries: import("node:fs").Dirent[];
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
          throw error;
        }
        // Sort entries by name for deterministic order.
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of entries) {
          if (entry.name.startsWith(".tmp-")) continue;
          const childAbsolute = join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(childAbsolute);
          } else if (entry.isFile()) {
            const relative = childAbsolute
              .slice(rootAbsolute.length + 1)
              .split(sep)
              .join("/");
            collected.push(relative);
          }
          // Symlinks and other entry kinds are skipped.
        }
      }
      try {
        const stat = await fs.stat(start);
        if (stat.isFile()) {
          const relative = start
            .slice(rootAbsolute.length + 1)
            .split(sep)
            .join("/");
          yield relative;
          return;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      }
      await walk(start);
      collected.sort();
      for (const path of collected) {
        yield path;
      }
    },

    async exists(path: AdapterPath): Promise<boolean> {
      const full = resolveInside(path);
      try {
        const stat = await fs.lstat(full);
        return stat.isFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
  };
}
