/**
 * Schema + collection wiring for the notes CLI.
 *
 * One collection: `notes`. Each note has a title, body, and tags.
 * Bucket assigns id, createdAt, updatedAt automatically.
 */

import { createBucket } from "@clearcms/bucket";
import { fsAdapter } from "@clearcms/bucket/adapters/fs";
import { z } from "zod";

export const NoteSchema = z.object({
  title: z.string().min(1, "title cannot be empty").max(200),
  body: z.string().default(""),
  tags: z.array(z.string()).default([]),
});

export type Note = z.infer<typeof NoteSchema>;

export async function openNotes(dir: string) {
  const bucket = await createBucket({
    adapter: fsAdapter({ root: dir }),
  });
  const notes = bucket.collection<Note>("notes", { schema: NoteSchema });
  return { bucket, notes };
}
