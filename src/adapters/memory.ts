/**
 * In-memory adapter — for tests and ephemeral use.
 *
 * Stores everything in a Map; writes are atomic by nature (single key write).
 * Useful as the conformance-suite fixture and for tests that should not touch
 * a real filesystem.
 */

import { type Adapter, type AdapterPath, normalizePath } from "./types.js";

export type MemoryAdapterOptions = {
  /** Optional label for logs/meta. Defaults to "memory://". */
  root?: string;
};

export function memoryAdapter(options: MemoryAdapterOptions = {}): Adapter {
  const store = new Map<string, Uint8Array>();
  const rootLabel = options.root ?? "memory://";

  return {
    root() {
      return rootLabel;
    },

    async read(path: AdapterPath): Promise<Uint8Array | null> {
      const key = normalizePath(path);
      const value = store.get(key);
      if (value === undefined) return null;
      // Return a copy so callers cannot mutate stored bytes.
      return new Uint8Array(value);
    },

    async write(path: AdapterPath, content: Uint8Array): Promise<void> {
      const key = normalizePath(path);
      // Copy so subsequent caller mutations do not affect stored value.
      store.set(key, new Uint8Array(content));
    },

    async delete(path: AdapterPath): Promise<void> {
      const key = normalizePath(path);
      store.delete(key);
    },

    async *list(prefix: AdapterPath): AsyncIterable<AdapterPath> {
      const normalisedPrefix = prefix === "" ? "" : normalizePath(prefix);
      const matches: string[] = [];
      for (const key of store.keys()) {
        if (
          normalisedPrefix === "" ||
          key === normalisedPrefix ||
          key.startsWith(`${normalisedPrefix}/`)
        ) {
          matches.push(key);
        }
      }
      matches.sort();
      for (const key of matches) {
        yield key;
      }
    },

    async exists(path: AdapterPath): Promise<boolean> {
      const key = normalizePath(path);
      return store.has(key);
    },
  };
}
