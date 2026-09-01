import { z } from "zod";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { createSession, ensureProfileRows, sessionCookie } from "@/lib/auth";
import { errResponse, apiError, limited, logEvent } from "@/lib/http";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") ?? "local";
    limited(`register:${ip}`, 12, 60_000);
    const body = schema.parse(await req.json());

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);
    if (existing.length)
      return apiError(409, "EMAIL_TAKEN", "An account with this email already exists.");

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    const role = count === 0 ? "admin" : "user"; // first account is the owner/admin

    const passwordHash = await bcrypt.hash(body.password, 12);
    const [user] = await db
      .insert(users)
      .values({ email: body.email, passwordHash, role })
      .returning({ id: users.id, email: users.email, role: users.role });

    // Non-fatal: profile rows self-heal on first authenticated request.
    try {
      await ensureProfileRows(user.id);
      const { profiles } = await import("@/db/schema");
      await db
        .update(profiles)
        .set({ displayName: body.name })
        .where(eq(profiles.userId, user.id));
    } catch (e) {
      logEvent({ msg: "profile_seed_failed", userId: user.id });
    }

    const token = await createSession(user.id);
    (await cookies()).set(sessionCookie(token));
    logEvent({ msg: "user_registered", userId: user.id });

    return Response.json({
      user: { id: user.id, email: user.email, role: user.role, name: body.name },
      needsOnboarding: true,
      token, // bearer fallback for cookie-blocked contexts (iframes)
    });
  } catch (e) {
    if (e instanceof z.ZodError)
      return apiError(
        400,
        "VALIDATION",
        e.issues.map((i) => i.message).join(", ")
      );
    return errResponse(e);
  }
}
