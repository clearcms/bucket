/**
 * A Collection is a named group of similarly-shaped documents.
 *
 * Documents are stored as one JSON file per record under
 * `collections/<name>/<id>.json`. Each document carries an immutable id, a
 * data payload validated against the collection's schema, and createdAt /
 * updatedAt timestamps.
 */

import { ulid } from "ulid";
import type { z } from "zod";
import type { Adapter } from "./adapters/types.js";
import { applyFilter } from "./query/filter.js";
import {
  type Document,
  type Filter,
  type FindOptions,
  NotFoundError,
  ValidationError,
} from "./types.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export type CollectionOptions<T extends Record<string, unknown>> = {
  schema: z.ZodType<T>;
};

export class Collection<T extends Record<string, unknown>> {
  constructor(
    private readonly adapter: Adapter,
    public readonly name: string,
    private readonly options: CollectionOptions<T>,
    private readonly touchMeta: () => Promise<void>,
  ) {
    if (!/^[a-z][a-z0-9_-]{0,62}$/.test(name)) {
      throw new Error(`collection name must match /^[a-z][a-z0-9_-]{0,62}$/, got "${name}"`);
    }
  }

  private pathFor(id: string): string {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw new Error(`document id "${id}" contains disallowed characters`);
    }
    return `collections/${this.name}/${id}.json`;
  }

  private async readDocument(id: string): Promise<Document<T> | null> {
    const bytes = await this.adapter.read(this.pathFor(id));
    if (bytes === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoder.decode(bytes));
    } catch {
      throw new Error(`document "${this.name}/${id}" is not valid JSON`);
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { id?: unknown }).id !== "string" ||
      typeof (parsed as { createdAt?: unknown }).createdAt !== "string" ||
      typeof (parsed as { updatedAt?: unknown }).updatedAt !== "string"
    ) {
      throw new Error(`document "${this.name}/${id}" missing required envelope fields`);
    }
    const envelope = parsed as { id: string; data: unknown; createdAt: string; updatedAt: string };
    const validated = this.validate(envelope.data);
    return {
      id: envelope.id,
      data: validated,
      createdAt: envelope.createdAt,
      updatedAt: envelope.updatedAt,
    };
  }

  private validate(input: unknown): T {
    const result = this.options.schema.safeParse(input);
    if (!result.success) {
      throw new ValidationError(`validation failed for "${this.name}"`, result.error.issues);
    }
    return result.data;
  }

  private async writeDocument(doc: Document<T>): Promise<void> {
    const json = JSON.stringify(doc, null, 2);
    await this.adapter.write(this.pathFor(doc.id), encoder.encode(json));
    await this.touchMeta();
  }

  async insert(data: T, options: { id?: string } = {}): Promise<Document<T>> {
    const id = options.id ?? ulid();
    if (await this.adapter.exists(this.pathFor(id))) {
      throw new Error(`document "${this.name}/${id}" already exists`);
    }
    const validated = this.validate(data);
    const now = new Date().toISOString();
    const doc: Document<T> = {
      id,
      data: validated,
      createdAt: now,
      updatedAt: now,
    };
    await this.writeDocument(doc);
    return doc;
  }

  async findById(id: string): Promise<Document<T> | null> {
    return this.readDocument(id);
  }

  async getById(id: string): Promise<Document<T>> {
    const doc = await this.readDocument(id);
    if (doc === null) {
      throw new NotFoundError(`document "${this.name}/${id}" not found`);
    }
    return doc;
  }

  async update(id: string, partial: Partial<T>): Promise<Document<T>> {
    const existing = await this.getById(id);
    const merged = { ...existing.data, ...partial } as T;
    const validated = this.validate(merged);
    const now = new Date().toISOString();
    const next: Document<T> = {
      id: existing.id,
      data: validated,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
    await this.writeDocument(next);
    return next;
  }

  async replace(id: string, data: T): Promise<Document<T>> {
    const existing = await this.getById(id);
    const validated = this.validate(data);
    const now = new Date().toISOString();
    const next: Document<T> = {
      id: existing.id,
      data: validated,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
    await this.writeDocument(next);
    return next;
  }

  async delete(id: string): Promise<void> {
    await this.adapter.delete(this.pathFor(id));
    await this.touchMeta();
  }

  async *list(): AsyncIterable<Document<T>> {
    const prefix = `collections/${this.name}`;
    for await (const path of this.adapter.list(prefix)) {
      if (!path.endsWith(".json")) continue;
      const id = path.slice(prefix.length + 1).replace(/\.json$/, "");
      const doc = await this.readDocument(id);
      if (doc !== null) yield doc;
    }
  }

  async find(
    filter: Filter<T> = {} as Filter<T>,
    options: FindOptions<T> = {},
  ): Promise<Document<T>[]> {
    const matches: Document<T>[] = [];
    for await (const doc of this.list()) {
      if (applyFilter(doc.data, filter)) {
        matches.push(doc);
      }
    }
    if (options.sort) {
      const sortKeys = Object.entries(options.sort) as [string, 1 | -1][];
      matches.sort((a, b) => {
        for (const [key, direction] of sortKeys) {
          const av =
            key === "createdAt" || key === "updatedAt"
              ? a[key]
              : (a.data as Record<string, unknown>)[key];
          const bv =
            key === "createdAt" || key === "updatedAt"
              ? b[key]
              : (b.data as Record<string, unknown>)[key];
          if (av === bv) continue;
          if (av === undefined) return 1;
          if (bv === undefined) return -1;
          if ((av as number | string) < (bv as number | string)) return -1 * direction;
          if ((av as number | string) > (bv as number | string)) return 1 * direction;
        }
        return 0;
      });
    }
    const skip = options.skip ?? 0;
    const limit = options.limit ?? matches.length;
    return matches.slice(skip, skip + limit);
  }

  async findOne(filter: Filter<T> = {} as Filter<T>): Promise<Document<T> | null> {
    const matches = await this.find(filter, { limit: 1 });
    return matches[0] ?? null;
  }

  async count(filter: Filter<T> = {} as Filter<T>): Promise<number> {
    let n = 0;
    for await (const doc of this.list()) {
      if (applyFilter(doc.data, filter)) n++;
    }
    return n;
  }
}
