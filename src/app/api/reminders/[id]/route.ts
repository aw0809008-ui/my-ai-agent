import { z } from "zod";
import { db } from "@/db";
import { reminders } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { errResponse, apiError } from "@/lib/http";
import { advanceOccurrence } from "@/lib/datetime";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  action: z.enum(["done", "snooze", "dismiss", "notify", "reopen"]).optional(),
  snoozeMinutes: z.number().int().min(1).max(1440).optional(),
  task: z.string().trim().min(1).max(300).optional(),
  dueAt: z.string().datetime().optional(),
  recurrence: z.enum(["none", "daily", "weekly"]).optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const u = await requireUser();
    const { id } = await params;
    const body = patchSchema.parse(await req.json());
    const [r] = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, u.id)))
      .limit(1);
    if (!r) return apiError(404, "NOT_FOUND", "Reminder not found.");

    const set: Record<string, unknown> = {};
    if (body.task !== undefined) set.task = body.task;
    if (body.dueAt !== undefined) {
      set.dueAt = new Date(body.dueAt);
      set.status = "pending";
      set.notifiedAt = null;
    }
    if (body.recurrence !== undefined) set.recurrence = body.recurrence;

    switch (body.action) {
      case "done": {
        const next = advanceOccurrence(r.dueAt, r.recurrence as "none" | "daily" | "weekly");
        if (next && next.getTime() > Date.now()) {
          // recurring — move to the next occurrence instead of closing
          set.dueAt = next;
          set.status = "pending";
          set.notifiedAt = null;
          set.snoozeCount = 0;
        } else {
          set.status = "done";
        }
        break;
      }
      case "snooze": {
        const mins = body.snoozeMinutes ?? 10;
        set.dueAt = new Date(Date.now() + mins * 60_000);
        set.status = "pending";
        set.notifiedAt = null;
        set.snoozeCount = r.snoozeCount + 1;
        break;
      }
      case "dismiss":
        set.status = "dismissed";
        break;
      case "reopen":
        set.status = "pending";
        set.notifiedAt = null;
        break;
      case "notify":
        set.notifiedAt = new Date();
        break;
    }

    await db.update(reminders).set(set).where(eq(reminders.id, id));
    return Response.json({ ok: true, advanced: Boolean(set.dueAt && body.action === "done") });
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
      .delete(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, u.id)))
      .returning({ id: reminders.id });
    if (!del.length) return apiError(404, "NOT_FOUND", "Reminder not found.");
    return Response.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
