import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { and, desc, eq, lt } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { errResponse, apiError } from "@/lib/http";

export const dynamic = "force-dynamic";

const PAGE = 30;

// GET /api/conversations/[id]/messages?cursor=  (paginated, newest page first)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const u = await requireUser();
    const { id } = await params;
    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, u.id)))
      .limit(1);
    if (!conv) return apiError(404, "NOT_FOUND", "Conversation not found.");

    const cursor = new URL(req.url).searchParams.get("cursor");
    const conds = [eq(messages.conversationId, id)];
    if (cursor) conds.push(lt(messages.createdAt, new Date(cursor)));

    const rows = await db
      .select()
      .from(messages)
      .where(and(...conds))
      .orderBy(desc(messages.createdAt))
      .limit(PAGE + 1);

    const hasMore = rows.length > PAGE;
    const page = rows.slice(0, PAGE).reverse(); // chronological within page
    return Response.json({
      items: page.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sources: m.sources ?? null,
        toolEvents: m.toolEvents ?? null,
        model: m.model ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? page[0].createdAt.toISOString() : null,
    });
  } catch (e) {
    return errResponse(e);
  }
}
