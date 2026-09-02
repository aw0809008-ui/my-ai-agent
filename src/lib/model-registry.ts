// ---------------------------------------------------------------------------
// Model Registry — capability metadata for every OpenRouter model we may use.
//
// HONESTY RULE: capabilities here are *configurable defaults*, and the risky
// ones (vision / audio / video) default to FALSE. Turn them on explicitly via
// env vars ONLY after verifying the model on https://openrouter.ai/models —
// e.g. `google/gemma-4-31b:free` must actually list image input before you set
// MODEL_GEMMA_VISION=true. Nothing in the app will pretend a model can see or
// hear unless its registry entry says so.
//
// Model IDs themselves are NEVER hardcoded — they come from env vars so a
// deprecated `:free` model can be swapped without touching code.
// ---------------------------------------------------------------------------

export type TaskCategory =
  | "general_chat"
  | "coding"
  | "debugging"
  | "reasoning"
  | "research"
  | "web_research"
  | "planning"
  | "tool_execution"
  | "image_understanding"
  | "audio_understanding"
  | "video_understanding"
  | "writing"
  | "summarization"
  | "file_analysis"
  | "structured_output";

export interface ModelMeta {
  /** internal registry key */
  key: string;
  displayName: string;
  /** the value of its MODEL_* env var; "" means not configured */
  openRouterId: string;
  enabled: boolean;
  /** per-category preference: lower number = preferred for that task */
  taskTypes: Partial<Record<TaskCategory, number>>;
  supportsVision: boolean;
  supportsAudio: boolean;
  supportsVideo: boolean;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  supportsReasoning: boolean;
  maxContext: number;
  /** global ordering when several models tie (lower = earlier in chain) */
  fallbackPriority: number;
}

function envFlag(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return !["0", "false", "no", "off"].includes(v.toLowerCase());
}

function envId(name: string): string {
  return (process.env[name] ?? "").trim();
}

interface ModelDefault {
  key: string;
  displayName: string;
  envVar: string;
  taskTypes: Partial<Record<TaskCategory, number>>;
  tools: boolean;
  structured: boolean;
  reasoning: boolean;
  maxContext: number;
  fallbackPriority: number;
}

// Defaults reflect the owner's intended roles. IDs + every flag stay
// overridable via env; multimodal stays OFF unless explicitly enabled.
// Routing matrix (rank 1 = primary for that task). Derived from the owner's
// routing rules:
//   general: GLM → Gemma | coding/debugging: MiniMax M3 → MiniMax M2.7 → Laguna → GLM
//   hard reasoning: Nemotron Super → GLM → Gemma | planning: Nemotron → GLM → MiniMax
//   writing: GLM → Gemma | summarization: Gemma → GLM
//   agent/tools: GLM → MiniMax M3 → MiniMax M2.7 → Nemotron
//   multimodal: Omni → Gemma(if verified)
//   web research synthesis: GLM → Nemotron (MiniMax via coding classification)
// MODEL_MINIMAX_FALLBACK is optional and only enters chains behind MiniMax M3.
const DEFAULTS: ModelDefault[] = [
  {
    key: "glm",
    displayName: "GLM 5.2",
    envVar: "MODEL_GLM",
    taskTypes: { general_chat: 1, coding: 3, debugging: 3, tool_execution: 1, planning: 2, reasoning: 2, structured_output: 2, file_analysis: 3, writing: 1, summarization: 2, research: 1, web_research: 1 },
    tools: true,
    structured: true,
    reasoning: true,
    maxContext: 128_000,
    fallbackPriority: 1,
  },
  {
    key: "minimax",
    displayName: "MiniMax M3",
    envVar: "MODEL_MINIMAX",
    taskTypes: { coding: 1, debugging: 1, tool_execution: 2, planning: 3, reasoning: 5, general_chat: 4, file_analysis: 4, structured_output: 3, research: 5, web_research: 3, writing: 6, summarization: 5 },
    tools: true,
    structured: true,
    reasoning: false,
    // provider-verified: minimax/minimax-m3:free context_length = 1,048,576
    maxContext: 1_048_576,
    fallbackPriority: 2,
  },
  {
    // FALLBACK ONLY — slots directly behind MiniMax M3 for MiniMax's own roles
    // (coding / debugging / agent-tools). Never a primary while M3 is healthy.
    // Enabled only when MODEL_MINIMAX_FALLBACK is set.
    key: "minimax_fallback",
    displayName: "MiniMax M2.7",
    envVar: "MODEL_MINIMAX_FALLBACK",
    taskTypes: {
      coding: 1.5,
      debugging: 1.5,
      tool_execution: 2.5,
      structured_output: 3.5,
    },
    tools: true,
    structured: true,
    reasoning: false,
    // provider-verified: minimax/minimax-m2.7:free context_length = 196,608
    maxContext: 196_608,
    fallbackPriority: 2.5,
  },
  {
    key: "nemotron_super",
    displayName: "Nemotron 3 Super",
    envVar: "MODEL_NEMOTRON_SUPER",
    taskTypes: { reasoning: 1, planning: 1, research: 2, web_research: 2, coding: 5, debugging: 5, general_chat: 5, tool_execution: 3, structured_output: 3, writing: 5, summarization: 4, file_analysis: 5 },
    tools: true,
    structured: true,
    reasoning: true,
    maxContext: 128_000,
    fallbackPriority: 3,
  },
  {
    key: "gpt_oss",
    displayName: "gpt-oss-120b",
    envVar: "MODEL_GPT_OSS",
    taskTypes: { reasoning: 3, tool_execution: 3, general_chat: 2, coding: 3, debugging: 3, planning: 4, structured_output: 4, writing: 3, summarization: 3, research: 4, web_research: 4, file_analysis: 2 },
    tools: true,
    structured: true,
    reasoning: true,
    maxContext: 131_072,
    fallbackPriority: 4,
  },
  {
    key: "gemma",
    displayName: "Gemma 4 31B",
    envVar: "MODEL_GEMMA",
    taskTypes: { general_chat: 2, writing: 2, summarization: 1, reasoning: 3, web_research: 4, research: 6, coding: 7, debugging: 7, planning: 5, tool_execution: 6, file_analysis: 6, structured_output: 6, image_understanding: 2 },
    tools: false,
    structured: false,
    reasoning: false,
    maxContext: 32_768,
    fallbackPriority: 5,
  },
  {
    key: "nemotron_omni",
    displayName: "Nemotron 3 Nano Omni",
    envVar: "MODEL_NEMOTRON_OMNI",
    taskTypes: { image_understanding: 1, audio_understanding: 1, video_understanding: 1, general_chat: 8, summarization: 6, file_analysis: 7 },
    tools: false,
    structured: false,
    reasoning: true,
    maxContext: 128_000,
    fallbackPriority: 6,
  },
  {
    key: "nex",
    displayName: "Nex-N2-Pro",
    envVar: "MODEL_NEX",
    taskTypes: { research: 1, web_research: 1, coding: 5, reasoning: 3, planning: 3, general_chat: 6, writing: 4, summarization: 2, file_analysis: 3, tool_execution: 7, debugging: 6 },
    tools: false,
    structured: false,
    reasoning: true,
    maxContext: 128_000,
    fallbackPriority: 7,
  },
  {
    key: "laguna",
    displayName: "Laguna XS.2",
    envVar: "MODEL_LAGUNA",
    taskTypes: { coding: 2, debugging: 2, tool_execution: 4, planning: 6, reasoning: 7, general_chat: 7, structured_output: 5 },
    tools: true,
    structured: false,
    reasoning: false,
    maxContext: 64_000,
    fallbackPriority: 8,
  },
];

function env(name: string): string {
  return `${name}`;
}

/** Build the live registry from env. Only models with a configured ID and
 *  MODEL_X_ENABLED !== false are marked enabled. */
export function getRegistry(): ModelMeta[] {
  return DEFAULTS.map((d) => {
    const p = d.envVar; // e.g. MODEL_GLM
    return {
      key: d.key,
      displayName: d.displayName,
      openRouterId: envId(d.envVar),
      enabled: envId(d.envVar) !== "" && envFlag(`${p}_ENABLED`, true),
      taskTypes: d.taskTypes,
      supportsVision: envFlag(`${p}_VISION`, false),
      supportsAudio: envFlag(`${p}_AUDIO`, false),
      supportsVideo: envFlag(`${p}_VIDEO`, false),
      supportsTools: envFlag(`${p}_TOOLS`, d.tools),
      supportsStructuredOutput: envFlag(`${p}_STRUCTURED`, d.structured),
      supportsReasoning: envFlag(`${p}_REASONING`, d.reasoning),
      maxContext: (() => {
        const n = parseInt(process.env[`${p}_CONTEXT`] ?? "", 10);
        return Number.isFinite(n) && n > 0 ? n : d.maxContext;
      })(),
      fallbackPriority: d.fallbackPriority,
    };
  });
}

export function enabledModels(): ModelMeta[] {
  return getRegistry().filter((m) => m.enabled);
}
