"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import {
  AlarmClockPlus,
  Brain,
  Check,
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

const TOOL_ICONS: Record<string, typeof Globe> = {
  search_web: Globe,
  save_memory: Brain,
  search_memory: Brain,
  delete_memory: Brain,
  create_note: NotebookPen,
  search_notes: Search,
  create_reminder: AlarmClockPlus,
  list_reminders: ListChecks,
  get_current_time: Clock,
  analyze_file: FileSearch,
  analyze_image: ImageIcon,
};

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = String(children ?? "").replace(/\n$/, "");
  return (
    <div className="relative">
      <button
        onClick={() => {
          navigator.clipboard?.writeText(text).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
        className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-lg border border-line bg-elev/80 text-mist hover:text-frost"
        aria-label="Copy code"
      >
        {copied ? <Check size={13} className="text-mint" /> : <Copy size={13} />}
      </button>
      <pre className={className}>
        <code>{text}</code>
      </pre>
    </div>
  );
}

export const MessageView = memo(function MessageView({
  m,
  streaming,
}: {
  m: Msg;
  streaming?: boolean;
}) {
  if (m.role === "user") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-end pl-12"
      >
        <div
          className="max-w-full rounded-3xl rounded-br-lg px-4 py-2.5 text-[14px] leading-relaxed break-words whitespace-pre-wrap text-white"
          style={{
            background: "linear-gradient(135deg, #6d6af8, #7c5cfc 60%, #4a8dff)",
          }}
        >
          {m.content}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="pr-2"
    >
      {/* tool chips */}
      {m.toolEvents && m.toolEvents.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {m.toolEvents.map((t, i) => {
            const Icon = TOOL_ICONS[t.name] ?? Wrench;
            return (
              <span
                key={i}
                className={clsx(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold tracking-wide",
                  t.status === "running"
                    ? "border-violet/40 bg-violet/10 text-violet"
                    : t.status === "error"
                      ? "border-danger/40 bg-danger/10 text-danger"
                      : "border-line bg-card text-mist"
                )}
              >
                <Icon size={11} />
                {t.name.replace(/_/g, " ")}
                {t.status === "running" && (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet" />
                )}
              </span>
            );
          })}
        </div>
      )}

      {m.content ? (
        <div className="md text-[14.2px] text-frost/95">
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
            <span className="ml-0.5 inline-block h-[15px] w-[7px] animate-caret rounded-[2px] bg-violet align-[-2px]" />
          )}
        </div>
      ) : streaming ? (
        <p className="shimmer-text font-display text-[13px] font-medium">Thinking…</p>
      ) : null}

      {/* source cards */}
      {m.sources && m.sources.length > 0 && (
        <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
          {m.sources.map((s, i) => {
            let host = s.url;
            try {
              host = new URL(s.url).hostname.replace(/^www\./, "");
            } catch {}
            return (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="w-56 shrink-0 rounded-2xl border border-line bg-card p-3 transition-colors hover:border-violet/40"
              >
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-violet/15 text-[10px] font-bold text-violet uppercase">
                    {host.slice(0, 2)}
                  </span>
                  <span className="truncate text-[11px] font-medium text-mist">{host}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug font-medium text-frost">
                  {s.title}
                </p>
                {s.snippet && (
                  <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-faint">
                    {s.snippet}
                  </p>
                )}
              </a>
            );
          })}
        </div>
      )}
    </motion.div>
  );
});

function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}
