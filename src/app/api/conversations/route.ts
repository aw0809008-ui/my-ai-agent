import { z } from "zod";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { errResponse, apiError } from "@/lib/http";

export const dynamic = "force-dynamic";

const PAGE = 20;

// GET /api/conversations?query=&cursor=&archived=true
export async function GET(req: Request) {
  try {
    const u = await requireUser();
    const url = new URL(req.url);
    const query = url.searchParams.get("query")?.trim() ?? "";
    const cursor = url.searchParams.get("cursor");
    const archived = url.searchParams.get("archived") === "true";

    const conds = [eq(conversations.userId, u.id), eq(conversations.archived, archived)];
    if (query) conds.push(ilike(conversations.title, `%${query}%`));
    if (cursor) conds.push(lt(conversations.updatedAt, new Date(cursor)));

    const rows = await db
      .select()
      .from(conversations)
      .where(and(...conds))
      .orderBy(desc(conversations.pinned), desc(conversations.updatedAt))
      .limit(PAGE + 1);

    const hasMore = rows.length > PAGE;
    const items = rows.slice(0, PAGE);
    return Response.json({
      items: items.map((c) => ({
        id: c.id,
        title: c.title,
        pinned: c.pinned,
        archived: c.archived,
        updatedAt: c.updatedAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? items[items.length - 1].updatedAt.toISOString() : null,
    });
  } catch (e) {
    return errResponse(e);
  }
}

const createSchema = z.object({ title: z.string().trim().min(1).max(120).optional() });

export async function POST(req: Request) {
  try {
    const u = await requireUser();
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const [c] = await db
      .insert(conversations)
      .values({ userId: u.id, title: body.title ?? "New conversation" })
      .returning();
    return Response.json({ id: c.id, title: c.title });
  } catch (e) {
    if (e instanceof z.ZodError) return apiError(400, "VALIDATION", "Invalid title.");
    return errResponse(e);
  }
}
