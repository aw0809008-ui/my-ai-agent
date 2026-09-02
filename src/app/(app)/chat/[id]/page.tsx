"use client";

import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlarmClock,
  ArrowLeft,
  Brain,
  Check,
  ChevronUp,
  Code2,
  Download,
  Globe,
  Menu,
  MoreVertical,
  Pencil,
  RotateCcw,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { useShell } from "@/components/app-shell";
import { Composer, type ComposerHandle } from "@/components/composer";
import { MessageView } from "@/components/message-item";
import { Orb, type OrbState } from "@/components/orb";
import { Pressable, Spinner, inputCls } from "@/components/ui";
import { VoiceOverlay } from "@/components/voice-overlay";
import { api, authHeaders, type MessageItem } from "@/lib/client";
import { speak, stopSpeech } from "@/lib/speech";
import clsx from "clsx";

interface ChatMsg extends MessageItem {
  streaming?: boolean;
}

const SUGGESTIONS: { icon: typeof Globe; label: string; prompt: string; hint: string }[] = [
  {
    icon: Globe,
    label: "Search the latest AI news",
    prompt: "Search the web for the latest AI news today",
    hint: "Web search + sources",
  },
  {
    icon: Code2,
    label: "Debug my Python code",
    prompt: "Debug this Python function — it throws TypeError: NoneType is not iterable\n\n```python\n\n```",
    hint: "MiniMax M3",
  },
  {
    icon: Brain,
    label: "Remember something about me",
    prompt: "Remember that I prefer concise replies",
    hint: "Long-term memory",
  },
  {
    icon: AlarmClock,
    label: "Set a reminder",
    prompt: "Remind me tomorrow at 9 AM to review the roadmap",
    hint: "Works offline of the LLM",
  },
];

function ChatRoomInner({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const { settings, user } = useUnwrapShell();
  const { toast, openNav } = useShell();
  const [cid, setCid] = useState<string | null>(id === "new" ? null : id);
  const [title, setTitle] = useState("New conversation");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const [lastUserText, setLastUserText] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const busyRef = useRef(false);
  const lastBotRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendRef = useRef<((t: string, f: string[]) => void) | null>(null);

  // initial load
  useEffect(() => {
    if (id === "new") {
      const q = params.get("q");
      const attach = params.get("attach");
      // ?send=1 → submit immediately (Home suggestion cards), otherwise prefill
      if (q && params.get("send") === "1") {
        const t = setTimeout(() => sendRef.current?.(q, []), 0);
        return () => clearTimeout(t);
      }
      requestAnimationFrame(() => {
        if (q) composerRef.current?.setText(q);
        if (attach) {
          // Programmatic file-picker clicks are blocked by Safari/iOS outside
          // a user gesture — attempt it, and also show an explicit hint.
          composerRef.current?.openAttach(attach as "image" | "file");
          const t = setTimeout(
            () =>
              toast(
                attach === "image"
                  ? "Not open? Tap + and choose an image (PNG/JPG/WebP, ≤2 MB)"
                  : "Not open? Tap + and choose a file (≤2 MB)"
              ),
            700
          );
          void t;
        }
        composerRef.current?.focus();
      });
      return;
    }
    (async () => {
      try {
        const meta = await api<{ title: string }>(`/api/conversations/${id}`);
        setTitle(meta.title);
        const d = await api<{ items: MessageItem[]; nextCursor: string | null }>(
          `/api/conversations/${id}/messages`
        );
        setMessages(d.items);
        setNextCursor(d.nextCursor);
      } catch (e) {
        if ((e as { status?: number }).status === 404) setLoadErr("Conversation not found.");
        else if ((e as { status?: number }).status === 401) router.replace("/welcome");
        else setLoadErr("Couldn't load this conversation. Check your connection.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // auto-scroll
  useEffect(() => {
    if (stickRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const loadOlder = async () => {
    if (!nextCursor || !cid) return;
    setLoadingOlder(true);
    try {
      const d = await api<{ items: MessageItem[]; nextCursor: string | null }>(
        `/api/conversations/${cid}/messages?cursor=${encodeURIComponent(nextCursor)}`
      );
      setMessages((prev) => [...d.items, ...prev]);
      setNextCursor(d.nextCursor);
    } finally {
      setLoadingOlder(false);
    }
  };

  const speakIfEnabled = useCallback(
    (text: string) => {
      if (settings.voice?.enabled && settings.voice?.autoplay) {
        speak(text, { rate: settings.voice.rate, voiceName: settings.voice.voiceName });
      }
    },
    [settings]
  );

  const send = useCallback(
    async (text: string, fileIds: string[], isRetry = false) => {
      if (busyRef.current || (!text && !fileIds.length)) return;
      busyRef.current = true;
      setBusy(true);
      setStreamErr(null);
      stopSpeech();
      if (!isRetry) setLastUserText(text);

      const userMsgId = `u-${Date.now()}`;
      const botId = `a-${Date.now()}`;
      if (!isRetry) {
        setMessages((prev) => [
          ...prev,
          {
            id: userMsgId,
            role: "user",
            content: text,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
      setMessages((prev) => [
        // on retry, replace the PREVIOUS failed/empty assistant placeholder
        // (bug: old code filtered by the brand-new botId, so it never matched)
        ...prev.filter((m) => !(isRetry && m.id === lastBotRef.current)),
        {
          id: botId,
          role: "assistant",
          content: "",
          streaming: true,
          toolEvents: [],
          createdAt: new Date().toISOString(),
        },
      ]);
      lastBotRef.current = botId;
      stickRef.current = true;

      const patchBot = (fn: (m: ChatMsg) => ChatMsg) =>
        setMessages((prev) => prev.map((m) => (m.id === botId ? fn(m) : m)));

      try {
        const controller = new AbortController();
        abortRef.current = controller;
        const res = await fetch("/api/chat", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            conversationId: cid ?? undefined,
            message: text,
            fileIds: fileIds.length ? fileIds : undefined,
          }),
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.error?.message ?? "Something went wrong. Please try again.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let finalText = "";

        const handle = (event: string, data: any) => {
          if (event === "meta") {
            if (!cid) {
              setCid(data.conversationId);
              window.history.replaceState(null, "", `/chat/${data.conversationId}`);
              // best-effort: title comes from first message
              setTitle(text.slice(0, 56) || "New conversation");
            }
          } else if (event === "delta") {
            finalText += data.text;
            patchBot((m) => ({ ...m, content: m.content + data.text }));
          } else if (event === "model") {
            patchBot((m) => ({
              ...m,
              model: data.name + (data.fallback ? " (fallback)" : ""),
            }));
          } else if (event === "tool") {
            patchBot((m) => {
              const tools = [...(m.toolEvents ?? [])];
              const running = [...tools].reverse().find((t) => t.name === data.name && t.status === "running");
              if (running && data.status !== "running") running.status = data.status;
              else tools.push({ name: data.name, status: data.status, detail: data.label });
              return { ...m, toolEvents: tools };
            });
          } else if (event === "sources") {
            patchBot((m) => ({ ...m, sources: data.items }));
          } else if (event === "error") {
            setStreamErr(data.message ?? "The response was interrupted. Please try again.");
          } else if (event === "done") {
            patchBot((m) => ({ ...m, streaming: false }));
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const ev = frame.match(/^event: (.+)$/m)?.[1];
            const da = frame.match(/^data: ([\s\S]+)$/m)?.[1];
            if (ev && da) {
              try {
                handle(ev, JSON.parse(da));
              } catch {}
            }
          }
        }

        patchBot((m) => ({ ...m, streaming: false }));
        if (finalText) speakIfEnabled(finalText);
      } catch (e) {
        const stopped = e instanceof DOMException && e.name === "AbortError";
        patchBot((m) => ({
          ...m,
          streaming: false,
          content: m.content || (stopped ? "_Stopped._" : ""),
        }));
        if (!stopped) {
          setStreamErr(
            e instanceof Error ? e.message : "Network error. Check your connection and retry."
          );
        }
      } finally {
        abortRef.current = null;
        busyRef.current = false;
        setBusy(false);
      }
    },
    [cid, speakIfEnabled]
  );

  // expose the latest send() to the mount effect (auto-send from Home)
  useEffect(() => {
    sendRef.current = (t: string, f: string[]) => send(t, f);
  }, [send]);

  /** Stop an in-flight generation (partial text is kept). */
  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** Regenerate: drop the last assistant reply and resend the last user text. */
  const regenerate = useCallback(() => {
    if (busyRef.current) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setMessages((prev) => {
      const idx = prev.map((m) => m.role).lastIndexOf("assistant");
      return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
    });
    send(lastUser.content, [], true);
  }, [messages, send]);

  const orbState: OrbState = busy
    ? messages[messages.length - 1]?.content
      ? "responding"
      : "thinking"
    : "idle";
  const talking = settings.voice?.enabled;

  /** Export this conversation as a markdown file (client-side, no backend change). */
  const exportConversation = useCallback(() => {
    const lines = [`# ${title}`, ""];
    for (const m of messages) {
      if (!m.content) continue;
      lines.push(m.role === "user" ? "**You**" : `**Aura**${m.model ? ` · ${m.model}` : ""}`);
      lines.push("", m.content, "");
      if (m.sources?.length) {
        lines.push("Sources:");
        for (const s of m.sources) lines.push(`- [${s.title}](${s.url})`);
        lines.push("");
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^\w\s-]/g, "").slice(0, 50) || "conversation"}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Conversation exported");
  }, [messages, title, toast]);

  const deleteConversation = useCallback(async () => {
    if (!cid) return;
    try {
      await api(`/api/conversations/${cid}`, { method: "DELETE" });
      toast("Conversation deleted");
      router.push("/chat");
    } catch {
      toast("Couldn't delete this conversation");
    }
  }, [cid, router, toast]);

  const saveTitle = async () => {
    setEditingTitle(false);
    const t = titleDraft.trim();
    if (!t || !cid) return;
    setTitle(t);
    await api(`/api/conversations/${cid}`, { method: "PATCH", json: { title: t } }).catch(
      () => {}
    );
  };

  if (loadErr) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <Orb state="error" size={110} />
        <p className="font-display text-[16px] font-semibold">{loadErr}</p>
        <Pressable
          onClick={() => router.push("/chat")}
          className="rounded-full bg-violet px-5 py-2.5 text-[13px] font-semibold text-white"
        >
          Back to conversations
        </Pressable>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* header */}
      <div className="z-10 flex items-center gap-2 border-b border-line bg-void/85 px-3 py-2.5 backdrop-blur-xl lg:px-6">
        <div className="mx-auto flex w-full max-w-[820px] items-center gap-2">
        <Pressable
          onClick={openNav}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-mist hover:bg-elev hover:text-frost lg:hidden"
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </Pressable>
        <Pressable
          onClick={() => router.push("/chat")}
          className="hidden h-9 w-9 shrink-0 place-items-center rounded-xl text-mist hover:bg-elev hover:text-frost lg:grid"
          aria-label="Back to conversations"
        >
          <ArrowLeft size={18} />
        </Pressable>
        <div className="grid shrink-0 place-items-center">
          <Orb state={orbState} size={30} />
        </div>
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveTitle();
              }}
              className="flex items-center gap-1.5"
            >
              <input
                autoFocus
                className={clsx(inputCls, "px-2.5 py-1 text-[13px]")}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                maxLength={120}
              />
              <Pressable type="submit" className="shrink-0 text-mint" aria-label="Save title">
                <Check size={16} />
              </Pressable>
              <Pressable onClick={() => setEditingTitle(false)} className="shrink-0 text-faint" aria-label="Cancel">
                <X size={16} />
              </Pressable>
            </form>
          ) : (
            <button
              onClick={() => {
                setTitleDraft(title);
                setEditingTitle(true);
              }}
              className="flex w-full min-w-0 items-center gap-1.5 text-left"
            >
              <span className="truncate font-display text-[14.5px] font-semibold">{title}</span>
              <Pencil size={11} className="shrink-0 text-faint" />
            </button>
          )}
          <p className="text-[10.5px] text-faint">
            {busy ? "Aura is working…" : `Private · ${user.displayName}`}
          </p>
        </div>
        {talking && (
          <Pressable
            onClick={() => {
              stopSpeech();
              const last = [...messages].reverse().find((m) => m.role === "assistant" && m.content);
              if (last)
                speak(last.content, {
                  rate: settings.voice.rate,
                  voiceName: settings.voice.voiceName,
                });
            }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-mist hover:bg-elev hover:text-frost"
            aria-label="Read last reply aloud"
          >
            <Volume2 size={17} />
          </Pressable>
        )}

        {/* conversation menu */}
        {cid && (
          <div className="relative shrink-0">
            <Pressable
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-label="Conversation options"
              className="grid h-9 w-9 place-items-center rounded-xl text-mist hover:bg-elev hover:text-frost"
            >
              <MoreVertical size={17} />
            </Pressable>
            {menuOpen && (
              <>
                <button
                  className="fixed inset-0 z-20 cursor-default"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close menu"
                  tabIndex={-1}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className="absolute top-11 right-0 z-30 w-44 overflow-hidden rounded-xl border border-line bg-elev elevated"
                >
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setTitleDraft(title);
                      setEditingTitle(true);
                    }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-frost hover:bg-card"
                  >
                    <Pencil size={14} className="text-faint" /> Rename
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      exportConversation();
                    }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-frost hover:bg-card"
                  >
                    <Download size={14} className="text-faint" /> Export markdown
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      deleteConversation();
                    }}
                    className="flex w-full items-center gap-2.5 border-t border-line px-3.5 py-2.5 text-[13px] text-danger hover:bg-card"
                  >
                    <Trash2 size={14} /> Delete chat
                  </button>
                </motion.div>
              </>
            )}
          </div>
        )}
        </div>
      </div>

      {/* messages — the ONLY scrolling region; height comes from flex-1 min-h-0,
          so the page itself never grows and the composer never moves */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain slim-scroll">
        <div className="flex flex-col gap-5 px-4 pt-5 pb-6 md:pb-8 lg:mx-auto lg:w-full lg:max-w-[820px] lg:px-8">
          {nextCursor && (
            <div className="flex justify-center">
              <Pressable
                onClick={loadOlder}
                disabled={loadingOlder}
                className="flex items-center gap-1.5 rounded-full border border-line bg-card px-4 py-1.5 text-[11.5px] font-medium text-mist"
              >
                {loadingOlder ? <Spinner className="h-3 w-3" /> : <ChevronUp size={13} />}
                Earlier messages
              </Pressable>
            </div>
          )}

          {messages.length === 0 && !busy && (
            <div className="flex flex-col items-center gap-5 pt-8 pb-2">
              <Orb state="idle" size={104} />
              <div className="text-center">
                <h2 className="font-display text-[19px] font-semibold tracking-tight">
                  What can I help you with?
                </h2>
                <p className="mt-1 text-[12.5px] text-faint">
                  Ask anything, attach an image, or use a tool below.
                </p>
              </div>
              <div className="grid w-full gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s, i) => (
                  <motion.button
                    key={s.label}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 * i, duration: 0.2 }}
                    onClick={() => send(s.prompt, [])}
                    className="group flex items-start gap-3 rounded-xl border border-line bg-card p-3 text-left transition-colors hover:border-line-strong hover:bg-elev"
                  >
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-elev text-violet transition-colors group-hover:bg-violet/12">
                      <s.icon size={14} strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-frost">{s.label}</span>
                      <span className="block text-[11px] text-faint">{s.hint}</span>
                    </span>
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            const isLastAssistant =
              m.role === "assistant" &&
              i === messages.map((x) => x.role).lastIndexOf("assistant");
            return (
              <MessageView
                key={m.id}
                m={m}
                streaming={m.streaming}
                onRegenerate={isLastAssistant && !busy ? regenerate : undefined}
                onEdit={
                  m.role === "user" && !busy
                    ? (content) => composerRef.current?.setText(content)
                    : undefined
                }
              />
            );
          })}

          {/* stream error / retry */}
          <AnimatePresence>
            {streamErr && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/10 p-3.5"
              >
                <p className="flex-1 text-[12.5px] leading-relaxed text-danger">{streamErr}</p>
                {lastUserText && (
                  <Pressable
                    onClick={() => send(lastUserText, [], true)}
                    disabled={busy}
                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-danger/15 px-3 py-1.5 text-[11.5px] font-semibold text-danger"
                  >
                    <RotateCcw size={12} /> Retry
                  </Pressable>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <Composer
        ref={composerRef}
        busy={busy}
        onSend={(t, f) => send(t, f)}
        onVoice={() => setVoiceOpen(true)}
        onError={(msg) => toast(msg)}
        onStop={stopGeneration}
      />
      <VoiceOverlay
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onUse={(text) => composerRef.current?.setText(text)}
      />
    </div>
  );
}

// wrapper to use shell safely
function useUnwrapShell() {
  const shell = useShell();
  return { settings: shell.settings, user: shell.user, updateSettingsNoop: null as null };
}

export default function ChatRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <ChatRoomInner id={id} />
    </Suspense>
  );
}
