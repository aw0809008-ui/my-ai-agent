// ---------------------------------------------------------------------------
// Model Router / Orchestrator
//
// Flow per request:
//   classify task (multi-signal deterministic layer)
//   → filter models by REQUIRED capability (vision / tools / context size)
//   → score by per-task preference + availability
//   → ONE best model streams
//   → on failure BEFORE first token: next compatible model (max 3)
//   → on failure mid-stream: finish cleanly, never swap mid-answer
//
// If OpenRouter is not configured, the whole router falls back to the legacy
// self-hosted gateway (vLLM/Ollama/llama.cpp) transparently.
// ---------------------------------------------------------------------------

import type { ChatMessage } from "@/lib/ai-gateway";
import { aiHealth as legacyHealth, streamText as legacyStreamText, analyzeImage as legacyAnalyzeImage } from "@/lib/ai-gateway";
import {
  enabledModels,
  type ModelMeta,
  type TaskCategory,
} from "@/lib/model-registry";
import {
  chatOnce,
  openRouterConfigured,
  openRouterHealth,
  streamOnce,
  OpenRouterError,
  type APIMessage,
  type FailureCategory,
  type ProviderCaps,
  imageMessage,
} from "@/lib/openrouter";
import { logEvent } from "@/lib/http";

// ---------------------------------------------------------------------------
// 1. Task classification — weighted multi-signal, NOT just keyword matching.
// ---------------------------------------------------------------------------

export interface Classification {
  category: TaskCategory;
  /** debug info for logs (not shown to users) */
  scores: Record<string, number>;
}

interface Signal {
  category: TaskCategory;
  pattern: RegExp;
  weight: number;
}

const WORD_SIGNALS: Signal[] = [
  { category: "coding", pattern: /\b(code|function|class|implement|compile|typescript|javascript|python|react|api|endpoint|regex|sql|algorithm|refactor|component|hook|array|async)\b/gi, weight: 2 },
  { category: "debugging", pattern: /\b(error|bug|debug|broken|fails?|failing|crash|exception|stack\s?trace|undefined|not working|fix (this|my))\b/gi, weight: 3 },
  { category: "reasoning", pattern: /\b(why|prove|logic|deduce|solve|calculate|if.*then|therefore|compare|trade-?off|paradox|riddle)\b/gi, weight: 1.5 },
  { category: "research", pattern: /\b(research|in-?depth|investigate|analy[sz]e|landscape|comprehensive|report on|deep dive|literature)\b/gi, weight: 2.5 },
  { category: "web_research", pattern: /\b(latest|current(ly)?|today('s)?|this week|news|recent(ly)?|price of|who won|breaking|202[45-9])\b/gi, weight: 2.5 },
  { category: "planning", pattern: /\b(plan|roadmap|steps? to|schedule|strategy|milestone|timeline|itinerary|checklist|organize)\b/gi, weight: 2 },
  { category: "writing", pattern: /\b(write|draft|essay|email|blog|article|story|poem|letter|caption|rewrite|paraphrase|translate)\b/gi, weight: 2 },
  { category: "summarization", pattern: /\b(summar(i|y|ze|se)|tl;?dr|key points|condense|brief|shorten|main idea)\b/gi, weight: 3 },
];

const CODE_SYNTAX = /(```|=>|\{|\}|\(\)|;|::|\/\/|#include|const |let |var |def |import |function |class |console\.\w+|<\/>|<\w+>)/g;

export function classifyTask(rawText: string, hasDocument: boolean): Classification {
  const text = rawText.slice(0, 4000);
  const scores: Record<string, number> = { general_chat: 1 };

  const bump = (cat: TaskCategory, n: number) => {
    scores[cat] = (scores[cat] ?? 0) + n;
  };

  // structural signals
  const fenceCount = (text.match(/```/g) ?? []).length;
  if (fenceCount >= 2) {
    bump("coding", 6);
    if (/\b(error|exception|traceback|undefined|null pointer|failed)\b/i.test(text)) bump("debugging", 4);
  }
  const codeTokens = (text.match(CODE_SYNTAX) ?? []).length;
  const words = text.split(/\s+/).filter(Boolean).length || 1;
  const codeDensity = codeTokens / words;
  if (codeDensity > 0.18) bump("coding", 4);
  else if (codeDensity > 0.08) bump("coding", 2);

  if (/^https?:\/\//m.test(text)) bump("research", 1.5);
  const numbers = (text.match(/\d+(\.\d+)?\s*[+\-*/=<>^%]/g) ?? []).length;
  if (numbers >= 2) bump("reasoning", 2.5);
  if (/[?؟]$/.test(text.trim()) && words > 60) bump("research", 1);

  // word signals (frequency-scaled, capped)
  for (const s of WORD_SIGNALS) {
    const hits = (text.match(s.pattern) ?? []).length;
    if (hits) bump(s.category, Math.min(hits, 3) * s.weight);
  }

  // attachments override toward analysis tasks
  if (hasDocument) {
    bump("file_analysis", 6);
    if ((scores.summarization ?? 0) > 3) bump("summarization", 2);
  }

  // pick winner (highest score wins; ties keep natural insertion order)
  let best: TaskCategory = "general_chat";
  let bestScore = scores.general_chat;
  for (const [cat, sc] of Object.entries(scores) as [TaskCategory, number][]) {
    if (sc > bestScore + 0.001) {
      best = cat;
      bestScore = sc;
    }
  }
  return { category: best, scores };
}

// ---------------------------------------------------------------------------
// 2. Model selection — capability filter + preference scoring + availability
// ---------------------------------------------------------------------------

interface SelectOptions {
  requiresVision?: boolean;
  requiresTools?: boolean;
  requiresAudio?: boolean;
  requiresVideo?: boolean;
  /** estimated total prompt tokens including context */
  estimatedTokens?: number;
  /** live availability from health check (null = unknown/optimistic) */
  availableIds?: Set<string> | null;
  /** provider-reported capabilities (null = metadata unavailable) */
  providerCaps?: Map<string, ProviderCaps> | null;
}

/** Effective capability = env declaration VERIFIED against provider metadata.
 *  A capability is usable only when the provider actually reports it; a
 *  provider-confirmed capability unlocks even without an explicit env flag. */
function effectiveCaps(meta: ModelMeta, caps?: ProviderCaps | null) {
  if (!caps) {
    // metadata unavailable: trust env declarations only (conservative)
    return {
      vision: meta.supportsVision,
      audio: meta.supportsAudio,
      video: meta.supportsVideo,
      tools: meta.supportsTools,
      structured: meta.supportsStructuredOutput,
      maxContext: meta.maxContext,
      verified: false,
    };
  }
  const has = (list: string[], mod: string) => list.includes(mod);
  return {
    vision: has(caps.inputModalities, "image"),
    audio: has(caps.inputModalities, "audio"),
    video: has(caps.inputModalities, "video"),
    tools: caps.toolSupport,
    structured: caps.structuredSupport,
    maxContext: caps.maxContext ?? meta.maxContext,
    verified: true,
  };
}

function rankForTask(meta: ModelMeta, category: TaskCategory): number {
  const taskRank = meta.taskTypes[category] ?? 9;
  let score = taskRank * 2 + meta.fallbackPriority * 0.15;
  // honesty-driven bonuses only for declared capabilities
  if (
    (category === "reasoning" || category === "planning" || category === "research") &&
    meta.supportsReasoning
  )
    score -= 1.2;
  if (category === "tool_execution" && meta.supportsTools) score -= 1.2;
  return score;
}

export function selectModels(
  category: TaskCategory,
  opts: SelectOptions = {}
): { best: ModelMeta | null; chain: ModelMeta[]; drop: string[] } {
  const estimated = opts.estimatedTokens ?? 0;
  const drop: string[] = [];
  const candidates = enabledModels().filter((m) => {
    const caps = effectiveCaps(m, opts.providerCaps?.get(m.openRouterId) ?? null);
    if (opts.requiresVision && !caps.vision) {
      drop.push(`${m.key}: no image input${caps.verified ? " (provider-verified)" : ""}`);
      return false;
    }
    if (opts.requiresAudio && !caps.audio) return false;
    if (opts.requiresVideo && !caps.video) return false;
    if (opts.requiresTools && !caps.tools) {
      drop.push(`${m.key}: no tool support`);
      return false;
    }
    if (estimated > 0 && caps.maxContext < estimated * 1.25) {
      drop.push(`${m.key}: context too small (${caps.maxContext})`);
      return false;
    }
    if (opts.availableIds && !opts.availableIds.has(m.openRouterId)) {
      drop.push(`${m.key}: not listed by provider`);
      return false;
    }
    return true;
  });
  const sorted = [...candidates].sort(
    (a, b) => rankForTask(a, category) - rankForTask(b, category)
  );
  return { best: sorted[0] ?? null, chain: sorted.slice(1, 4), drop };
}

function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) chars += m.content.length;
  return Math.ceil(chars / 4) + 512; // headroom for the answer
}

// ---------------------------------------------------------------------------
// 3. Streaming orchestration with fallback
// ---------------------------------------------------------------------------

export type StreamEvent =
  | { type: "model"; name: string; provider: "openrouter" | "self-hosted"; key: string; fallback: boolean; category: TaskCategory }
  | { type: "delta"; text: string }
  | { type: "unavailable"; reason?: FailureCategory; attempted?: string[] };

export interface StreamOutcome {
  modelName: string | null;
  modelKey: string | null;
  provider: string | null;
  fallbackUsed: boolean;
  category: TaskCategory;
  attempts: number;
}

/** Stream from the best compatible model; fall back across the chain.
 *  Returns events; `outcome` is filled as the stream progresses. */
export function streamBest(
  messages: ChatMessage[],
  category: TaskCategory,
  opts: { maxTokens?: number; temperature?: number; requiresTools?: boolean } = {}
): { events: AsyncGenerator<StreamEvent>; outcome: StreamOutcome } {
  const outcome: StreamOutcome = {
    modelName: null,
    modelKey: null,
    provider: null,
    fallbackUsed: false,
    category,
    attempts: 0,
  };

  async function* gen(): AsyncGenerator<StreamEvent> {
    const estimatedTokens = estimateTokens(messages);

    if (openRouterConfigured()) {
      const health = await openRouterHealth().catch(() => ({
        configured: true,
        reachable: false,
        modelIds: null as Set<string> | null,
        caps: null as Map<string, ProviderCaps> | null,
      }));
      const { best, chain } = selectModels(category, {
        requiresTools: opts.requiresTools,
        estimatedTokens,
        availableIds: health.reachable ? health.modelIds : null, // optimistic when health unknown
        providerCaps: health.reachable ? health.caps : null,
      });
      const sequence = best ? [best, ...chain] : [];
      const failureCats: FailureCategory[] = [];
      const attempted: string[] = [];
      let emitted = false;
      for (let i = 0; i < sequence.length; i++) {
        const meta = sequence[i];
        const startedAt = Date.now();
        let tokens = 0;
        outcome.attempts++;
        attempted.push(meta.key);
        try {
          for await (const delta of streamOnce(messages, meta, {
            maxTokens: opts.maxTokens,
            temperature: opts.temperature,
            timeoutMs: 120_000,
          })) {
            if (!emitted) {
              emitted = true;
              outcome.modelName = meta.displayName;
              outcome.modelKey = meta.key;
              outcome.provider = "openrouter";
              outcome.fallbackUsed = i > 0;
              yield { type: "model", name: meta.displayName, provider: "openrouter", key: meta.key, fallback: i > 0, category };
              logEvent({
                msg: "model_selected",
                model: meta.key,
                category,
                fallback: i > 0,
              });
            }
            tokens++;
            yield { type: "delta", text: delta };
          }
          if (tokens === 0) {
            throw new OpenRouterError("empty stream", null, true);
          }
          logEvent({
            msg: "model_ok",
            model: meta.key,
            category,
            ms: Date.now() - startedAt,
            tokens,
            attempts: outcome.attempts,
          });
          return; // success
        } catch (e) {
          const cat = e instanceof OpenRouterError ? e.category : "network";
          failureCats.push(cat);
          logEvent({
            msg: "model_failed",
            model: meta.key,
            category,
            failureCategory: cat,
            ms: Date.now() - startedAt,
            error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
            status: e instanceof OpenRouterError ? e.status : null,
            midStream: emitted,
          });
          if (emitted) return; // never swap mid-answer; partial answer already sent
          // else try next candidate
        }
      }
      outcome.modelName = null;
      // pick the most actionable failure category for the user-facing message
      const priority: FailureCategory[] = [
        "auth", "quota", "not_found", "rate_limited", "unsupported", "upstream", "network", "empty", "unknown",
      ];
      const reason =
        priority.find((c) => failureCats.includes(c)) ?? (failureCats.length ? "unknown" : undefined);
      logEvent({
        msg: "all_models_unavailable",
        category,
        reason: reason ?? "no_candidates",
        attempted,
        failureCats,
      });
      yield { type: "unavailable", reason: reason ?? "unknown", attempted };
      return;
    }

    // legacy self-hosted gateway path
    const legacy = await legacyHealth();
    if (legacy.configured && legacy.reachable) {
      outcome.attempts = 1;
      outcome.modelName = legacy.model;
      outcome.modelKey = "self-hosted";
      outcome.provider = "self-hosted";
      yield { type: "model", name: legacy.model, provider: "self-hosted", key: "self-hosted", fallback: false, category };
      try {
        for await (const delta of legacyStreamText(messages, { maxTokens: opts.maxTokens, temperature: opts.temperature })) {
          yield { type: "delta", text: delta };
        }
        return;
      } catch {
        yield { type: "unavailable" };
        return;
      }
    }
    yield { type: "unavailable" };
  }

  return { events: gen(), outcome };
}

// ---------------------------------------------------------------------------
// 4. Vision — only via registry-declared vision models (honest, no pretend)
// ---------------------------------------------------------------------------

export interface VisionResult {
  answer: string;
  modelName: string;
  fallbackUsed: boolean;
}

export async function visionAnswer(
  question: string,
  imageDataUrl: string,
  history: ChatMessage[] = []
): Promise<VisionResult> {
  if (openRouterConfigured()) {
    const health = await openRouterHealth();
    const { best, chain, drop } = selectModels("image_understanding", {
      requiresVision: true,
      availableIds: health.reachable ? health.modelIds : null,
      providerCaps: health.reachable ? health.caps : null,
    });
    const sequence = best ? [best, ...chain] : [];
    if (sequence.length === 0) {
      if (drop.length) logEvent({ msg: "vision_no_candidate", drop });
      throw new Error("VISION_NOT_CONFIGURED");
    }
    const messages: APIMessage[] = [
      ...history.slice(-3).map((m) => ({ role: m.role, content: m.content })),
      imageMessage(question, imageDataUrl),
    ];
    for (let i = 0; i < sequence.length; i++) {
      const meta = sequence[i];
      try {
        const out = await chatOnce(messages, meta, { maxTokens: 1024, timeoutMs: 90_000 });
        logEvent({ msg: "vision_ok", model: meta.key, fallback: i > 0 });
        return { answer: out.content, modelName: meta.displayName, fallbackUsed: i > 0 };
      } catch (e) {
        logEvent({
          msg: "vision_failed",
          model: meta.key,
          error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
        });
      }
    }
    throw new Error("no vision model answered");
  }
  if (process.env.VISION_MODEL) {
    const answer = await legacyAnalyzeImage(question, imageDataUrl, history);
    return { answer, modelName: process.env.VISION_MODEL, fallbackUsed: false };
  }
  throw new Error("VISION_NOT_CONFIGURED");
}

// ---------------------------------------------------------------------------
// 5. Combined status (OpenRouter first, legacy self-hosted after)
// ---------------------------------------------------------------------------

export interface AiStatus {
  configured: boolean;
  reachable: boolean;
  model: string;
  provider: "openrouter" | "self-hosted" | "none";
}

export async function aiStatus(): Promise<AiStatus> {
  if (openRouterConfigured()) {
    const h = await openRouterHealth();
    const count = enabledModels().length;
    return {
      configured: count > 0,
      reachable: h.reachable,
      model: count > 0 ? `${count} models (routed)` : "",
      provider: "openrouter",
    };
  }
  const legacy = await legacyHealth();
  return {
    configured: legacy.configured,
    reachable: legacy.reachable,
    model: legacy.model,
    provider: legacy.configured ? "self-hosted" : "none",
  };
}
