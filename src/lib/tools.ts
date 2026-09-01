// ---------------------------------------------------------------------------
// Internal tool registry. The assistant may REQUEST a tool; the backend
// validates args against a schema, checks permissions, enforces a timeout,
// executes, and audits every call. Model output is never executed blindly.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { db } from "@/db";
import {
  memories,
  notes,
  reminders,
  files,
  toolCalls,
  conversations,
} from "@/db/schema";
import { and, eq, desc, gte, lte } from "drizzle-orm";
import { webSearch, type SearchResult } from "@/lib/search";
import {
  lexicalEmbedding,
  cosine,
  topK,
} from "@/lib/embeddings";
import { generateEmbedding } from "@/lib/ai-gateway";
import { parseNaturalTime, formatInTz } from "@/lib/datetime";
import { ApiError } from "@/lib/http";

export interface ToolContext {
  userId: string;
  timezone: string;
  memoryEnabled: boolean;
}

export interface ToolOutput {
  ok: boolean;
  text: string; // human/model-readable summary
  data?: unknown;
  sources?: SearchResult[];
}

const MEMORY_CATEGORIES = [
  "personal",
  "preferences",
  "work",
  "projects",
  "important",
  "temporary",
] as const;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out`)), ms)
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  timeoutMs: number;
  run: (args: any, ctx: ToolContext) => Promise<ToolOutput>;
}

const defs: ToolDef[] = [
  {
    name: "search_web",
    description: "Search the web and return results with sources.",
    schema: z.object({ query: z.string().min(2).max(300) }),
    timeoutMs: 12_000,
    run: async ({ query }) => {
      const { results, provider } = await webSearch(query, 6);
      if (!results.length)
        return {
          ok: true,
          text: `No web results found for "${query}".`,
          data: { provider, results: [] },
        };
      const text = results
        .map((r, i) => `${i + 1}. ${r.title} — ${r.source}\n${r.snippet}`)
        .join("\n\n");
      return {
        ok: true,
        text: `Web results for "${query}" (${provider}):\n${text}`,
        data: { provider, results },
        sources: results,
      };
    },
  },
  {
    name: "save_memory",
    description: "Store a long-term memory about the user.",
    schema: z.object({
      content: z.string().min(2).max(1000),
      category: z.enum(MEMORY_CATEGORIES).optional(),
      importance: z.number().int().min(1).max(5).optional(),
    }),
    timeoutMs: 10_000,
    run: async ({ content, category, importance }, ctx) => {
      if (!ctx.memoryEnabled)
        return {
          ok: false,
          text: "Memory is disabled in settings, so nothing was stored.",
        };
      const cat =
        category ??
        (/prefer|like|love|hate|favorite|favourite/i.test(content)
          ? "preferences"
          : /work|job|office|client|business/i.test(content)
            ? "work"
            : "personal");
      const embedding = await generateEmbedding(content);
      await db.insert(memories).values({
        userId: ctx.userId,
        content,
        category: cat,
        importance: importance ?? 3,
        embedding,
      });
      return { ok: true, text: `Memory saved (${cat}).`, data: { category: cat } };
    },
  },
  {
    name: "search_memory",
    description: "Semantically search the user's long-term memories.",
    schema: z.object({
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(10).optional(),
    }),
    timeoutMs: 10_000,
    run: async ({ query, limit }, ctx) => {
      const rows = await db
        .select()
        .from(memories)
        .where(eq(memories.userId, ctx.userId));
      const q = await generateEmbedding(query);
      const hits = topK(rows, q, limit ?? 5, 0.08);
      if (!hits.length)
        return { ok: true, text: "No relevant memories found." };
      return {
        ok: true,
        text:
          "Relevant memories:\n" +
          hits.map((h, i) => `${i + 1}. [${h.item.category}] ${h.item.content}`).join("\n"),
        data: hits.map((h) => ({
          id: h.item.id,
          category: h.item.category,
          content: h.item.content,
          score: +h.score.toFixed(3),
        })),
      };
    },
  },
  {
    name: "delete_memory",
    description: "Delete memories matching a query, or by id.",
    schema: z.object({
      id: z.string().uuid().optional(),
      query: z.string().max(500).optional(),
    }),
    timeoutMs: 10_000,
    run: async ({ id, query }, ctx) => {
      if (id) {
        const del = await db
          .delete(memories)
          .where(and(eq(memories.id, id), eq(memories.userId, ctx.userId)))
          .returning({ id: memories.id });
        return del.length
          ? { ok: true, text: "Memory deleted." }
          : { ok: false, text: "Memory not found." };
      }
      if (!query) return { ok: false, text: "Provide an id or query." };
      const rows = await db
        .select()
        .from(memories)
        .where(eq(memories.userId, ctx.userId));
      const q = await generateEmbedding(query);
      const hits = topK(rows, q, 1, 0.35);
      if (!hits.length) return { ok: false, text: "No matching memory found." };
      await db
        .delete(memories)
        .where(
          and(eq(memories.id, hits[0].item.id), eq(memories.userId, ctx.userId))
        );
      return {
        ok: true,
        text: `Deleted memory: "${hits[0].item.content.slice(0, 80)}"`,
      };
    },
  },
  {
    name: "create_note",
    description: "Create a note.",
    schema: z.object({
      title: z.string().min(1).max(200),
      content: z.string().max(20_000).optional(),
    }),
    timeoutMs: 10_000,
    run: async ({ title, content }, ctx) => {
      const embedding = await generateEmbedding(`${title}\n${content ?? ""}`);
      const [row] = await db
        .insert(notes)
        .values({ userId: ctx.userId, title, content: content ?? "", embedding })
        .returning({ id: notes.id });
      return { ok: true, text: `Note "${title}" saved.`, data: { id: row.id } };
    },
  },
  {
    name: "search_notes",
    description: "Search notes semantically and by keyword.",
    schema: z.object({
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(10).optional(),
    }),
    timeoutMs: 10_000,
    run: async ({ query, limit }, ctx) => {
      const rows = await db
        .select({
          id: notes.id,
          title: notes.title,
          content: notes.content,
          embedding: notes.embedding,
          updatedAt: notes.updatedAt,
        })
        .from(notes)
        .where(and(eq(notes.userId, ctx.userId), eq(notes.archived, false)));
      const q = await generateEmbedding(query);
      const hits = topK(rows, q, limit ?? 5, 0.08);
      if (!hits.length) return { ok: true, text: "No notes matched." };
      return {
        ok: true,
        text:
          "Matching notes:\n" +
          hits
            .map(
              (h, i) =>
                `${i + 1}. ${h.item.title}\n${h.item.content.slice(0, 220)}`
            )
            .join("\n\n"),
        data: hits.map((h) => ({
          id: h.item.id,
          title: h.item.title,
          excerpt: h.item.content.slice(0, 220),
        })),
      };
    },
  },
  {
    name: "create_reminder",
    description: "Create a reminder from a task and natural-language time.",
    schema: z.object({
      task: z.string().min(1).max(300),
      when: z.string().min(2).max(120),
      recurrence: z.enum(["none", "daily", "weekly"]).optional(),
    }),
    timeoutMs: 10_000,
    run: async ({ task, when, recurrence }, ctx) => {
      const parsed = parseNaturalTime(when, ctx.timezone);
      if (!parsed)
        return {
          ok: false,
          text: `I couldn't understand the time "${when}". Try "tomorrow at 9am" or "in 2 hours".`,
        };
      if (parsed.dueAt.getTime() < Date.now() - 60_000)
        return { ok: false, text: "That time is in the past." };
      const rec = recurrence ?? parsed.recurrence;
      const [row] = await db
        .insert(reminders)
        .values({
          userId: ctx.userId,
          task,
          dueAt: parsed.dueAt,
          timezone: ctx.timezone,
          recurrence: rec,
        })
        .returning({ id: reminders.id });
      return {
        ok: true,
        text: `Reminder set for ${formatInTz(parsed.dueAt, ctx.timezone)}${rec !== "none" ? ` (${rec})` : ""}.`,
        data: { id: row.id, dueAt: parsed.dueAt.toISOString(), recurrence: rec },
      };
    },
  },
  {
    name: "list_reminders",
    description: "List pending reminders.",
    schema: z.object({}),
    timeoutMs: 10_000,
    run: async (_args, ctx) => {
      const rows = await db
        .select()
        .from(reminders)
        .where(and(eq(reminders.userId, ctx.userId), eq(reminders.status, "pending")))
        .orderBy(reminders.dueAt)
        .limit(20);
      if (!rows.length) return { ok: true, text: "You have no pending reminders." };
      return {
        ok: true,
        text:
          "Pending reminders:\n" +
          rows
            .map((r, i) => `${i + 1}. ${r.task} — ${formatInTz(r.dueAt, r.timezone)}`)
            .join("\n"),
        data: rows.map((r) => ({
          id: r.id,
          task: r.task,
          dueAt: r.dueAt.toISOString(),
        })),
      };
    },
  },
  {
    name: "get_current_time",
    description: "Get the current date and time in the user's timezone.",
    schema: z.object({}),
    timeoutMs: 5_000,
    run: async (_args, ctx) => {
      const now = new Date();
      return {
        ok: true,
        text: `It is ${formatInTz(now, ctx.timezone)} (${ctx.timezone}).`,
        data: { iso: now.toISOString(), timezone: ctx.timezone },
      };
    },
  },
  {
    name: "analyze_file",
    description: "Answer a question about an uploaded text document.",
    schema: z.object({
      fileId: z.string().uuid(),
      question: z.string().min(1).max(500),
    }),
    timeoutMs: 15_000,
    run: async ({ fileId, question }, ctx) => {
      const rows = await db
        .select({
          id: files.id,
          name: files.name,
          extractedText: files.extractedText,
        })
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, ctx.userId)))
        .limit(1);
      const f = rows[0];
      if (!f) return { ok: false, text: "File not found." };
      if (!f.extractedText)
        return {
          ok: false,
          text: "This file type has no extractable text. Supported for inline analysis: TXT, MD, CSV, JSON.",
        };
      // chunk → embed → retrieve top chunks (real RAG over the document)
      const chunks: { text: string; embedding: number[] }[] = [];
      for (let i = 0; i < f.extractedText.length && chunks.length < 60; i += 700) {
        const c = f.extractedText.slice(i, i + 900);
        chunks.push({ text: c, embedding: lexicalEmbedding(c) });
      }
      const q = lexicalEmbedding(question);
      const top = topK(chunks, q, 3, 0.05);
      const excerpt = (top.length ? top.map((t) => t.item.text) : [chunks[0]?.text ?? ""])
        .join("\n---\n")
        .slice(0, 2600);
      return {
        ok: true,
        text: `Relevant excerpt from "${f.name}":\n${excerpt}`,
        data: { fileId, name: f.name, excerpt },
      };
    },
  },
];

export const toolRegistry = new Map(defs.map((d) => [d.name, d]));

export const toolDescriptions = defs
  .map((d) => `- ${d.name}: ${d.description}`)
  .join("\n");

/** Validate + execute a tool call with audit logging. Never throws to caller. */
export async function executeTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext
): Promise<ToolOutput> {
  const started = Date.now();
  const def = toolRegistry.get(name);
  const audit = async (
    status: string,
    args: unknown,
    error: string | null
  ) => {
    await db
      .insert(toolCalls)
      .values({
        userId: ctx.userId,
        tool: name,
        args: (args ?? {}) as Record<string, unknown>,
        status,
        durationMs: Date.now() - started,
        error,
      })
      .catch(() => {});
  };
  if (!def) {
    await audit("denied", rawArgs, "unknown tool");
    return { ok: false, text: `Unknown tool "${name}".` };
  }
  const parsed = def.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    await audit("denied", rawArgs, "invalid arguments");
    return {
      ok: false,
      text: `Invalid arguments for ${name}: ${parsed.error.issues
        .map((i) => i.path.join(".") + " " + i.message)
        .join("; ")}`,
    };
  }
  try {
    const out = await withTimeout(def.run(parsed.data, ctx), def.timeoutMs, name);
    await audit(out.ok ? "ok" : "error", parsed.data, out.ok ? null : out.text);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "tool failed";
    await audit("error", parsed.data, msg);
    return { ok: false, text: `Tool ${name} failed: ${msg}` };
  }
}

export { ApiError };
