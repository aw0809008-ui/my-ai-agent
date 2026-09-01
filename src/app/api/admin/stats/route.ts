import { db } from "@/db";
import {
  users,
  conversations,
  messages,
  memories,
  notes,
  reminders,
  files,
  toolCalls,
  usageEvents,
} from "@/db/schema";
import { desc, eq, gte, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { errResponse } from "@/lib/http";
import { aiHealth } from "@/lib/ai-gateway";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const since = new Date(Date.now() - 24 * 3600_000);
    const count = async (table: any, extra?: any) => {
      const q = extra
        ? db.select({ c: sql<number>`count(*)::int` }).from(table).where(extra)
        : db.select({ c: sql<number>`count(*)::int` }).from(table);
      const [r] = await q;
      return r.c;
    };
    const [storage] = await db
      .select({ total: sql<number>`coalesce(sum(size),0)::int` })
      .from(files);
    const toolErrs = await count(toolCalls, eq(toolCalls.status, "error"));
    const toolOk = await count(toolCalls, eq(toolCalls.status, "ok"));
    const recentErrors = await db
      .select({
        tool: toolCalls.tool,
        error: toolCalls.error,
        createdAt: toolCalls.createdAt,
      })
      .from(toolCalls)
      .where(eq(toolCalls.status, "error"))
      .orderBy(desc(toolCalls.createdAt))
      .limit(5);
    const ai = await aiHealth();

    return Response.json({
      totals: {
        users: await count(users),
        activeUsers24h: (
          await db
            .select({ c: sql<number>`count(distinct ${usageEvents.userId})::int` })
            .from(usageEvents)
            .where(gte(usageEvents.createdAt, since))
        )[0].c,
        conversations: await count(conversations),
        messages: await count(messages),
        memories: await count(memories),
        notes: await count(notes),
        reminders: await count(reminders),
        aiRequests24h: await count(
          usageEvents,
          gte(usageEvents.createdAt, since)
        ),
        toolCallsOk: toolOk,
        toolCallsError: toolErrs,
        storageBytes: storage.total,
      },
      ai,
      recentErrors: recentErrors.map((e) => ({
        tool: e.tool,
        error: e.error ?? "",
        at: e.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return errResponse(e);
  }
}
