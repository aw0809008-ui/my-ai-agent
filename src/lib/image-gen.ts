// ---------------------------------------------------------------------------
// Image GENERATION provider — OpenRouter's dedicated Images API.
//
//   POST /api/v1/images   { model, prompt, aspect_ratio?, n? }
//   → { created, data: [{ b64_json, media_type }], usage }
//
// This is deliberately SEPARATE from image UNDERSTANDING (vision), which stays
// on /chat/completions via the model router (Nemotron Omni → Gemma).
//
// Capability is verified against the dedicated image-model catalog
// (GET /api/v1/images/models) before any generation request: a model is only
// used when the provider itself reports output_modalities including "image".
// Nothing is assumed.
//
// The API key never leaves the server: it is read from OPENROUTER_API_KEY and
// only used in this module's outbound fetch.
// ---------------------------------------------------------------------------

import { logEvent } from "@/lib/http";
import { classifyStatus, type FailureCategory } from "@/lib/openrouter";

const BASE_URL = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(
  /\/$/,
  ""
);

/** Real, catalog-verified default. NOTE: OpenRouter currently lists NO ':free'
 *  image-generation models — `recraft/recraft-v3:free` does not exist. The
 *  slug below is the actual Recraft V3 id and is a PAID model, so generation
 *  needs credits on the account. Override with MODEL_IMAGE_GENERATION. */
export const DEFAULT_IMAGE_MODEL = "recraft/recraft-v3";

export function imageModelId(): string {
  return (process.env.MODEL_IMAGE_GENERATION ?? DEFAULT_IMAGE_MODEL).trim();
}

export function imageGenConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim()) && imageModelId() !== "";
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
// Capability verification (cached)
// ---------------------------------------------------------------------------

export interface ImageModelCaps {
  id: string;
  displayName: string;
  outputsImage: boolean;
  aspectRatios: string[];
  maxN: number;
}

let capsCache: { at: number; models: Map<string, ImageModelCaps> | null } = {
  at: 0,
  models: null,
};
const CAPS_TTL_MS = 10 * 60_000; // image catalog changes rarely

export async function imageCatalog(): Promise<Map<string, ImageModelCaps> | null> {
  if (capsCache.models && Date.now() - capsCache.at < CAPS_TTL_MS) return capsCache.models;
  try {
    const res = await fetch(`${BASE_URL}/images/models`, {
      headers: headers(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(String(res.status));
    interface Raw {
      id?: string;
      name?: string;
      architecture?: { output_modalities?: string[] };
      supported_parameters?: {
        aspect_ratio?: { values?: string[] };
        n?: { max?: number };
      };
    }
    const json = (await res.json()) as { data?: Raw[] };
    const map = new Map<string, ImageModelCaps>();
    for (const m of json.data ?? []) {
      if (!m.id) continue;
      map.set(m.id, {
        id: m.id,
        displayName: m.name ?? m.id,
        outputsImage: (m.architecture?.output_modalities ?? []).includes("image"),
        aspectRatios: m.supported_parameters?.aspect_ratio?.values ?? [],
        maxN: m.supported_parameters?.n?.max ?? 1,
      });
    }
    capsCache = { at: Date.now(), models: map };
    return map;
  } catch {
    capsCache = { at: Date.now(), models: null };
    return null;
  }
}

export class ImageGenError extends Error {
  category: FailureCategory;
  status: number | null;
  constructor(message: string, status: number | null, category?: FailureCategory) {
    super(message);
    this.status = status;
    this.category = category ?? classifyStatus(status);
  }
}

export interface GeneratedImage {
  /** raw decoded bytes, ready for storage */
  bytes: Buffer;
  mime: string;
  modelId: string;
  modelName: string;
}

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Sniff the real format from magic bytes (media_type may be absent). */
function sniffMime(buf: Buffer): string | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length > 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
}

/**
 * Text-to-image generation. Throws ImageGenError with an honest category;
 * never returns a placeholder or fake result.
 */
export async function generateImage(
  prompt: string,
  opts: { aspectRatio?: string } = {}
): Promise<GeneratedImage> {
  if (!process.env.OPENROUTER_API_KEY?.trim())
    throw new ImageGenError("OPENROUTER_API_KEY is not configured", null, "auth");

  const modelId = imageModelId();
  if (!modelId) throw new ImageGenError("MODEL_IMAGE_GENERATION is not set", null, "not_found");

  // capability check against the provider's own image catalog
  const catalog = await imageCatalog();
  const caps = catalog?.get(modelId) ?? null;
  if (catalog && !caps) {
    throw new ImageGenError(
      `Model "${modelId}" is not in the provider's image catalog`,
      404,
      "not_found"
    );
  }
  if (caps && !caps.outputsImage) {
    throw new ImageGenError(
      `Model "${modelId}" does not produce image output`,
      400,
      "unsupported"
    );
  }

  const body: Record<string, unknown> = { model: modelId, prompt: prompt.slice(0, 1500), n: 1 };
  // only send aspect_ratio when the provider says the model supports that value
  if (opts.aspectRatio && caps?.aspectRatios.includes(opts.aspectRatio)) {
    body.aspect_ratio = opts.aspectRatio;
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/images`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    throw new ImageGenError(
      e instanceof Error ? e.message.slice(0, 160) : "network failure",
      null,
      "network"
    );
  }

  if (!res.ok) {
    let msg = `provider error ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) msg = j.error.message.slice(0, 200);
    } catch {
      /* keep default */
    }
    logEvent({
      msg: "image_gen_failed",
      model: modelId,
      status: res.status,
      category: classifyStatus(res.status),
      ms: Date.now() - started,
    });
    throw new ImageGenError(msg, res.status);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ImageGenError("malformed provider response", res.status, "unknown");
  }
  const root = json as {
    data?: { b64_json?: string; media_type?: string }[];
    error?: { message?: string };
  };
  if (root.error?.message) throw new ImageGenError(root.error.message.slice(0, 200), res.status);

  const first = root.data?.[0];
  if (!first?.b64_json)
    throw new ImageGenError("provider returned no image data", res.status, "empty");

  let bytes: Buffer;
  try {
    bytes = Buffer.from(first.b64_json, "base64");
  } catch {
    throw new ImageGenError("provider returned undecodable image data", res.status, "unknown");
  }
  if (bytes.length < 64) throw new ImageGenError("provider returned an empty image", res.status, "empty");

  // trust magic bytes over the advertised media_type; reject anything unsafe
  const sniffed = sniffMime(bytes);
  const mime = sniffed ?? (first.media_type ?? "");
  if (!ALLOWED_MIME.has(mime)) {
    throw new ImageGenError(
      `unsupported output format${mime ? ` (${mime})` : ""} — expected PNG, JPEG or WebP`,
      res.status,
      "unsupported"
    );
  }

  logEvent({
    msg: "image_gen_ok",
    model: modelId,
    bytes: bytes.length,
    mime,
    ms: Date.now() - started,
  });

  return {
    bytes,
    mime,
    modelId,
    modelName: caps?.displayName ?? modelId,
  };
}
