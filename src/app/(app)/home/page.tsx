"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  AlarmClock,
  ArrowRight,
  Brain,
  Code2,
  FileText,
  Globe,
  ImageIcon,
  MessageCircle,
  PenLine,
  Pin,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Orb } from "@/components/orb";
import { useShell } from "@/components/app-shell";
import { EmptyState, Pressable } from "@/components/ui";
import {
  api,
  formatReminderTime,
  relTime,
  type ConversationItem,
  type ReminderItem,
} from "@/lib/client";

const q = (text: string, send = false) =>
  `/chat/new?q=${encodeURIComponent(text)}${send ? "&send=1" : ""}`;

/** Quick actions: every one opens Chat with a real, runnable action. */
const QUICK = [
  { icon: MessageCircle, label: "Ask anything", href: "/chat/new" },
  { icon: Globe, label: "Search web", href: q("Search the web for the latest AI news today", true) },
  { icon: AlarmClock, label: "Set reminder", href: q("Remind me tomorrow at 9 AM to ") },
  { icon: ImageIcon, label: "Analyze image", href: "/chat/new?attach=image" },
  { icon: Wand2, label: "Generate image", href: q("Create an image of ") },
  { icon: PenLine, label: "Write", href: q("Help me write ") },
];

/** Suggested prompts demonstrate real capabilities and run immediately. */
const SUGGESTED = [
  {
    icon: Globe,
    title: "Search the latest AI news",
    sub: "Web search with sources",
    href: q("Search the web for the latest AI news today", true),
  },
  {
    icon: Code2,
    title: "Debug my code",
    sub: "Paste code, get a fix",
    href: q("Help me debug this code — here is the error:\n\n"),
  },
  {
    icon: Brain,
    title: "Remember something",
    sub: "Saved to long-term memory",
    href: q("Remember that "),
  },
  {
    icon: AlarmClock,
    title: "Remind me tomorrow at 9 AM",
    sub: "Creates a real reminder",
    href: q("Remind me tomorrow at 9 AM to "),
  },
  {
    icon: Wand2,
    title: "Create an image",
    sub: "Text-to-image generation",
    href: q("Create an image of "),
  },
];

export default function HomePage() {
  const router = useRouter();
  const { user, ai } = useShell();
  const [recent, setRecent] = useState<ConversationItem[]>([]);
  const [nextReminder, setNextReminder] = useState<ReminderItem | null>(null);
  const [memCount, setMemCount] = useState<number | null>(null);
  const [orbTap, setOrbTap] = useState(false);

  useEffect(() => {
    api<{ items: ConversationItem[] }>("/api/conversations")
      .then((d) => setRecent(d.items.slice(0, 4)))
      .catch(() => {});
    api<{ items: ReminderItem[]; timezone: string }>("/api/reminders?scope=upcoming")
      .then((d) => {
        const upcoming = d.items.find((r) => new Date(r.dueAt).getTime() > Date.now());
        setNextReminder(upcoming ?? null);
      })
      .catch(() => {});
    api<{ items: unknown[] }>("/api/memories")
      .then((d) => setMemCount(d.items.length))
      .catch(() => {});
  }, []);

  const greeting = useMemo(() => {
    try {
      const h = +new Intl.DateTimeFormat("en-US", {
        timeZone: user.timezone,
        hour: "numeric",
        hour12: false,
      }).format(new Date());
      if (h < 5) return "Up late";
      if (h < 12) return "Good morning";
      if (h < 17) return "Good afternoon";
      if (h < 21) return "Good evening";
      return "Good night";
    } catch {
      return "Hello";
    }
  }, [user.timezone]);

  const firstName = user.displayName.split(" ")[0] || "there";

  return (
    <div className="h-full overflow-y-auto px-5 pb-32 slim-scroll lg:pb-14 lg:px-10">
      {/* header */}
      <div className="flex items-center justify-between pt-8 lg:mx-auto lg:max-w-[880px]">
        <div>
          <p className="text-[13px] text-mist">
            {new Intl.DateTimeFormat("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            }).format(new Date())}
          </p>
          <h1 className="mt-1 font-display text-[26px] font-bold tracking-tight">
            {greeting}, <span className="gradient-text">{firstName}</span>.
          </h1>
        </div>
        {!ai.reachable && (
          <span className="flex items-center gap-1.5 rounded-full border border-amber/30 bg-amber/10 px-2.5 py-1 text-[10.5px] font-semibold text-amber">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" />
            {ai.configured ? "AI offline" : "AI not linked"}
          </span>
        )}
      </div>

      <div className="lg:mx-auto lg:max-w-[880px]">
      {/* compact hero — Chat is the entry point */}
      <div className="mt-5 flex flex-col items-center">
        <Orb state={orbTap ? "thinking" : ai.reachable ? "idle" : "offline"} size={104} />
        <p className="mt-3.5 text-center font-display text-[17px] font-semibold tracking-tight text-frost">
          Ask Aura anything
        </p>
        <p className="mt-1 max-w-[330px] text-center text-[12px] leading-relaxed text-faint">
          Chat is where everything happens — search the web, analyse images, save
          memories and create reminders just by asking.
        </p>
        <Pressable
          onClick={() => router.push("/chat/new")}
          className="mt-4 flex items-center gap-2 rounded-xl bg-violet px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-iris"
        >
          <Sparkles size={15} /> Start a chat
        </Pressable>
      </div>

      {/* suggested prompts — each launches a real action in Chat */}
      <div className="mt-7">
        <h2 className="mb-2.5 px-1 text-[11px] font-semibold tracking-[0.12em] text-faint uppercase">
          Try this
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {SUGGESTED.map((s) => (
            <Pressable
              key={s.title}
              onClick={() => router.push(s.href)}
              className="group flex items-start gap-3 rounded-xl border border-line bg-card p-3 text-left transition-colors hover:border-line-strong hover:bg-elev"
            >
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-elev text-violet transition-colors group-hover:bg-violet/12">
                <s.icon size={14} strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-frost">{s.title}</span>
                <span className="block text-[11px] text-faint">{s.sub}</span>
              </span>
            </Pressable>
          ))}
        </div>
      </div>

      {/* quick actions */}
      <h2 className="mt-7 mb-2.5 px-1 text-[11px] font-semibold tracking-[0.12em] text-faint uppercase">
        Quick actions
      </h2>
      <div className="grid grid-cols-3 gap-2 lg:grid-cols-6 lg:gap-2.5">
        {QUICK.map((q, i) => (
          <motion.div
            key={q.label}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i }}
          >
            <Pressable
              onClick={() => router.push(q.href)}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-card px-2 py-3.5 transition-colors hover:border-line-strong hover:bg-elev"
            >
              <q.icon size={18} strokeWidth={1.8} className="text-violet" />
              <span className="text-[10.5px] leading-tight font-medium text-mist">{q.label}</span>
            </Pressable>
          </motion.div>
        ))}
      </div>

      {/* upcoming reminder + memory insight side by side on desktop */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-3 lg:mt-6">
      {nextReminder && (
        <Pressable
          onClick={() => router.push("/tasks")}
          className="gradient-border mt-6 flex w-full items-center gap-3 rounded-2xl bg-card p-4 text-left lg:mt-0"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber/15 text-amber">
            <AlarmClock size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-wide text-amber uppercase">
              Next reminder
            </p>
            <p className="mt-0.5 truncate text-[14px] font-medium text-frost">
              {nextReminder.task}
            </p>
            <p className="text-[12px] text-mist">
              {formatReminderTime(nextReminder.dueAt, nextReminder.timezone)}
            </p>
          </div>
          <ArrowRight size={16} className="shrink-0 text-faint" />
        </Pressable>
      )}

      {user.memoryEnabled && memCount !== null && (
        <Pressable
          onClick={() => router.push("/memory")}
          className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-line bg-card p-4 text-left hover:border-violet/40"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet/12 text-violet">
            <Brain size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-wide text-violet uppercase">
              Memory
            </p>
            <p className="mt-0.5 text-[13.5px] text-mist">
              {memCount === 0
                ? "Teach me about you — “Remember that I…”"
                : `I hold ${memCount} ${memCount === 1 ? "memory" : "memories"} about you.`}
            </p>
          </div>
          <ArrowRight size={16} className="shrink-0 text-faint" />
        </Pressable>
      )}
      </div>

      {/* recent conversations */}
      <div className="mt-7">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="font-display text-[15px] font-semibold">Recent conversations</h2>
          <button
            onClick={() => router.push("/chat")}
            className="text-[12px] font-medium text-violet"
          >
            View all
          </button>
        </div>
        {recent.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-card/50 py-2">
            <EmptyState
              icon={MessageCircle}
              title="No conversations yet"
              body="Say hello — or try “Search the web for today's space news”."
              action={
                <Pressable
                  onClick={() => router.push("/chat/new")}
                  className="mt-1 rounded-full bg-violet px-4 py-2 text-[12.5px] font-semibold text-white"
                >
                  Start chatting
                </Pressable>
              }
            />
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-card">
            {recent.map((c, i) => (
              <Pressable
                key={c.id}
                onClick={() => router.push(`/chat/${c.id}`)}
                className={`flex w-full items-center gap-3 p-3.5 text-left hover:bg-elev ${
                  i > 0 ? "border-t border-line/60" : ""
                }`}
              >
                {c.pinned && <Pin size={13} className="shrink-0 text-violet" />}
                <p className="min-w-0 flex-1 truncate text-[13.5px] text-frost">{c.title}</p>
                <span className="shrink-0 text-[11px] text-faint">{relTime(c.updatedAt)}</span>
              </Pressable>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
