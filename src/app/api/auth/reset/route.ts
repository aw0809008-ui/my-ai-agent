import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { users, sessions, passwordResetTokens } from "@/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { sha256hex } from "@/lib/auth";
import { errResponse, apiError, limited, logEvent } from "@/lib/http";

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
});

// POST — request a password reset. Delivery: SMTP/webhook integration point.
// When EXPOSE_RESET_LINK=true (self-hosted dev convenience) the link is
// returned directly in the response; otherwise it is only logged server-side.
export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") ?? "local";
    limited(`reset:${ip}`, 6, 60_000);
    const { email } = requestSchema.parse(await req.json());

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Always respond the same way to avoid account enumeration.
    const generic = {
      ok: true,
      message:
        "If an account exists for this email, a reset link has been generated.",
      devLink: undefined as string | undefined,
    };
    if (!user) return Response.json(generic);

    const token = randomBytes(32).toString("base64url");
    await db.insert(passwordResetTokens).values({
      tokenHash: sha256hex(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    const link = `/reset?token=${token}`;
    logEvent({ msg: "password_reset_requested", userId: user.id, link });
    if (process.env.EXPOSE_RESET_LINK === "true") generic.devLink = link;
    return Response.json(generic);
  } catch (e) {
    if (e instanceof z.ZodError) return apiError(400, "VALIDATION", "Invalid email.");
    return errResponse(e);
  }
}

const confirmSchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(8).max(200),
});

// PUT — confirm reset with token + new password.
export async function PUT(req: Request) {
  try {
    const { token, password } = confirmSchema.parse(await req.json());
    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, sha256hex(token)),
          gt(passwordResetTokens.expiresAt, new Date()),
          isNull(passwordResetTokens.usedAt)
        )
      )
      .limit(1);
    const rt = rows[0];
    if (!rt)
      return apiError(400, "INVALID_TOKEN", "This reset link is invalid or expired.");

    const passwordHash = await bcrypt.hash(password, 12);
    await db.update(users).set({ passwordHash }).where(eq(users.id, rt.userId));
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.tokenHash, rt.tokenHash));
    await db.delete(sessions).where(eq(sessions.userId, rt.userId)); // logout everywhere
    logEvent({ msg: "password_reset_completed", userId: rt.userId });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError)
      return apiError(400, "VALIDATION", "Password must be at least 8 characters.");
    return errResponse(e);
  }
}
