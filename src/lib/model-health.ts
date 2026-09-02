// ---------------------------------------------------------------------------
// Model health / free-quota intelligence.
//
// Free OpenRouter models have small daily quotas. Without memory, every request
// re-tries a model that is already rate-limited, burning latency and quota.
//
// This tracks per-model outcomes in memory and applies an escalating cooldown
// after repeated failures, so the router *deprioritises* an unhealthy model
// instead of hammering it. Rules:
//   • rate limit / quota (429, 402)  → long cooldown (that model is done for now)
//   • upstream / network (5xx, net)  → short cooldown (probably transient)
//   • auth / not_found               → long cooldown (config problem, not luck)
//   • any success                    → state cleared immediately
//
// Cooldown NEVER hard-blocks a model: if every candidate is cooling down we
// still try the best one (a stale cooldown must not make the app unusable).
// State is per serverless instance, which is the right scope for "what just
// failed on this box"; it is intentionally not persisted.
// ---------------------------------------------------------------------------

import type { FailureCategory } from "@/lib/openrouter";
import { logEvent } from "@/lib/http";

interface HealthEntry {
  consecutiveFailures: number;
  cooldownUntil: number;
  lastCategory: FailureCategory | null;
  lastFailureAt: number;
  successes: number;
  failures: number;
}

const state = new Map<string, HealthEntry>();

/** escalating backoff per consecutive failure, by failure class */
function cooldownMs(category: FailureCategory, consecutive: number): number {
  const step = Math.min(consecutive, 4);
  switch (category) {
    case "rate_limited":
    case "quota":
      // free-tier exhaustion: back off hard (1m → 5m → 15m → 30m)
      return [60_000, 300_000, 900_000, 1_800_000][step - 1] ?? 1_800_000;
    case "auth":
    case "not_found":
    case "unsupported":
      // configuration problems don't fix themselves quickly
      return [120_000, 600_000, 1_800_000, 1_800_000][step - 1] ?? 1_800_000;
    default:
      // transient upstream/network issues: recover fast
      return [10_000, 30_000, 90_000, 300_000][step - 1] ?? 300_000;
  }
}

function entry(key: string): HealthEntry {
  let e = state.get(key);
  if (!e) {
    e = {
      consecutiveFailures: 0,
      cooldownUntil: 0,
      lastCategory: null,
      lastFailureAt: 0,
      successes: 0,
      failures: 0,
    };
    state.set(key, e);
  }
  return e;
}

export function recordSuccess(key: string): void {
  const e = entry(key);
  e.consecutiveFailures = 0;
  e.cooldownUntil = 0;
  e.lastCategory = null;
  e.successes++;
}

export function recordFailure(key: string, category: FailureCategory): void {
  const e = entry(key);
  e.consecutiveFailures++;
  e.failures++;
  e.lastCategory = category;
  e.lastFailureAt = Date.now();
  e.cooldownUntil = Date.now() + cooldownMs(category, e.consecutiveFailures);
  logEvent({
    msg: "model_cooldown",
    model: key,
    category,
    consecutive: e.consecutiveFailures,
    seconds: Math.round((e.cooldownUntil - Date.now()) / 1000),
  });
}

/** true when the model is currently cooling down after failures */
export function isCoolingDown(key: string): boolean {
  const e = state.get(key);
  return !!e && e.cooldownUntil > Date.now();
}

/** seconds remaining, 0 when healthy */
export function cooldownRemaining(key: string): number {
  const e = state.get(key);
  if (!e || e.cooldownUntil <= Date.now()) return 0;
  return Math.round((e.cooldownUntil - Date.now()) / 1000);
}

/**
 * Reorder candidates so healthy models come first, preserving the routing
 * preference within each group. Nothing is dropped — a fully-cooled chain
 * still returns its best model rather than failing the request.
 */
export function prioritiseHealthy<T extends { key: string }>(models: T[]): T[] {
  const healthy = models.filter((m) => !isCoolingDown(m.key));
  const cooling = models.filter((m) => isCoolingDown(m.key));
  if (healthy.length === 0) return models; // all cooling: keep original order
  return [...healthy, ...cooling];
}

export interface HealthSnapshot {
  key: string;
  healthy: boolean;
  cooldownSeconds: number;
  consecutiveFailures: number;
  lastCategory: FailureCategory | null;
  successes: number;
  failures: number;
}

/** admin diagnostics — safe metadata only */
export function healthSnapshot(): HealthSnapshot[] {
  return [...state.entries()].map(([key, e]) => ({
    key,
    healthy: e.cooldownUntil <= Date.now(),
    cooldownSeconds: cooldownRemaining(key),
    consecutiveFailures: e.consecutiveFailures,
    lastCategory: e.lastCategory,
    successes: e.successes,
    failures: e.failures,
  }));
}

/** test/ops helper */
export function resetHealth(): void {
  state.clear();
}
