"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import {
  AlarmClockPlus,
  Brain,
  Check,
  ChevronDown,
  Clock,
  Copy,
  FileSearch,
  Globe,
  ImageIcon,
  ListChecks,
  NotebookPen,
  Search,
  Wrench,
} from "lucide-react";
import type { MessageItem as Msg } from "@/lib/client";
import clsx from "clsx";

const TOOL_META: Record<string, { icon: typeof Globe; running: string; done: string }> = {
  search_web: { icon: Globe, running: "Searching the web", done: "Web search complete" },
  save_memory: { icon: Brain, running: "Saving memory", done: "Memory saved" },
  search_memory: { icon: Brain, running: "Searching memory", done: "Memory searched" },
  delete_memory: { icon: Brain, running: "Deleting memory", done: "Memory deleted" },
  create_note: { icon: NotebookPen, running: "Creating note", done: "Note created" },
  search_notes: { icon: Search, running: "Searching notes", done: "Notes searched" },
  create_reminder: { icon: AlarmClockPlus, running: "Creating reminder", done: "Reminder created" },
  list_reminders: { icon: ListChecks, running: "Loading reminders", done: "Reminders loaded" },
  get_current_time: { icon: Clock, running: "Checking time", done: "Time checked" },
  analyze_file: { icon: FileSearch, running: "Reading document", done: "Document read" },
  analyze_image: { icon: ImageIcon, running: "Reading image", done: "Image analysed" },
};

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = String(children ?? "").replace(/\n$/, "");
  return (
    <div className="group/code relative">
      <button
        onClick={() => {
          navigator.clipboard?.writeText(text).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
        className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-lg border border-line bg-elev text-mist opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100 hover:text-frost"
        aria-label={copied ? "Code copied" : "Copy code"}
      >
        {copied ? <Check size={13} className="text-mint" /> : <Copy size={13} />}
      </button>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const MessageView = memo(function MessageView({
  m,
  streaming,
}: {
  m: Msg;
  streaming?: boolean;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  if (m.role === "user") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="flex justify-end pl-10 sm:pl-20"
      >
        <div className="max-w-full rounded-2xl rounded-br-md border border-violet/25 bg-violet/12 px-3.5 py-2.5 text-[14px] leading-relaxed break-words whitespace-pre-wrap text-frost">
          {m.content}
        </div>
      </motion.div>
    );
  }

  const tools = m.toolEvents ?? [];
  const sources = m.sources ?? [];
  const searchUsed = tools.some((t) => t.name === "search_web" && t.status === "ok");

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="pr-1"
    >
      {/* compact tool status line */}
      {tools.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {tools.map((t, i) => {
            const meta = TOOL_META[t.name] ?? { icon: Wrench, running: t.name, done: t.name };
            const Icon = meta.icon;
            const running = t.status === "running";
            const error = t.status === "error";
            return (
              <span
                key={i}
                className={clsx(
                  "inline-flex items-center gap-1.5 text-[11.5px] font-medium",
                  error ? "text-danger" : running ? "text-violet" : "text-faint"
                )}
              >
                {error ? (
                  <Icon size={12} />
                ) : running ? (
                  <Icon size={12} className="animate-pulse" />
                ) : (
                  <Check size={12} className="text-mint" />
                )}
                {error ? `${meta.running} failed` : running ? `${meta.running}…` : meta.done}
              </span>
            );
          })}
        </div>
      )}

      {m.content ? (
        <div className="md text-frost/95">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: ({ children }) => <CodeBlock>{extractText(children)}</CodeBlock>,
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {m.content}
          </ReactMarkdown>
          {streaming && (
            <span className="ml-0.5 inline-block h-[15px] w-[6px] animate-caret rounded-[1px] bg-violet align-[-2px]" />
          )}
        </div>
      ) : streaming ? (
        <div className="flex items-center gap-2 text-[13px] text-mist" aria-live="polite">
          <span className="flex gap-1" aria-hidden>
            <span className="dot h-1.5 w-1.5 rounded-full bg-violet" />
            <span className="dot h-1.5 w-1.5 rounded-full bg-violet" />
            <span className="dot h-1.5 w-1.5 rounded-full bg-violet" />
          </span>
          Thinking…
        </div>
      ) : null}

      {/* footer: model + sources toggle */}
      {(m.model || sources.length > 0) && !streaming && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {m.model && (
            <span className="text-[10.5px] font-medium tracking-wide text-faint">
              {m.model.replace(" (fallback)", "")}
              {m.model.includes("(fallback)") && (
                <span className="text-amber"> · fallback</span>
              )}
            </span>
          )}
          {searchUsed && sources.length > 0 && (
            <button
              onClick={() => setSourcesOpen((s) => !s)}
              aria-expanded={sourcesOpen}
              className="inline-flex items-center gap-1 rounded-md text-[10.5px] font-medium text-mist transition-colors hover:text-frost"
            >
              <Globe size={11} />
              {sources.length} {sources.length === 1 ? "source" : "sources"}
              <ChevronDown
                size={11}
                className={clsx("transition-transform", sourcesOpen && "rotate-180")}
              />
            </button>
          )}
        </div>
      )}

      {/* expandable, compact source list */}
      {sourcesOpen && sources.length > 0 && (
        <motion.ul
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-2 grid gap-px overflow-hidden rounded-xl border border-line bg-line/40"
        >
          {sources.map((s, i) => {
            const host = hostOf(s.url);
            return (
              <li key={i}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2.5 bg-card p-2.5 transition-colors hover:bg-elev"
                >
                  {/* favicon with graceful fallback */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://icons.duckduckgo.com/ip3/${host}.ico`}
                    alt=""
                    width={16}
                    height={16}
                    loading="lazy"
                    className="mt-0.5 h-4 w-4 shrink-0 rounded-sm bg-elev"
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-frost">
                      {s.title}
                    </span>
                    <span className="block truncate text-[11px] text-faint">{host}</span>
                    {s.snippet && (
                      <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-mist">
                        {s.snippet}
                      </span>
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </motion.ul>
      )}
    </motion.div>
  );
});
