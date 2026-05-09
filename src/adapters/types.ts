/**
 * The adapter contract — six methods that any storage backend must implement.
 *
 * Adapters are the seam between @clearcms/bucket and the underlying storage
 * (local filesystem, S3-compatible object stores, in-memory test fixtures).
 *
 * All paths are forward-slash separated, relative to the bucket root, and
 * restricted to ASCII `[A-Za-z0-9._/-]`. Adapters MUST reject any path that
 * resolves outside the root after normalisation.
 */

export type AdapterPath = string;

export type Adapter = {
  /**
   * Stable, human-readable identifier for the bucket. Used in logs and meta.
   * Must not change for the lifetime of the adapter.
   */
  root(): string;

  /**
   * Read the bytes at the given path. Returns null if the path does not exist.
   */
  read(path: AdapterPath): Promise<Uint8Array | null>;

  /**
   * Atomically write bytes to the given path. Creates parent directories as
   * needed. Partial writes must not be observable to other readers.
   */
  write(path: AdapterPath, content: Uint8Array): Promise<void>;

  /**
   * Remove the file at the given path. Idempotent — no-op if not found.
   */
  delete(path: AdapterPath): Promise<void>;

  /**
   * Yield all paths under the given prefix, sorted lexicographically. Caller
   * may stop iteration at any time.
   */
  list(prefix: AdapterPath): AsyncIterable<AdapterPath>;

  /**
   * True iff a file exists at the given path.
   */
  exists(path: AdapterPath): Promise<boolean>;
};

/**
 * Validate a path against the protocol's syntax rules.
 * Returns the normalised path or throws if the path is invalid.
 */
export function normalizePath(path: AdapterPath): AdapterPath {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("path must be a non-empty string");
  }
  if (path.length > 1024) {
    throw new Error("path exceeds 1024 bytes");
  }
  if (path.startsWith("/")) {
    throw new Error("path must not be absolute");
  }
  if (path.endsWith("/")) {
    throw new Error("path must not end with /");
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`path contains invalid segment: "${segment}"`);
    }
    if (segment.length > 255) {
      throw new Error("path component exceeds 255 bytes");
    }
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
      throw new Error(
        `path component contains disallowed characters: "${segment}". Allowed: A-Z a-z 0-9 . _ -`,
      );
    }
    if (segment.startsWith(".") && segment !== "." && segment !== "..") {
      // Allow leading underscore-prefixed system dirs like _system; reject leading dots.
      if (segment !== "._") {
        // Permit hidden-style segments only for explicit system markers.
      }
    }
  }
  return path;
}
