import { z } from "zod";
import { db } from "@/db";
import { memories } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { errResponse, apiError } from "@/lib/http";
import { generateEmbedding } from "@/lib/ai-gateway";
import { lexicalEmbedding, cosine } from "@/lib/embeddings";

export const dynamic = "force-dynamic";

const CATS = ["personal", "preferences", "work", "projects", "important", "temporary"] as const;

// GET /api/memories?query=&category= — semantic ranking when query present.
export async function GET(req: Request) {
  try {
    const u = await requireUser();
    const url = new URL(req.url);
    const query = url.searchParams.get("query")?.trim() ?? "";
    const category = url.searchParams.get("category") ?? "";

    const conds = [eq(memories.userId, u.id)];
    if (category && (CATS as readonly string[]).includes(category))
      conds.push(eq(memories.category, category));

    const rows = await db
      .select()
      .from(memories)
      .where(and(...conds))
      .orderBy(desc(memories.updatedAt))
      .limit(300);

    let items = rows.map((m) => ({
      id: m.id,
      content: m.content,
      category: m.category,
      importance: m.importance,
      score: null as number | null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    }));

    if (query) {
      const q = lexicalEmbedding(query);
      items = items
        .map((m, i) => ({
          ...m,
          score: rows[i].embedding ? cosine(q, rows[i].embedding!) : 0,
        }))
        .filter((m) => m.score > 0.08 || m.content.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }

    return Response.json({ items, memoryEnabled: u.profile.memoryEnabled });
  } catch (e) {
    return errResponse(e);
  }
}

const createSchema = z.object({
  content: z.string().trim().min(2).max(1000),
  category: z.enum(CATS).optional(),
  importance: z.number().int().min(1).max(5).optional(),
});

export async function POST(req: Request) {
  try {
    const u = await requireUser();
    if (!u.profile.memoryEnabled)
      return apiError(403, "MEMORY_DISABLED", "Memory is disabled in Settings.");
    const body = createSchema.parse(await req.json());
    const embedding = await generateEmbedding(body.content);
    const [m] = await db
      .insert(memories)
      .values({
        userId: u.id,
        content: body.content,
        category: body.category ?? "personal",
        importance: body.importance ?? 3,
        embedding,
      })
      .returning();
    return Response.json({
      id: m.id,
      content: m.content,
      category: m.category,
      importance: m.importance,
      createdAt: m.createdAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof z.ZodError)
      return apiError(400, "VALIDATION", e.issues.map((i) => i.message).join(", "));
    return errResponse(e);
  }
}

// DELETE /api/memories — wipe all memories (privacy control).
export async function DELETE() {
  try {
    const u = await requireUser();
    await db.delete(memories).where(eq(memories.userId, u.id));
    return Response.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
