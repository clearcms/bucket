import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/adapters/fs.ts",
    "src/adapters/memory.ts",
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
  platform: "neutral",
  external: ["node:fs", "node:fs/promises", "node:path", "node:crypto"],
});
