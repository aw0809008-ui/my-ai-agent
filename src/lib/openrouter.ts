// ---------------------------------------------------------------------------
// OpenRouter Provider — ALL communication server-side. The key never leaves
// this process: never returned in responses, never logged, never stored.
//
// Features: non-streaming + streaming completions, exponential-backoff retries
// for transient failures (429 / 408 / 5xx / network), per-request timeouts,
// native tool-calling pass-through and JSON mode ONLY when the registry says
// the model supports them. Malformed provider payloads fail closed.
// ---------------------------------------------------------------------------

import type { ChatMessage } from "@/lib/ai-gateway";
import type { ModelMeta } from "@/lib/model-registry";

/** Messages accepted by the provider: plain text chat messages OR OpenAI
 *  multimodal content parts (image input) for vision-capable models. */
export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}
export interface APIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
}

export function imageMessage(question: string, imageDataUrl: string): APIMessage {
  return {
    role: "user",
    content: [
      { type: "text", text: question },
      { type: "image_url", image_url: { url: imageDataUrl } },
    ],
  };
}

const BASE_URL = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");

export class OpenRouterError extends Error {
  status: number | null;
  retryable: boolean;
  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export function openRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

function headers(): Record<string, string> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (key) h.Authorization = `Bearer ${key}`;
  h["HTTP-Referer"] = process.env.APP_URL ?? "https://localhost";
  h["X-Title"] = "Aura Personal AI";
  return h;
}

// ---------------------------------------------------------------------------
// Health: is the gateway reachable and which models are online right now?
// Cached briefly — never called per-chat-request on the hot path.
// ---------------------------------------------------------------------------

interface HealthCache {
  at: number;
  reachable: boolean;
  modelIds: Set<string> | null;
}
let healthCache: HealthCache = { at: 0, reachable: false, modelIds: null };
const HEALTH_TTL_MS = 45_000;

export async function openRouterHealth(): Promise<{
  configured: boolean;
  reachable: boolean;
  modelIds: Set<string> | null;
}> {
  if (!openRouterConfigured()) {
    return { configured: false, reachable: false, modelIds: null };
  }
  if (Date.now() - healthCache.at < HEALTH_TTL_MS) {
    return {
      configured: true,
      reachable: healthCache.reachable,
      modelIds: healthCache.modelIds,
    };
  }
  try {
    const res = await fetch(`${BASE_URL}/models`, {
      headers: headers(),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { data?: { id?: string }[] };
    const ids = new Set<string>(
      (json.data ?? []).map((m) => m.id ?? "").filter(Boolean)
    );
    healthCache = { at: Date.now(), reachable: true, modelIds: ids };
  } catch {
    healthCache = { at: Date.now(), reachable: false, modelIds: null };
  }
  return {
    configured: true,
    reachable: healthCache.reachable,
    modelIds: healthCache.modelIds,
  };
}

// ---------------------------------------------------------------------------
// fetch with bounded retries + exponential backoff
// ---------------------------------------------------------------------------

const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { timeoutMs: number; maxAttempts: number }
): Promise<Response> {
  const backoffs = [0, 500, 1500];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    if (backoffs[attempt]) {
      await new Promise((r) => setTimeout(r, backoffs[attempt]));
    }
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if (RETRYABLE_STATUSES.has(res.status) && attempt + 1 < opts.maxAttempts) {
        lastErr = new OpenRouterError(`provider ${res.status}`, res.status, true);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new OpenRouterError(
          `OpenRouter error ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
          res.status,
          RETRYABLE_STATUSES.has(res.status)
        );
      }
      return res;
    } catch (e) {
      if (e instanceof OpenRouterError) {
        if (!e.retryable || attempt + 1 >= opts.maxAttempts) throw e;
        lastErr = e;
        continue;
      }
      // network/timeout
      lastErr = new OpenRouterError(
        e instanceof Error ? e.message : "network failure",
        null,
        true
      );
      if (attempt + 1 >= opts.maxAttempts) throw lastErr;
    }
  }
  throw lastErr instanceof Error ? lastErr : new OpenRouterError("request failed", null, true);
}

// ---------------------------------------------------------------------------
// Request building — features only when the registry says they're supported.
// ---------------------------------------------------------------------------

export interface NativeToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface CallOptions {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** JSON mode — only sent if meta.supportsStructuredOutput */
  jsonMode?: boolean;
  /** native function calling — only sent if meta.supportsTools */
  tools?: NativeToolSpec[];
  toolChoice?: "auto" | "none";
}

function buildBody(messages: APIMessage[], meta: ModelMeta, stream: boolean, opts: CallOptions) {
  const body: Record<string, unknown> = {
    model: meta.openRouterId,
    messages,
    stream,
    max_tokens: Math.min(opts.maxTokens ?? 1536, 4096), // cost ceiling
    temperature: opts.temperature ?? 0.7,
  };
  if (opts.jsonMode && meta.supportsStructuredOutput) {
    body.response_format = { type: "json_object" };
  }
  if (opts.tools && opts.tools.length && meta.supportsTools) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice ?? "auto";
  }
  return body;
}

export interface ChatOnceResult {
  content: string;
  toolCalls?: { id: string; name: string; argumentsJson: string }[];
  finishReason?: string;
}

/** Non-streaming completion with validation. */
export async function chatOnce(
  messages: APIMessage[],
  meta: ModelMeta,
  opts: CallOptions = {}
): Promise<ChatOnceResult> {
  const res = await fetchWithRetry(
    `${BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(buildBody(messages, meta, false, opts)),
    },
    { timeoutMs: opts.timeoutMs ?? 45_000, maxAttempts: 2 }
  );
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new OpenRouterError("malformed JSON from provider", res.status, true);
  }
  const root = json as {
    choices?: {
      finish_reason?: string;
      message?: {
        content?: string | null;
        tool_calls?: {
          id?: string;
          function?: { name?: string; arguments?: string };
        }[];
      };
    }[];
    error?: { message?: string };
  };
  if (root.error?.message) {
    throw new OpenRouterError(root.error.message, res.status, false);
  }
  const choice = root.choices?.[0];
  if (!choice) throw new OpenRouterError("empty provider response", res.status, true);
  const toolCalls = (choice.message?.tool_calls ?? [])
    .filter((t) => t.function?.name)
    .map((t) => ({
      id: t.id ?? "",
      name: t.function!.name!,
      argumentsJson: typeof t.function!.arguments === "string" ? t.function!.arguments : "{}",
    }));
  return {
    content: choice.message?.content ?? "",
    toolCalls: toolCalls.length ? toolCalls : undefined,
    finishReason: choice.finish_reason,
  };
}

/** Streaming completion. Throws OpenRouterError if the request fails before
 *  any token is produced; mid-stream failures surface as generator end. */
export async function* streamOnce(
  messages: APIMessage[],
  meta: ModelMeta,
  opts: CallOptions = {}
): AsyncGenerator<string> {
  const res = await fetchWithRetry(
    `${BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(buildBody(messages, meta, true, opts)),
    },
    { timeoutMs: opts.timeoutMs ?? 120_000, maxAttempts: 2 }
  );
  if (!res.body) throw new OpenRouterError("no response body", res.status, true);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload) as {
          choices?: { delta?: { content?: string | null } }[];
          error?: { message?: string };
        };
        if (json.error?.message) return; // mid-stream provider error: end cleanly
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore keep-alive / partial frames
      }
    }
  }
}
