import { z } from "zod";
import { db } from "@/db";
import { memories } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { errResponse, apiError } from "@/lib/http";
import { generateEmbedding } from "@/lib/ai-gateway";

type Params = { params: Promise<{ id: string }> };

const CATS = ["personal", "preferences", "work", "projects", "important", "temporary"] as const;

const patchSchema = z.object({
  content: z.string().trim().min(2).max(1000).optional(),
  category: z.enum(CATS).optional(),
  importance: z.number().int().min(1).max(5).optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const u = await requireUser();
    const { id } = await params;
    const body = patchSchema.parse(await req.json());
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.content !== undefined) {
      set.content = body.content;
      set.embedding = await generateEmbedding(body.content);
    }
    if (body.category !== undefined) set.category = body.category;
    if (body.importance !== undefined) set.importance = body.importance;
    const upd = await db
      .update(memories)
      .set(set)
      .where(and(eq(memories.id, id), eq(memories.userId, u.id)))
      .returning({ id: memories.id });
    if (!upd.length) return apiError(404, "NOT_FOUND", "Memory not found.");
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
      .delete(memories)
      .where(and(eq(memories.id, id), eq(memories.userId, u.id)))
      .returning({ id: memories.id });
    if (!del.length) return apiError(404, "NOT_FOUND", "Memory not found.");
    return Response.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
