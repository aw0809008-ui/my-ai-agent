import { z } from "zod";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { errResponse, apiError } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

async function owned(userId: string, id: string) {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const u = await requireUser();
    const { id } = await params;
    const c = await owned(u.id, id);
    if (!c) return apiError(404, "NOT_FOUND", "Conversation not found.");
    return Response.json({
      id: c.id,
      title: c.title,
      pinned: c.pinned,
      archived: c.archived,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    });
  } catch (e) {
    return errResponse(e);
  }
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const u = await requireUser();
    const { id } = await params;
    const body = patchSchema.parse(await req.json());
    const c = await owned(u.id, id);
    if (!c) return apiError(404, "NOT_FOUND", "Conversation not found.");
    await db
      .update(conversations)
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
        ...(body.archived !== undefined ? { archived: body.archived } : {}),
      })
      .where(eq(conversations.id, id));
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
    const c = await owned(u.id, id);
    if (!c) return apiError(404, "NOT_FOUND", "Conversation not found.");
    await db.delete(conversations).where(eq(conversations.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
