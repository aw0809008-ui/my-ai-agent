import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser, ensureProfileRows } from "@/lib/auth";
import { errResponse } from "@/lib/http";
import { aiStatus } from "@/lib/model-router";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const u = await requireUser();
    await ensureProfileRows(u.id); // self-heal missing settings row
    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, u.id))
      .limit(1);
    const ai = await aiStatus();
    return Response.json({
      user: {
        id: u.id,
        email: u.email,
        role: u.role,
        ...u.profile,
      },
      settings: settings ?? null,
      ai,
    });
  } catch (e) {
    return errResponse(e);
  }
}
