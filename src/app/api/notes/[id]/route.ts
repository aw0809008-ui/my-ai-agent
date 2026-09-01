import { z } from "zod";
import { db } from "@/db";
import { notes } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { errResponse, apiError } from "@/lib/http";
import { generateEmbedding } from "@/lib/ai-gateway";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(50_000).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const u = await requireUser();
    const { id } = await params;
    const body = patchSchema.parse(await req.json());
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) set.title = body.title;
    if (body.content !== undefined) set.content = body.content;
    if (body.title !== undefined || body.content !== undefined) {
      const [cur] = await db
        .select({ title: notes.title, content: notes.content })
        .from(notes)
        .where(and(eq(notes.id, id), eq(notes.userId, u.id)))
        .limit(1);
      if (!cur) return apiError(404, "NOT_FOUND", "Note not found.");
      set.embedding = await generateEmbedding(
        `${body.title ?? cur.title}\n${body.content ?? cur.content}`
      );
    }
    if (body.pinned !== undefined) set.pinned = body.pinned;
    if (body.archived !== undefined) set.archived = body.archived;
    const upd = await db
      .update(notes)
      .set(set)
      .where(and(eq(notes.id, id), eq(notes.userId, u.id)))
      .returning({ id: notes.id });
    if (!upd.length) return apiError(404, "NOT_FOUND", "Note not found.");
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return apiError(400, "VALIDATION", "Invalid input.");
    return errResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const u = await requireUser();
    const { id } = await params;
    const del = await db
      .delete(notes)
      .where(and(eq(notes.id, id), eq(notes.userId, u.id)))
      .returning({ id: notes.id });
    if (!del.length) return apiError(404, "NOT_FOUND", "Note not found.");
    return Response.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
