/**
 * Mongo-flavored filter evaluation.
 *
 * Supports: equality on values, plus operators
 *   $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $exists, $regex
 * Plus logical: $and, $or
 *
 * Filters are evaluated against a document's data field. Top-level keys in
 * the filter map to fields of the data object; nested $and/$or compose.
 */

import type { Filter, FilterOperator } from "../types.js";

export function applyFilter<T extends Record<string, unknown>>(
  data: T,
  filter: Filter<T>,
): boolean {
  for (const key of Object.keys(filter) as (keyof Filter<T>)[]) {
    if (key === "$and") {
      const branches = filter.$and as Filter<T>[] | undefined;
      if (!branches) continue;
      if (!branches.every((b) => applyFilter(data, b))) return false;
      continue;
    }
    if (key === "$or") {
      const branches = filter.$or as Filter<T>[] | undefined;
      if (!branches) continue;
      if (!branches.some((b) => applyFilter(data, b))) return false;
      continue;
    }
    const condition = filter[key];
    const value = (data as Record<string, unknown>)[key as string];
    if (!matches(value, condition)) return false;
  }
  return true;
}

function matches(value: unknown, condition: unknown): boolean {
  if (isFilterOperator(condition)) {
    return matchesOperator(value, condition);
  }
  return deepEqual(value, condition);
}

function matchesOperator<V>(value: unknown, op: FilterOperator<V>): boolean {
  if ("$eq" in op && !deepEqual(value, op.$eq)) return false;
  if ("$ne" in op && deepEqual(value, op.$ne)) return false;
  if ("$gt" in op) {
    if (!isComparable(value) || !isComparable(op.$gt)) return false;
    if (!(value > op.$gt)) return false;
  }
  if ("$gte" in op) {
    if (!isComparable(value) || !isComparable(op.$gte)) return false;
    if (!(value >= op.$gte)) return false;
  }
  if ("$lt" in op) {
    if (!isComparable(value) || !isComparable(op.$lt)) return false;
    if (!(value < op.$lt)) return false;
  }
  if ("$lte" in op) {
    if (!isComparable(value) || !isComparable(op.$lte)) return false;
    if (!(value <= op.$lte)) return false;
  }
  if ("$in" in op) {
    const list = op.$in as unknown[] | undefined;
    if (!Array.isArray(list)) return false;
    if (!list.some((candidate) => deepEqual(value, candidate))) return false;
  }
  if ("$nin" in op) {
    const list = op.$nin as unknown[] | undefined;
    if (!Array.isArray(list)) return true;
    if (list.some((candidate) => deepEqual(value, candidate))) return false;
  }
  if ("$exists" in op) {
    const wantsExists = op.$exists === true;
    const isPresent = value !== undefined;
    if (wantsExists !== isPresent) return false;
  }
  if ("$regex" in op) {
    if (typeof value !== "string" || typeof op.$regex !== "string") return false;
    if (!new RegExp(op.$regex).test(value)) return false;
  }
  return true;
}

function isFilterOperator(value: unknown): value is FilterOperator<unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  return keys.every((k) => k.startsWith("$"));
}

function isComparable(value: unknown): value is number | string {
  return typeof value === "number" || typeof value === "string";
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as Record<string, unknown>).sort();
    const bKeys = Object.keys(b as Record<string, unknown>).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      if (aKeys[i] !== bKeys[i]) return false;
      const key = aKeys[i] as string;
      if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}
