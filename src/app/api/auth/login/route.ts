import { z } from "zod";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users, profiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createSession, ensureProfileRows, sessionCookie } from "@/lib/auth";
import { errResponse, apiError, limited, logEvent } from "@/lib/http";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") ?? "local";
    limited(`login:${ip}`, 12, 60_000);
    const body = schema.parse(await req.json());

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);
    const user = rows[0];
    const okHash =
      user?.passwordHash ??
      "$2a$12$C6UzMDM.H6dfI/f/IKcEeO7ZBZkKmR1y9mQfRPJx0qgSRsyU0UmMm"; // timing-safe dummy
    const valid = await bcrypt.compare(body.password, okHash);
    if (!user || !valid)
      return apiError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");

    try {
      await ensureProfileRows(user.id);
    } catch {
      /* profile rows self-heal via getAuthUser */
    }
    const token = await createSession(user.id);
    (await cookies()).set(sessionCookie(token));
    logEvent({ msg: "user_login", userId: user.id });

    let profile: typeof profiles.$inferSelect | undefined;
    try {
      [profile] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, user.id))
        .limit(1);
    } catch {
      profile = undefined;
    }

    return Response.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: profile?.displayName ?? "",
      },
      needsOnboarding: !profile?.onboardingDone,
      token, // bearer fallback for cookie-blocked contexts (iframes)
    });
  } catch (e) {
    if (e instanceof z.ZodError)
      return apiError(400, "VALIDATION", "Invalid email or password format.");
    return errResponse(e);
  }
}
