import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "crypto";
import { db } from "@/db";
import { users, sessions, profiles, userSettings } from "@/db/schema";
import { and, eq, gt, lt } from "drizzle-orm";
import { ApiError } from "@/lib/http";

export const SESSION_COOKIE = "aura_session";
const SESSION_DAYS = 30;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt });
  // Session hygiene: opportunistically purge expired sessions for this user
  // (bounded cost; avoids unbounded table growth on serverless).
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())))
    .catch(() => {});
  return token;
}

export async function destroySession(token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

/** Session token from the httpOnly cookie OR an Authorization: Bearer header.
 *  The bearer path keeps auth working inside cross-site iframes (e.g. preview
 *  embeds) where browsers block third-party cookies. */
export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  const c = store.get(SESSION_COOKIE)?.value;
  if (c) return c;
  const h = await headers();
  const auth = h.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const t = auth.slice(7).trim();
    return t || null;
  }
  return null;
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  profile: {
    displayName: string;
    timezone: string;
    language: string;
    onboardingDone: boolean;
    memoryEnabled: boolean;
  };
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const token = await getSessionToken();
  if (!token) return null;
  // Session validity lives on sessions+users only; profile is LEFT JOINed and
  // self-healed so a missing profile row can never strand a logged-in user.
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date()))
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;

  // Read profile first; only INSERT (self-heal) when actually missing.
  // Previous version ran 2 INSERT ON CONFLICT on EVERY authenticated request.
  let [p] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, r.id))
    .limit(1);
  if (!p) {
    await ensureProfileRows(r.id);
    [p] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, r.id))
      .limit(1);
  }

  return {
    id: r.id,
    email: r.email,
    role: r.role,
    profile: {
      displayName: p?.displayName ?? "",
      timezone: p?.timezone ?? "UTC",
      language: p?.language ?? "en",
      onboardingDone: p?.onboardingDone ?? false,
      memoryEnabled: p?.memoryEnabled ?? true,
    },
  };
}

export async function requireUser(): Promise<AuthUser> {
  const u = await getAuthUser();
  if (!u) throw new ApiError(401, "UNAUTHENTICATED", "Please sign in.");
  return u;
}

export async function requireAdmin(): Promise<AuthUser> {
  const u = await requireUser();
  if (u.role !== "admin")
    throw new ApiError(403, "FORBIDDEN", "Admin access required.");
  return u;
}

export async function ensureProfileRows(userId: string) {
  await db
    .insert(profiles)
    .values({ userId })
    .onConflictDoNothing({ target: profiles.userId });
  await db
    .insert(userSettings)
    .values({ userId })
    .onConflictDoNothing({ target: userSettings.userId });
}

export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  };
}

export function sha256hex(s: string) {
  return sha256(s);
}
