import { randomUUID } from "crypto";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function apiError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export function errResponse(e: unknown) {
  if (e instanceof ApiError) return apiError(e.status, e.code, e.message);
  console.error(
    JSON.stringify({
      level: "error",
      msg: "unhandled",
      error: e instanceof Error ? e.message : String(e),
    })
  );
  return apiError(500, "INTERNAL", "Something went wrong. Please try again.");
}

// ---------------------------------------------------------------------------
// In-memory rate limiting (per key token bucket, fixed window)
// ---------------------------------------------------------------------------

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) buckets.clear();
    return { ok: true, retryAfterSec: 0 };
  }
  b.count++;
  if (b.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

export function limited(key: string, limit: number, windowMs: number) {
  const r = rateLimit(key, limit, windowMs);
  if (!r.ok) {
    throw new ApiError(
      429,
      "RATE_LIMITED",
      `Too many requests. Try again in ${r.retryAfterSec}s.`
    );
  }
}

export function requestId(): string {
  return randomUUID().slice(0, 8);
}

export function logEvent(data: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...data }));
}
