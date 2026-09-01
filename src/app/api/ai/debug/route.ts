import { requireAdmin } from "@/lib/auth";
import { errResponse } from "@/lib/http";
import { getRegistry } from "@/lib/model-registry";
import {
  chatOnce,
  openRouterConfigured,
  openRouterHealth,
  OpenRouterError,
  type FailureCategory,
} from "@/lib/openrouter";
import { selectModels } from "@/lib/model-router";

export const dynamic = "force-dynamic";

const ENV_VARS = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "MODEL_GLM",
  "MODEL_MINIMAX",
  "MODEL_NEMOTRON_SUPER",
  "MODEL_NEMOTRON_OMNI",
  "MODEL_LAGUNA",
  "MODEL_GEMMA",
  "AI_BASE_URL",
  "AI_MODEL",
];

// GET /api/ai/debug — admin-only production diagnostics.
// Reports ONLY safe metadata: env PRESENCE (never values), model-listing
// status, and the sanitized provider error category. Keys/headers are never
// returned or logged.
export async function GET() {
  try {
    await requireAdmin();

    const env: Record<string, { present: boolean; nonEmpty: boolean }> = {};
    for (const name of ENV_VARS) {
      const v = process.env[name];
      env[name] = { present: v !== undefined, nonEmpty: Boolean(v?.trim()) };
    }

    const registry = getRegistry();
    const configured = registry.filter((m) => m.openRouterId !== "");

    const health = await openRouterHealth();
    const models = configured.map((m) => ({
      key: m.key,
      openRouterId: m.openRouterId,
      enabled: m.enabled,
      listedByProvider: health.reachable
        ? health.modelIds?.has(m.openRouterId) ?? null
        : null,
    }));

    // what the router would pick for a plain "hello" (general_chat)
    const selection = selectModels("general_chat", {
      availableIds: health.reachable ? health.modelIds : null,
      providerCaps: health.reachable ? health.caps : null,
    });

    // one minimal REAL completion probe against the general-chat primary
    let probe: {
      attempted: boolean;
      modelId: string | null;
      ok: boolean;
      status: number | null;
      category: FailureCategory | null;
      providerMessage: string | null;
      ms: number | null;
    } = {
      attempted: false,
      modelId: null,
      ok: false,
      status: null,
      category: null,
      providerMessage: null,
      ms: null,
    };

    const probeModel = selection.best ?? configured.find((m) => m.enabled) ?? null;
    if (openRouterConfigured() && probeModel) {
      const started = Date.now();
      try {
        await chatOnce([{ role: "user", content: "hi" }], probeModel, {
          maxTokens: 1,
          timeoutMs: 25_000,
        });
        probe = {
          attempted: true,
          modelId: probeModel.openRouterId,
          ok: true,
          status: 200,
          category: null,
          providerMessage: null,
          ms: Date.now() - started,
        };
      } catch (e) {
        const status = e instanceof OpenRouterError ? e.status : null;
        const category = e instanceof OpenRouterError ? e.category : "network";
        probe = {
          attempted: true,
          modelId: probeModel.openRouterId,
          ok: false,
          status,
          category,
          providerMessage:
            e instanceof Error ? e.message.slice(0, 240) : "unknown failure",
          ms: Date.now() - started,
        };
      } finally {
        // server-side structured log (safe fields only)
        const { logEvent } = await import("@/lib/http");
        logEvent({
          msg: "ai_debug_probe",
          ok: probe.ok,
          status: probe.status,
          category: probe.category,
          ms: probe.ms,
        });
      }
    }

    const diagnosis = !env.OPENROUTER_API_KEY?.nonEmpty
      ? "MISSING_API_KEY: set OPENROUTER_API_KEY in Vercel env vars (Production), then redeploy."
      : !health.reachable
        ? "UNREACHABLE: /models failed — check key validity (401) or network from Vercel to openrouter.ai."
        : models.some((m) => m.enabled && m.listedByProvider === false)
          ? `BAD_MODEL_ID: ${models.filter((m) => m.enabled && m.listedByProvider === false).map((m) => m.openRouterId).join(", ")} not in the provider catalog.`
          : probe.attempted && !probe.ok
            ? `COMPLETION_FAILED_${(probe.category ?? "unknown").toUpperCase()}: see probe.providerMessage.`
            : "OK";

    return Response.json({
      env,
      provider: {
        configured: openRouterConfigured(),
        modelsEndpointReachable: health.reachable,
      },
      models,
      selectionForHello: selection.best
        ? { best: selection.best.key, chain: selection.chain.map((c) => c.key), dropped: selection.drop }
        : { best: null, dropped: selection.drop },
      probe,
      diagnosis,
    });
  } catch (e) {
    return errResponse(e);
  }
}
