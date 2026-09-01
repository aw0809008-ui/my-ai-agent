import { db } from "@/db";
import { reminders } from "@/db/schema";
import { and, eq, isNull, lte } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { errResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

// GET /api/notifications — due reminders that haven't been surfaced yet.
// The client polls this while the app is open, shows a local notification
// (Browser Notification API + in-app banner), then marks each as notified.
export async function GET() {
  try {
    const u = await requireUser();
    const due = await db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, u.id),
          eq(reminders.status, "pending"),
          lte(reminders.dueAt, new Date()),
          isNull(reminders.notifiedAt)
        )
      )
      .limit(10);
    return Response.json({
      reminders: due.map((r) => ({
        id: r.id,
        task: r.task,
        dueAt: r.dueAt.toISOString(),
      })),
    });
  } catch (e) {
    return errResponse(e);
  }
}
