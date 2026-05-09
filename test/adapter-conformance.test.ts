import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fsAdapter } from "../src/adapters/fs.js";
import { memoryAdapter } from "../src/adapters/memory.js";
import type { Adapter } from "../src/adapters/types.js";

type AdapterFactory = {
  name: string;
  create: () => Promise<{ adapter: Adapter; cleanup: () => Promise<void> }>;
};

const factories: AdapterFactory[] = [
  {
    name: "memory",
    create: async () => ({ adapter: memoryAdapter(), cleanup: async () => {} }),
  },
  {
    name: "fs",
    create: async () => {
      const dir = await mkdtemp(join(tmpdir(), "bucket-fs-test-"));
      return {
        adapter: fsAdapter({ root: dir }),
        cleanup: async () => {
          await rm(dir, { recursive: true, force: true });
        },
      };
    },
  },
];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

for (const factory of factories) {
  describe(`adapter conformance: ${factory.name}`, () => {
    let adapter: Adapter;
    let cleanup: () => Promise<void>;

    beforeAll(async () => {
      const made = await factory.create();
      adapter = made.adapter;
      cleanup = made.cleanup;
    });

    afterAll(async () => {
      await cleanup();
    });

    it("read returns null for missing path", async () => {
      const got = await adapter.read("missing/key.json");
      expect(got).toBeNull();
    });

    it("write then read round-trips bytes", async () => {
      await adapter.write("a/b/c.json", encoder.encode("hello"));
      const got = await adapter.read("a/b/c.json");
      expect(got).not.toBeNull();
      expect(decoder.decode(got as Uint8Array)).toBe("hello");
    });

    it("exists is true after write, false after delete", async () => {
      await adapter.write("ex/test.json", encoder.encode("{}"));
      expect(await adapter.exists("ex/test.json")).toBe(true);
      await adapter.delete("ex/test.json");
      expect(await adapter.exists("ex/test.json")).toBe(false);
    });

    it("delete is idempotent", async () => {
      await adapter.delete("never/existed.json");
      await adapter.delete("never/existed.json");
    });

    it("list yields paths sorted lexicographically", async () => {
      await adapter.write("ls/c.json", encoder.encode("c"));
      await adapter.write("ls/a.json", encoder.encode("a"));
      await adapter.write("ls/b.json", encoder.encode("b"));
      const out: string[] = [];
      for await (const p of adapter.list("ls")) out.push(p);
      expect(out).toEqual(["ls/a.json", "ls/b.json", "ls/c.json"]);
    });

    it("list filters by prefix", async () => {
      await adapter.write("p1/x.json", encoder.encode("1"));
      await adapter.write("p2/x.json", encoder.encode("2"));
      const out: string[] = [];
      for await (const p of adapter.list("p1")) out.push(p);
      expect(out).toEqual(["p1/x.json"]);
    });

    it("rejects path traversal attempts", async () => {
      await expect(adapter.read("../escape.json")).rejects.toThrow();
      await expect(adapter.write("a/../../escape.json", encoder.encode(""))).rejects.toThrow();
      await expect(adapter.read("/abs/path.json")).rejects.toThrow();
      await expect(adapter.read("")).rejects.toThrow();
    });

    it("rejects disallowed characters", async () => {
      await expect(adapter.read("file:colon.json")).rejects.toThrow();
      await expect(adapter.read("with spaces.json")).rejects.toThrow();
      await expect(adapter.read("CON.json")).resolves.toBeNull();
      // CON is reserved on Windows but we don't enforce that today; permitted on Linux.
    });

    it("read returns a copy that does not mutate stored bytes", async () => {
      await adapter.write("copy/test.json", encoder.encode("original"));
      const first = (await adapter.read("copy/test.json")) as Uint8Array;
      first[0] = 0x00;
      const second = (await adapter.read("copy/test.json")) as Uint8Array;
      expect(decoder.decode(second)).toBe("original");
    });
  });
}
