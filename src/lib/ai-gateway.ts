// ---------------------------------------------------------------------------
// AI Gateway — model-agnostic provider interface.
//
// Talks ONLY to a self-hosted model server that you control, via the
// OpenAI-compatible HTTP API exposed by vLLM, Ollama, llama.cpp (llama-server)
// or TGI. Set AI_BASE_URL (e.g. http://gpu-host:8000) and AI_MODEL.
//
// No proprietary hosted AI APIs are used anywhere in this codebase.
//
// Capabilities:
//   generateText  — non-streaming completion
//   streamText    — token streaming (async generator)
//   analyzeImage  — vision chat (OpenAI multimodal format) when VISION_MODEL set
//   generateEmbedding — neural embeddings when EMBEDDING_MODEL set, otherwise
//                       the built-in sparse lexical retriever is used
//   transcribeAudio   — Whisper-compatible endpoint when STT_MODEL set
//   health        — gateway reachability + metadata
// ---------------------------------------------------------------------------

import { lexicalEmbedding } from "@/lib/embeddings";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[]; // data URLs for vision models
}

const AI_BASE_URL = process.env.AI_BASE_URL?.replace(/\/$/, "");
const AI_MODEL = process.env.AI_MODEL ?? "";
const AI_API_KEY = process.env.AI_API_KEY ?? ""; // optional, for your own gateway auth

export function aiConfigured(): boolean {
  return Boolean(AI_BASE_URL && AI_MODEL);
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (AI_API_KEY) h.Authorization = `Bearer ${AI_API_KEY}`;
  return h;
}

let healthCache: { at: number; ok: boolean } = { at: 0, ok: false };

export async function aiHealth(): Promise<{
  configured: boolean;
  reachable: boolean;
  model: string;
}> {
  if (!aiConfigured())
    return { configured: false, reachable: false, model: "" };
  if (Date.now() - healthCache.at < 30_000) {
    return { configured: true, reachable: healthCache.ok, model: AI_MODEL };
  }
  let ok = false;
  try {
    const res = await fetch(`${AI_BASE_URL}/v1/models`, {
      headers: headers(),
      signal: AbortSignal.timeout(4000),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  healthCache = { at: Date.now(), ok };
  return { configured: true, reachable: ok, model: AI_MODEL };
}

export async function generateText(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<string> {
  if (!aiConfigured()) throw new Error("AI server is not configured");
  const res = await fetch(`${AI_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: headers(),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      stream: false,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
    }),
  });
  if (!res.ok) throw new Error(`AI server error ${res.status}`);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

/** Stream tokens from the self-hosted model. Yields text deltas. */
export async function* streamText(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {}
): AsyncGenerator<string> {
  if (!aiConfigured()) throw new Error("AI server is not configured");
  const res = await fetch(`${AI_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: headers(),
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      stream: true,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.7,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`AI server error ${res.status}`);
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
          choices?: { delta?: { content?: string } }[];
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore keep-alive / partial frames
      }
    }
  }
}

/** Neural embeddings from the self-hosted server (if EMBEDDING_MODEL is set),
 *  otherwise the built-in sparse lexical embedding. */
export async function generateEmbedding(text: string): Promise<number[]> {
  const model = process.env.EMBEDDING_MODEL;
  if (AI_BASE_URL && model) {
    try {
      const res = await fetch(`${AI_BASE_URL}/v1/embeddings`, {
        method: "POST",
        headers: headers(),
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ model, input: text.slice(0, 4000) }),
      });
      if (res.ok) {
        const json = (await res.json()) as { data?: { embedding?: number[] }[] };
        const emb = json.data?.[0]?.embedding;
        if (emb?.length) return emb;
      }
    } catch {
      // fall through to lexical
    }
  }
  return lexicalEmbedding(text);
}

/** Vision analysis through a self-hosted vision-language model. */
export async function analyzeImage(
  question: string,
  imageDataUrl: string,
  context: ChatMessage[] = []
): Promise<string> {
  const visionModel = process.env.VISION_MODEL;
  if (!AI_BASE_URL || !visionModel)
    throw new Error("VISION_MODEL is not configured on the AI gateway");
  const res = await fetch(`${AI_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: headers(),
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model: visionModel,
      messages: [
        ...context.slice(-4).map((m) => ({ role: m.role, content: m.content })),
        {
          role: "user",
          content: [
            { type: "text", text: question },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      max_tokens: 1024,
    }),
  });
  if (!res.ok) throw new Error(`Vision model error ${res.status}`);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

/** Whisper-compatible speech-to-text on your own server (STT_MODEL). */
export async function transcribeAudio(
  audio: Blob,
  filename: string
): Promise<string> {
  const model = process.env.STT_MODEL;
  if (!AI_BASE_URL || !model)
    throw new Error("STT_MODEL is not configured on the AI gateway");
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", model);
  const h: Record<string, string> = {};
  if (AI_API_KEY) h.Authorization = `Bearer ${AI_API_KEY}`;
  const res = await fetch(`${AI_BASE_URL}/v1/audio/transcriptions`, {
    method: "POST",
    headers: h,
    signal: AbortSignal.timeout(60_000),
    body: form,
  });
  if (!res.ok) throw new Error(`STT error ${res.status}`);
  const json = (await res.json()) as { text?: string };
  return json.text ?? "";
}
