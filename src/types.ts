/**
 * Public types for @clearcms/bucket.
 *
 * A Document is the unit of data: an id, a data payload, and timestamps.
 * A Collection is a named group of similarly-shaped documents.
 * A Bucket is the top-level handle that holds an adapter and exposes collections.
 */

export type Document<T> = {
  readonly id: string;
  readonly data: T;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type Filter<T> = {
  [K in keyof T]?: T[K] | FilterOperator<T[K]>;
} & {
  $and?: Filter<T>[];
  $or?: Filter<T>[];
};

export type FilterOperator<V> = {
  $eq?: V;
  $ne?: V;
  $gt?: V;
  $gte?: V;
  $lt?: V;
  $lte?: V;
  $in?: V[];
  $nin?: V[];
  $exists?: boolean;
  $regex?: string;
};

export type FindOptions<T> = {
  filter?: Filter<T>;
  limit?: number;
  skip?: number;
  sort?: { [K in keyof T]?: 1 | -1 } & { createdAt?: 1 | -1; updatedAt?: 1 | -1 };
};

export type BucketMeta = {
  readonly version: string;
  readonly createdAt: string;
  readonly lastWriteAt: string;
};

export class BucketError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "BucketError";
  }
}

export class ValidationError extends BucketError {
  constructor(
    message: string,
    public readonly issues: unknown,
  ) {
    super(message, "VALIDATION_FAILED");
    this.name = "ValidationError";
  }
}

export class NotFoundError extends BucketError {
  constructor(message: string) {
    super(message, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}
