import { z } from "zod";
import { db } from "@/db";
import { notes } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { errResponse, apiError } from "@/lib/http";
import { generateEmbedding } from "@/lib/ai-gateway";
import { lexicalEmbedding, cosine } from "@/lib/embeddings";

export const dynamic = "force-dynamic";

// GET /api/notes?query=&archived=true — semantic ranking when query present.
export async function GET(req: Request) {
  try {
    const u = await requireUser();
    const url = new URL(req.url);
    const query = url.searchParams.get("query")?.trim() ?? "";
    const archived = url.searchParams.get("archived") === "true";

    const rows = await db
      .select()
      .from(notes)
      .where(and(eq(notes.userId, u.id), eq(notes.archived, archived)))
      .orderBy(desc(notes.pinned), desc(notes.updatedAt))
      .limit(300);

    let items = rows.map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      pinned: n.pinned,
      archived: n.archived,
      score: null as number | null,
      updatedAt: n.updatedAt.toISOString(),
      createdAt: n.createdAt.toISOString(),
    }));

    if (query) {
      const q = lexicalEmbedding(query);
      items = items
        .map((n, i) => ({
          ...n,
          score: rows[i].embedding ? cosine(q, rows[i].embedding!) : 0,
        }))
        .filter(
          (n) =>
            n.score > 0.08 ||
            n.title.toLowerCase().includes(query.toLowerCase()) ||
            n.content.toLowerCase().includes(query.toLowerCase())
        )
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }

    return Response.json({ items });
  } catch (e) {
    return errResponse(e);
  }
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(50_000).optional(),
});

export async function POST(req: Request) {
  try {
    const u = await requireUser();
    const body = createSchema.parse(await req.json());
    const embedding = await generateEmbedding(`${body.title}\n${body.content ?? ""}`);
    const [n] = await db
      .insert(notes)
      .values({ userId: u.id, title: body.title, content: body.content ?? "", embedding })
      .returning();
    return Response.json({
      id: n.id,
      title: n.title,
      content: n.content,
      pinned: n.pinned,
      createdAt: n.createdAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof z.ZodError)
      return apiError(400, "VALIDATION", e.issues.map((i) => i.message).join(", "));
    return errResponse(e);
  }
}
