import { z } from "zod";
import { db } from "@/db";
import { profiles, userSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser, ensureProfileRows } from "@/lib/auth";
import { errResponse, apiError } from "@/lib/http";

const schema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().trim().min(1).max(60).optional(),
  language: z.enum(["en", "ur", "roman-ur"]).optional(),
  onboardingDone: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  theme: z.enum(["dark", "light", "system"]).optional(),
  voice: z
    .object({
      enabled: z.boolean().optional(),
      autoplay: z.boolean().optional(),
      rate: z.number().min(0.5).max(2).optional(),
      voiceName: z.string().max(120).optional(),
    })
    .optional(),
  notifications: z
    .object({ enabled: z.boolean().optional(), sound: z.boolean().optional() })
    .optional(),
  ai: z
    .object({
      style: z.string().max(40).optional(),
      modelPreference: z.string().max(40).optional(),
      length: z.enum(["concise", "balanced", "detailed"]).optional(),
      tone: z.enum(["neutral", "friendly", "direct", "formal"]).optional(),
      /** user-authored guidance; injected as DATA, never as a security override */
      customInstructions: z.string().max(1000).optional(),
    })
    .optional(),
});

function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function PATCH(req: Request) {
  try {
    const u = await requireUser();
    const body = schema.parse(await req.json());
    // Coerce unknown timezones instead of rejecting — never block onboarding.
    if (body.timezone && !validTz(body.timezone)) body.timezone = "UTC";
    await ensureProfileRows(u.id);

    const profileSet: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of [
      "displayName",
      "timezone",
      "language",
      "onboardingDone",
      "memoryEnabled",
    ] as const) {
      if (body[k] !== undefined) profileSet[k] = body[k];
    }
    await db.update(profiles).set(profileSet).where(eq(profiles.userId, u.id));

    if (body.theme || body.voice || body.notifications || body.ai) {
      const [cur] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, u.id))
        .limit(1);
      await db
        .update(userSettings)
        .set({
          theme: body.theme ?? cur?.theme ?? "dark",
          voice: { ...(cur?.voice ?? {}), ...(body.voice ?? {}) },
          notifications: {
            ...(cur?.notifications ?? {}),
            ...(body.notifications ?? {}),
          },
          ai: { ...(cur?.ai ?? {}), ...(body.ai ?? {}) },
          updatedAt: new Date(),
        })
        .where(eq(userSettings.userId, u.id));
    }
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError)
      return apiError(400, "VALIDATION", e.issues.map((i) => i.message).join(", "));
    return errResponse(e);
  }
}
