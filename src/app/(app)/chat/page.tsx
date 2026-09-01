"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Archive,
  Check,
  MessagesSquare,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { useShell } from "@/components/app-shell";
import { EmptyState, PageHeader, Pressable, Spinner, inputCls } from "@/components/ui";
import { api, relTime, type ConversationItem } from "@/lib/client";
import { isToday, isYesterday, isThisWeek } from "date-fns";
import clsx from "clsx";

type Group = { label: string; items: ConversationItem[] };

function groupByTime(items: ConversationItem[]): Group[] {
  const pinned = items.filter((c) => c.pinned);
  const rest = items.filter((c) => !c.pinned);
  const today: ConversationItem[] = [];
  const yesterday: ConversationItem[] = [];
  const week: ConversationItem[] = [];
  const older: ConversationItem[] = [];
  for (const c of rest) {
    const d = new Date(c.updatedAt);
    if (isToday(d)) today.push(c);
    else if (isYesterday(d)) yesterday.push(c);
    else if (isThisWeek(d)) week.push(c);
    else older.push(c);
  }
  const groups: Group[] = [];
  if (pinned.length) groups.push({ label: "Pinned", items: pinned });
  if (today.length) groups.push({ label: "Today", items: today });
  if (yesterday.length) groups.push({ label: "Yesterday", items: yesterday });
  if (week.length) groups.push({ label: "Previous 7 days", items: week });
  if (older.length) groups.push({ label: "Older", items: older });
  return groups;
}

export default function ChatListPage() {
  const router = useRouter();
  const { toast } = useShell();
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ items: ConversationItem[]; nextCursor: string | null }>(
        `/api/conversations${debounced ? `?query=${encodeURIComponent(debounced)}` : ""}`
      );
      setItems(d.items);
      setCursor(d.nextCursor);
    } catch {
      toast("Couldn't load conversations");
    } finally {
      setLoading(false);
    }
  }, [debounced, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const d = await api<{ items: ConversationItem[]; nextCursor: string | null }>(
        `/api/conversations?cursor=${encodeURIComponent(cursor)}`
      );
      setItems((prev) => [...prev, ...d.items]);
      setCursor(d.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const act = async (c: ConversationItem, patch: Record<string, unknown>, msg: string) => {
    setMenuFor(null);
    try {
      await api(`/api/conversations/${c.id}`, { method: "PATCH", json: patch });
      toast(msg);
      load();
    } catch {
      toast("Action failed");
    }
  };

  const remove = async (c: ConversationItem) => {
    setMenuFor(null);
    try {
      await api(`/api/conversations/${c.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((p) => p.id !== c.id));
      toast("Conversation deleted");
    } catch {
      toast("Delete failed");
    }
  };

  const groups = useMemo(() => groupByTime(items), [items]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Conversations"
        subtitle="Your history stays on your own server"
        right={
          <Pressable
            onClick={() => router.push("/chat/new")}
            className="grid h-10 w-10 place-items-center rounded-2xl bg-violet text-white shadow-lg shadow-violet/25"
            aria-label="New chat"
          >
            <SquarePen size={18} />
          </Pressable>
        }
      />

      <div className="px-5 pb-3">
        <div className="relative">
          <Search size={15} className="absolute top-1/2 left-4 -translate-y-1/2 text-faint" />
          <input
            className={clsx(inputCls, "pl-10")}
            placeholder="Search conversations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-32 slim-scroll">
        {loading ? (
          <div className="flex justify-center pt-16">
            <Spinner className="h-6 w-6" />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title={debounced ? "No matches" : "No conversations yet"}
            body={
              debounced
                ? `Nothing found for “${debounced}”.`
                : "Every conversation with Aura will appear here, grouped by time."
            }
            action={
              !debounced ? (
                <Pressable
                  onClick={() => router.push("/chat/new")}
                  className="mt-1 flex items-center gap-1.5 rounded-full bg-violet px-4 py-2 text-[12.5px] font-semibold text-white"
                >
                  <Plus size={14} /> New conversation
                </Pressable>
              ) : undefined
            }
          />
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mt-4">
              <p className="mb-2 px-1 text-[11px] font-semibold tracking-[0.14em] text-faint uppercase">
                {g.label}
              </p>
              <div className="overflow-hidden rounded-2xl border border-line bg-card">
                {g.items.map((c, i) => (
                  <div
                    key={c.id}
                    className={clsx("relative", i > 0 && "border-t border-line/60")}
                  >
                    {renaming === c.id ? (
                      <form
                        className="flex items-center gap-2 p-3"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const title = renameText.trim();
                          if (title) await act(c, { title }, "Renamed");
                          setRenaming(null);
                        }}
                      >
                        <input
                          autoFocus
                          className={clsx(inputCls, "py-2 text-[13px]")}
                          value={renameText}
                          onChange={(e) => setRenameText(e.target.value)}
                          maxLength={120}
                        />
                        <Pressable type="submit" className="text-mint" aria-label="Save">
                          <Check size={17} />
                        </Pressable>
                        <Pressable onClick={() => setRenaming(null)} className="text-faint" aria-label="Cancel">
                          <X size={17} />
                        </Pressable>
                      </form>
                    ) : (
                      <div className="flex items-center">
                        <Pressable
                          onClick={() => router.push(`/chat/${c.id}`)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 p-3.5 text-left"
                        >
                          {c.pinned && <Pin size={13} className="shrink-0 text-violet" />}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-medium text-frost">
                              {c.title}
                            </span>
                            <span className="text-[11px] text-faint">{relTime(c.updatedAt)}</span>
                          </span>
                        </Pressable>
                        <Pressable
                          onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}
                          className="mr-2 grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-elev hover:text-mist"
                          aria-label="Conversation options"
                        >
                          <MoreVertical size={15} />
                        </Pressable>
                        {menuFor === c.id && (
                          <motion.div
                            ref={menuRef}
                            initial={{ opacity: 0, scale: 0.92, y: -4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            className="absolute top-11 right-2 z-20 w-44 overflow-hidden rounded-2xl border border-line bg-elev shadow-2xl"
                          >
                            {[
                              {
                                icon: c.pinned ? PinOff : Pin,
                                label: c.pinned ? "Unpin" : "Pin",
                                fn: () => act(c, { pinned: !c.pinned }, c.pinned ? "Unpinned" : "Pinned"),
                              },
                              {
                                icon: Pencil,
                                label: "Rename",
                                fn: () => {
                                  setMenuFor(null);
                                  setRenaming(c.id);
                                  setRenameText(c.title);
                                },
                              },
                              {
                                icon: Archive,
                                label: "Archive",
                                fn: () => act(c, { archived: true }, "Archived"),
                              },
                              {
                                icon: Trash2,
                                label: "Delete",
                                fn: () => remove(c),
                                danger: true,
                              },
                            ].map((a) => (
                              <button
                                key={a.label}
                                onClick={a.fn}
                                className={clsx(
                                  "flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] hover:bg-card",
                                  a.danger ? "text-danger" : "text-frost"
                                )}
                              >
                                <a.icon size={14} /> {a.label}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

        {cursor && !loading && (
          <div className="mt-5 flex justify-center">
            <Pressable
              onClick={loadMore}
              disabled={loadingMore}
              className="flex items-center gap-2 rounded-full border border-line bg-card px-5 py-2.5 text-[12.5px] font-medium text-mist hover:text-frost"
            >
              {loadingMore && <Spinner className="h-3.5 w-3.5" />}
              Load older conversations
            </Pressable>
          </div>
        )}
      </div>
    </div>
  );
}
