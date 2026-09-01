import { z } from "zod";
import { db } from "@/db";
import { reminders } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { errResponse, apiError } from "@/lib/http";
import { parseNaturalTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";

// GET /api/reminders?scope=upcoming|all|done
export async function GET(req: Request) {
  try {
    const u = await requireUser();
    const scope = new URL(req.url).searchParams.get("scope") ?? "all";
    const conds = [eq(reminders.userId, u.id)];
    if (scope === "upcoming") conds.push(eq(reminders.status, "pending"));
    if (scope === "done") conds.push(eq(reminders.status, "done"));
    const rows = await db
      .select()
      .from(reminders)
      .where(and(...conds))
      .orderBy(
        scope === "done" ? desc(reminders.dueAt) : asc(reminders.dueAt)
      )
      .limit(200);
    const now = Date.now();
    return Response.json({
      timezone: u.profile.timezone,
      items: rows.map((r) => ({
        id: r.id,
        task: r.task,
        dueAt: r.dueAt.toISOString(),
        timezone: r.timezone,
        recurrence: r.recurrence,
        status: r.status,
        overdue: r.status === "pending" && r.dueAt.getTime() <= now,
        notified: Boolean(r.notifiedAt),
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return errResponse(e);
  }
}

const createSchema = z.object({
  task: z.string().trim().min(1).max(300),
  dueAt: z.string().datetime().optional(),
  when: z.string().trim().min(2).max(120).optional(),
  recurrence: z.enum(["none", "daily", "weekly"]).optional(),
});

export async function POST(req: Request) {
  try {
    const u = await requireUser();
    const body = createSchema.parse(await req.json());
    let dueAt: Date;
    let recurrence = body.recurrence ?? "none";
    if (body.dueAt) {
      dueAt = new Date(body.dueAt);
    } else if (body.when) {
      const parsed = parseNaturalTime(body.when, u.profile.timezone);
      if (!parsed)
        return apiError(
          400,
          "BAD_TIME",
          "Couldn't parse that time. Try “tomorrow at 9am”, “in 2 hours”, or “on friday at 5pm”."
        );
      dueAt = parsed.dueAt;
      if (!body.recurrence) recurrence = parsed.recurrence;
    } else {
      return apiError(400, "VALIDATION", "Provide dueAt or a natural time (when).");
    }
    if (dueAt.getTime() < Date.now() - 60_000)
      return apiError(400, "BAD_TIME", "That time is in the past.");

    const [r] = await db
      .insert(reminders)
      .values({
        userId: u.id,
        task: body.task,
        dueAt,
        timezone: u.profile.timezone,
        recurrence,
      })
      .returning();
    return Response.json({
      id: r.id,
      task: r.task,
      dueAt: r.dueAt.toISOString(),
      recurrence: r.recurrence,
    });
  } catch (e) {
    if (e instanceof z.ZodError)
      return apiError(400, "VALIDATION", e.issues.map((i) => i.message).join(", "));
    return errResponse(e);
  }
}
