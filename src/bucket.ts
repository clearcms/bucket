/**
 * A Bucket is the top-level handle. It holds an Adapter, manages bucket-level
 * metadata, and creates Collections.
 */

import type { z } from "zod";
import type { Adapter } from "./adapters/types.js";
import { Collection, type CollectionOptions } from "./collection.js";
import type { BucketMeta } from "./types.js";

const META_PATH = "_system/meta.json";
const PROTOCOL_VERSION = "0.1";
const decoder = new TextDecoder();
const encoder = new TextEncoder();

export type BucketOptions = {
  adapter: Adapter;
};

export class Bucket {
  private constructor(
    private readonly adapter: Adapter,
    private readonly collections: Map<string, Collection<Record<string, unknown>>>,
  ) {}

  static async open(options: BucketOptions): Promise<Bucket> {
    const meta = await readMeta(options.adapter);
    if (meta === null) {
      const now = new Date().toISOString();
      const fresh: BucketMeta = {
        version: PROTOCOL_VERSION,
        createdAt: now,
        lastWriteAt: now,
      };
      await writeMeta(options.adapter, fresh);
    } else if (meta.version !== PROTOCOL_VERSION) {
      const major = Number.parseInt(meta.version.split(".")[0] ?? "0", 10);
      const ours = Number.parseInt(PROTOCOL_VERSION.split(".")[0] ?? "0", 10);
      if (major > ours) {
        throw new Error(
          `bucket is at protocol version ${meta.version}; this library supports up to ${PROTOCOL_VERSION}. Upgrade @clearcms/bucket.`,
        );
      }
    }
    return new Bucket(options.adapter, new Map());
  }

  collection<T extends Record<string, unknown>>(
    name: string,
    options: CollectionOptions<T>,
  ): Collection<T> {
    const cached = this.collections.get(name);
    if (cached) {
      return cached as Collection<T>;
    }
    const created = new Collection<T>(this.adapter, name, options, () => this.touchMeta());
    this.collections.set(name, created as unknown as Collection<Record<string, unknown>>);
    return created;
  }

  async meta(): Promise<BucketMeta> {
    const meta = await readMeta(this.adapter);
    if (meta === null) {
      throw new Error("bucket meta not found — bucket may have been deleted externally");
    }
    return meta;
  }

  /** Lower-level escape hatch: get the underlying adapter. */
  rawAdapter(): Adapter {
    return this.adapter;
  }

  private async touchMeta(): Promise<void> {
    const existing = (await readMeta(this.adapter)) ?? {
      version: PROTOCOL_VERSION,
      createdAt: new Date().toISOString(),
      lastWriteAt: new Date().toISOString(),
    };
    await writeMeta(this.adapter, {
      ...existing,
      lastWriteAt: new Date().toISOString(),
    });
  }
}

async function readMeta(adapter: Adapter): Promise<BucketMeta | null> {
  const bytes = await adapter.read(META_PATH);
  if (bytes === null) return null;
  try {
    const parsed = JSON.parse(decoder.decode(bytes));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.version === "string" &&
      typeof parsed.createdAt === "string" &&
      typeof parsed.lastWriteAt === "string"
    ) {
      return parsed as BucketMeta;
    }
    throw new Error("invalid meta shape");
  } catch (error) {
    throw new Error(`bucket meta is corrupt: ${(error as Error).message}`);
  }
}

async function writeMeta(adapter: Adapter, meta: BucketMeta): Promise<void> {
  const bytes = encoder.encode(`${JSON.stringify(meta, null, 2)}\n`);
  await adapter.write(META_PATH, bytes);
}

/** Convenience wrapper for the common case. */
export async function createBucket(options: BucketOptions): Promise<Bucket> {
  return Bucket.open(options);
}

/** Reusable Zod-aware schema type re-export so callers needn't import zod themselves. */
export type SchemaType<T> = z.ZodType<T>;
