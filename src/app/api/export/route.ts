import { db } from "@/db";
import {
  profiles,
  userSettings,
  conversations,
  messages,
  memories,
  notes,
  reminders,
  files,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { errResponse, limited } from "@/lib/http";

export const dynamic = "force-dynamic";

// GET /api/export — full data export for the signed-in user (portability).
export async function GET() {
  try {
    const u = await requireUser();
    limited(`export:${u.id}`, 5, 60_000);

    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, u.id));
    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, u.id));
    const convos = await db.select().from(conversations).where(eq(conversations.userId, u.id));
    const msgs = convos.length
      ? await db
          .select({
            conversationId: messages.conversationId,
            role: messages.role,
            content: messages.content,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(
            inArray(
              messages.conversationId,
              convos.map((c) => c.id)
            )
          )
      : [];
    const mems = await db
      .select({
        content: memories.content,
        category: memories.category,
        importance: memories.importance,
        createdAt: memories.createdAt,
      })
      .from(memories)
      .where(eq(memories.userId, u.id));
    const nts = await db
      .select({
        title: notes.title,
        content: notes.content,
        pinned: notes.pinned,
        archived: notes.archived,
        createdAt: notes.createdAt,
      })
      .from(notes)
      .where(eq(notes.userId, u.id));
    const rems = await db
      .select({
        task: reminders.task,
        dueAt: reminders.dueAt,
        recurrence: reminders.recurrence,
        status: reminders.status,
      })
      .from(reminders)
      .where(eq(reminders.userId, u.id));
    const fls = await db
      .select({ name: files.name, mime: files.mime, size: files.size, createdAt: files.createdAt })
      .from(files)
      .where(eq(files.userId, u.id));

    const payload = {
      exportedAt: new Date().toISOString(),
      account: { email: u.email },
      profile,
      settings,
      conversations: convos.map((c) => ({
        title: c.title,
        createdAt: c.createdAt,
        messages: msgs
          .filter((m) => m.conversationId === c.id)
          .map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
      })),
      memories: mems,
      notes: nts,
      reminders: rems,
      files: fls,
    };
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="aura-export-${Date.now()}.json"`,
      },
    });
  } catch (e) {
    return errResponse(e);
  }
}
