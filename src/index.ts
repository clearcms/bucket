/**
 * @clearcms/bucket — public exports.
 */

export { Bucket, createBucket } from "./bucket.js";
export type { BucketOptions, SchemaType } from "./bucket.js";
export { Collection } from "./collection.js";
export type { CollectionOptions } from "./collection.js";
export type { Adapter, AdapterPath } from "./adapters/types.js";
export { normalizePath } from "./adapters/types.js";
export {
  BucketError,
  ValidationError,
  NotFoundError,
} from "./types.js";
export type {
  Document,
  Filter,
  FilterOperator,
  FindOptions,
  BucketMeta,
} from "./types.js";
