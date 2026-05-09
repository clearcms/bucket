/**
 * Schema + collection wiring for the notes CLI.
 *
 * One collection: `notes`. Each note has a title, body, and tags.
 * Bucket assigns id, createdAt, updatedAt automatically.
 */

import { createBucket } from "@clearcms/bucket";
import { fsAdapter } from "@clearcms/bucket/adapters/fs";
import { z } from "zod";

// Collection type. Body and tags are required (no `.default()`) so the
// shape matches Bucket's `Filter<T>` and `Partial<T>` constraints cleanly.
// The CLI fills sensible defaults itself before insert.
export const NoteSchema = z.object({
  title: z.string().min(1, "title cannot be empty").max(200),
  body: z.string(),
  tags: z.array(z.string()),
});

export type Note = z.infer<typeof NoteSchema>;

export async function openNotes(dir: string) {
  const bucket = await createBucket({
    adapter: fsAdapter({ root: dir }),
  });
  const notes = bucket.collection<Note>("notes", { schema: NoteSchema });
  return { bucket, notes };
}
