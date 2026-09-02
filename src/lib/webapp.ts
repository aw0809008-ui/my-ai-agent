// ---------------------------------------------------------------------------
// Web App Builder — detection, structured project schema, validation.
//
// SECURITY MODEL
// Generated code is UNTRUSTED. It is never executed on the server (no eval,
// no child processes, no filesystem). It is only rendered inside a
// null-origin sandboxed iframe in the browser (see webapp-preview.tsx), so it
// cannot read cookies, localStorage, the parent DOM, or call our APIs with
// the user's session.
// ---------------------------------------------------------------------------

import { z } from "zod";

// ---------------------------------------------------------------------------
// 1. Detection — "build me an app" vs ordinary coding help
// ---------------------------------------------------------------------------

const BUILD_VERB =
  String.raw`(?:build|create|make|generate|design|scaffold|put together|turn .{0,40}into)`;
const APP_NOUN =
  String.raw`(?:web\s?app|webapp|web\s?site|website|landing\s?page|dashboard|portfolio|storefront|ecommerce(?:\s+(?:site|store|page|ui))?|e-commerce(?:\s+(?:site|store|page|ui))?|admin\s?panel|ui|user\s?interface|front\s?end|single\s?page\s?app|spa|react\s?app|next\s?app|page)`;

/** Phrases that must stay ordinary coding tasks. */
const NOT_BUILD =
  /\b(explain|debug|fix this|review|refactor this|what does|how does|difference between|show me (?:the )?code|write a (?:python|bash|sql|node|cli)\b|unit test|regex|algorithm)\b/i;

/**
 * Detect a full web-app build request. Conservative: needs a build verb plus
 * an app/page noun, and must not look like an explain/debug/snippet request.
 * Returns the cleaned build brief, or null.
 */
export function detectWebAppBuild(raw: string): string | null {
  const text = raw.trim();
  if (text.length < 8 || text.length > 4000) return null;
  const t = text.toLowerCase();
  if (NOT_BUILD.test(t)) return null;

  // "write a react button component" → component, not an app
  if (/\b(component|hook|function|snippet|util|helper)\b/.test(t) && !/\bapp\b|\bpage\b|\bsite\b|\bdashboard\b/.test(t))
    return null;

  const re = new RegExp(String.raw`\b${BUILD_VERB}\b[\s\S]{0,40}?\b${APP_NOUN}\b`, "i");
  if (re.test(t)) return text;

  // "turn these requirements into a web app"
  if (/\bturn\b[\s\S]{0,60}\binto\b[\s\S]{0,20}\b(web\s?app|website|dashboard|landing\s?page)\b/i.test(t))
    return text;

  return null;
}

/** Detect a follow-up modification when a project is already attached. */
export function isProjectEdit(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (t.length < 3) return false;
  return /\b(change|update|modify|add|remove|delete|make it|use a|switch|replace|rename|move|fix|improve|redesign|restyle|adjust|set the|turn the|darker|lighter|bigger|smaller|mobile|responsive|animate)\b/.test(
    t
  );
}

// ---------------------------------------------------------------------------
// 2. Structured project schema (zod-validated; malformed output is rejected)
// ---------------------------------------------------------------------------

const MAX_FILES = 24;
const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 160_000;

/** Only browser-runnable source files; no configs, lockfiles or dotfiles. */
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,90}\.(tsx|ts|jsx|js|css|html)$/;

export const projectFileSchema = z.object({
  path: z
    .string()
    .min(3)
    .max(96)
    .refine((p) => SAFE_PATH.test(p), "unsupported file path or extension")
    .refine((p) => !p.includes(".."), "path traversal is not allowed")
    .refine((p) => !p.startsWith("/"), "absolute paths are not allowed"),
  content: z.string().max(MAX_FILE_CHARS),
});

export const projectSchema = z.object({
  name: z.string().trim().min(1).max(60),
  framework: z.literal("react").catch("react"),
  entry: z.string().min(3).max(96),
  files: z.array(projectFileSchema).min(1).max(MAX_FILES),
  summary: z.string().max(600).optional(),
});

export type ProjectPayload = z.infer<typeof projectSchema>;

export interface ValidationResult {
  ok: boolean;
  project?: ProjectPayload;
  error?: string;
}

/** Patterns that must never appear in generated browser code. */
const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /\bprocess\s*\.\s*env\b/, why: "environment variable access" },
  { re: /\bdocument\s*\.\s*cookie\b/, why: "cookie access" },
  { re: /\b(?:local|session)Storage\b/, why: "storage access" },
  { re: /\bwindow\s*\.\s*(?:parent|top|opener)\b/, why: "parent frame access" },
  { re: /\bfetch\s*\(\s*[`'"]\/api\//, why: "calls to the host application API" },
  { re: /\bimport\s*\(\s*[`'"]https?:/, why: "remote dynamic import" },
  { re: /\brequire\s*\(/, why: "CommonJS require" },
];

export function validateProject(raw: unknown): ValidationResult {
  const parsed = projectSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .slice(0, 4)
        .map((i) => `${i.path.join(".") || "project"}: ${i.message}`)
        .join("; "),
    };
  }
  const p = parsed.data;

  const total = p.files.reduce((n, f) => n + f.content.length, 0);
  if (total > MAX_TOTAL_CHARS)
    return { ok: false, error: `project too large (${total} chars)` };

  const paths = new Set<string>();
  for (const f of p.files) {
    if (paths.has(f.path)) return { ok: false, error: `duplicate file: ${f.path}` };
    paths.add(f.path);
    for (const rule of FORBIDDEN) {
      if (rule.re.test(f.content))
        return { ok: false, error: `${f.path} contains ${rule.why}, which is blocked` };
    }
  }

  // entry must exist; otherwise fall back to a sensible component
  if (!paths.has(p.entry)) {
    const guess =
      [...paths].find((x) => /^src\/App\.(tsx|jsx)$/.test(x)) ??
      [...paths].find((x) => /App\.(tsx|jsx)$/.test(x)) ??
      [...paths].find((x) => /\.(tsx|jsx)$/.test(x));
    if (!guess) return { ok: false, error: "no React entry file found" };
    p.entry = guess;
  }
  return { ok: true, project: p };
}

/** Pull a JSON object out of a model reply (handles ```json fences + prose). */
export function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text].filter(Boolean) as string[];
  for (const c of candidates) {
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch {
      /* try next */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. Prompts
// ---------------------------------------------------------------------------

const RULES = `Rules for the generated app:
- React 18 function components with hooks. TypeScript (.tsx) preferred.
- Tailwind utility classes are available globally (Play CDN) — use them for styling. You may also add plain CSS files.
- NO imports of external npm packages (no router, no icon libs, no state libs). Only "react" is importable.
- Inline SVG for icons. Use https://images.unsplash.com/... or https://picsum.photos/... only if an image is essential.
- Local relative imports between your own files are allowed, e.g. import Hero from "./components/Hero".
- Must be responsive and look polished.
- Never use process.env, cookies, localStorage, window.parent, or fetch to /api/*.
- Keep it to at most 10 files.`;

const SHAPE = `Respond with ONE JSON object and nothing else (no prose, no explanation outside the JSON):
{
  "name": "short app name",
  "framework": "react",
  "entry": "src/App.tsx",
  "summary": "one sentence describing what you built",
  "files": [
    { "path": "src/App.tsx", "content": "...full file source..." }
  ]
}
All file contents must be complete, runnable source — never placeholders like "// rest of code".`;

export function buildProjectPrompt(brief: string): string {
  return `You are a senior frontend engineer. Build a complete, working single-page React app for this request:

"${brief}"

${RULES}

${SHAPE}`;
}

export function editProjectPrompt(
  brief: string,
  files: { path: string; content: string }[],
  entry: string
): string {
  const listing = files
    .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 6000)}`)
    .join("\n\n");
  return `You are editing an existing React app. Apply this change:

"${brief}"

Current project (entry: ${entry}):

${listing}

${RULES}

Return the COMPLETE updated project — include every file that should exist afterwards, with full contents (unchanged files included as-is). Only change what the request requires.

${SHAPE}`;
}

export function fixProjectPrompt(
  errorText: string,
  files: { path: string; content: string }[],
  entry: string
): string {
  const listing = files
    .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 6000)}`)
    .join("\n\n");
  return `The React app below fails to compile or crashes at runtime with this error:

${errorText.slice(0, 1200)}

Current project (entry: ${entry}):

${listing}

Fix the error. ${RULES}

Return the COMPLETE fixed project.

${SHAPE}`;
}
