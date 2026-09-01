"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArchiveRestore,
  Brain,
  Loader2,
  NotebookPen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { useShell } from "@/components/app-shell";
import {
  Chip,
  EmptyState,
  Field,
  PageHeader,
  Pressable,
  Sheet,
  inputCls,
} from "@/components/ui";
import { api, relTime, type MemoryItem, type NoteItem } from "@/lib/client";
import clsx from "clsx";

const CATS = ["personal", "preferences", "work", "projects", "important", "temporary"];

const CAT_COLORS: Record<string, string> = {
  personal: "text-cyan bg-cyan/10 border-cyan/20",
  preferences: "text-violet bg-violet/10 border-violet/25",
  work: "text-azure bg-azure/10 border-azure/25",
  projects: "text-mint bg-mint/10 border-mint/25",
  important: "text-amber bg-amber/10 border-amber/25",
  temporary: "text-mist bg-elev border-line",
};

export default function MemoryPage() {
  const { user, patchProfile, toast } = useShell();
  const [tab, setTab] = useState<"memories" | "notes">("memories");

  // ---------------- memories state ----------------
  const [mems, setMems] = useState<MemoryItem[]>([]);
  const [memQuery, setMemQuery] = useState("");
  const [cat, setCat] = useState("");
  const [memLoading, setMemLoading] = useState(true);
  const [memSheet, setMemSheet] = useState<{ mode: "add" } | { mode: "edit"; m: MemoryItem } | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  // ---------------- notes state ----------------
  const [notesList, setNotesList] = useState<NoteItem[]>([]);
  const [noteQuery, setNoteQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [notesLoading, setNotesLoading] = useState(true);
  const [noteSheet, setNoteSheet] = useState<{ mode: "add" } | { mode: "edit"; n: NoteItem } | null>(null);

  const loadMems = useCallback(async (q = "", category = "") => {
    setMemLoading(true);
    try {
      const p = new URLSearchParams();
      if (q) p.set("query", q);
      if (category) p.set("category", category);
      const d = await api<{ items: MemoryItem[] }>(`/api/memories?${p}`);
      setMems(d.items);
    } finally {
      setMemLoading(false);
    }
  }, []);

  const loadNotes = useCallback(async (q = "", archived = false) => {
    setNotesLoading(true);
    try {
      const p = new URLSearchParams();
      if (q) p.set("query", q);
      if (archived) p.set("archived", "true");
      const d = await api<{ items: NoteItem[] }>(`/api/notes?${p}`);
      setNotesList(d.items);
    } finally {
      setNotesLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadMems(memQuery.trim(), cat), 280);
    return () => clearTimeout(t);
  }, [memQuery, cat, loadMems]);

  useEffect(() => {
    const t = setTimeout(() => loadNotes(noteQuery.trim(), showArchived), 280);
    return () => clearTimeout(t);
  }, [noteQuery, showArchived, loadNotes]);

  // ---------------- memory actions ----------------
  const saveMemory = async (content: string, category: string, id?: string) => {
    try {
      if (id) await api(`/api/memories/${id}`, { method: "PATCH", json: { content, category } });
      else await api("/api/memories", { method: "POST", json: { content, category } });
      toast(id ? "Memory updated" : "Memory saved");
      setMemSheet(null);
      loadMems(memQuery, cat);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const deleteMemory = async (id: string) => {
    await api(`/api/memories/${id}`, { method: "DELETE" }).catch(() => {});
    setMems((prev) => prev.filter((m) => m.id !== id));
    toast("Memory deleted");
  };

  const wipeAll = async () => {
    await api("/api/memories", { method: "DELETE" }).catch(() => {});
    setMems([]);
    setConfirmWipe(false);
    toast("All memories erased");
  };

  // ---------------- note actions ----------------
  const saveNote = async (title: string, content: string, id?: string) => {
    try {
      if (id) await api(`/api/notes/${id}`, { method: "PATCH", json: { title, content } });
      else await api("/api/notes", { method: "POST", json: { title, content } });
      toast(id ? "Note updated" : "Note saved");
      setNoteSheet(null);
      loadNotes(noteQuery, showArchived);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const noteAction = async (n: NoteItem, patch: Record<string, unknown>, msg: string) => {
    await api(`/api/notes/${n.id}`, { method: "PATCH", json: patch }).catch(() => {});
    toast(msg);
    loadNotes(noteQuery, showArchived);
  };

  const deleteNote = async (id: string) => {
    await api(`/api/notes/${id}`, { method: "DELETE" }).catch(() => {});
    setNotesList((prev) => prev.filter((n) => n.id !== id));
    toast("Note deleted");
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Memory & Notes"
        subtitle="Everything Aura knows — inspectable and erasable"
        right={
          <Pressable
            onClick={() => (tab === "memories" ? setMemSheet({ mode: "add" }) : setNoteSheet({ mode: "add" }))}
            className="grid h-10 w-10 place-items-center rounded-2xl bg-violet text-white shadow-lg shadow-violet/25"
            aria-label="Add"
          >
            <Plus size={18} />
          </Pressable>
        }
      />

      {/* segmented */}
      <div className="px-5">
        <div className="grid grid-cols-2 gap-1 rounded-2xl border border-line bg-card p-1">
          {(["memories", "notes"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                "relative rounded-xl py-2 text-[13px] font-semibold capitalize transition-colors",
                tab === t ? "text-frost" : "text-faint hover:text-mist"
              )}
            >
              {tab === t && (
                <motion.span
                  layoutId="mem-tab"
                  className="absolute inset-0 rounded-xl bg-elev"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <span className="relative flex items-center justify-center gap-1.5">
                {t === "memories" ? <Brain size={14} /> : <NotebookPen size={14} />}
                {t}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* memory master switch */}
      {tab === "memories" && (
        <div className="mt-3 px-5">
          <div className="flex items-center justify-between rounded-2xl border border-line bg-card px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Sparkles size={15} className={user.memoryEnabled ? "text-violet" : "text-faint"} />
              <span className="text-[13px] font-medium">
                Long-term memory {user.memoryEnabled ? "on" : "off"}
              </span>
            </div>
            <button
              onClick={() => {
                patchProfile({ memoryEnabled: !user.memoryEnabled });
                toast(user.memoryEnabled ? "Memory disabled — nothing new will be stored" : "Memory enabled");
              }}
              className={clsx(
                "relative h-6 w-11 rounded-full transition-colors",
                user.memoryEnabled ? "bg-violet" : "bg-line"
              )}
              aria-label="Toggle memory"
            >
              <span
                className={clsx(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                  user.memoryEnabled ? "left-[22px]" : "left-0.5"
                )}
              />
            </button>
          </div>
        </div>
      )}

      {/* search */}
      <div className="px-5 pt-3 pb-2">
        <div className="relative">
          <Search size={15} className="absolute top-1/2 left-4 -translate-y-1/2 text-faint" />
          <input
            className={clsx(inputCls, "pl-10")}
            placeholder={tab === "memories" ? "Semantic search memories…" : "Search notes…"}
            value={tab === "memories" ? memQuery : noteQuery}
            onChange={(e) =>
              tab === "memories" ? setMemQuery(e.target.value) : setNoteQuery(e.target.value)
            }
          />
        </div>
      </div>

      {/* category filter (memories) */}
      {tab === "memories" && (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-5 pb-1">
          <Chip active={cat === ""} onClick={() => setCat("")}>
            All
          </Chip>
          {CATS.map((c) => (
            <Chip key={c} active={cat === c} onClick={() => setCat(cat === c ? "" : c)}>
              {c}
            </Chip>
          ))}
        </div>
      )}
      {tab === "notes" && (
        <div className="px-5 pb-1">
          <Chip active={showArchived} onClick={() => setShowArchived((s) => !s)}>
            <span className="flex items-center gap-1.5">
              <Archive size={12} /> Archived
            </span>
          </Chip>
        </div>
      )}

      {/* lists */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-32 slim-scroll">
        {tab === "memories" ? (
          memLoading ? (
            <div className="flex justify-center pt-14">
              <Loader2 className="animate-spin text-violet" size={22} />
            </div>
          ) : mems.length === 0 ? (
            <EmptyState
              icon={Brain}
              title={memQuery || cat ? "Nothing found" : "No memories yet"}
              body={
                user.memoryEnabled
                  ? "Tell Aura: “Remember that I prefer morning meetings.” You can view, edit, or erase anything here."
                  : "Memory is currently disabled, so Aura stores nothing long-term."
              }
            />
          ) : (
            <div className="mt-2 grid gap-2.5">
              {mems.map((m, i) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  className="rounded-2xl border border-line bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="flex-1 text-[13.5px] leading-relaxed text-frost">{m.content}</p>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span
                      className={clsx(
                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                        CAT_COLORS[m.category] ?? CAT_COLORS.personal
                      )}
                    >
                      {m.category}
                    </span>
                    <span className="flex items-center gap-0.5 text-faint">
                      {Array.from({ length: m.importance }).map((_, s) => (
                        <Star key={s} size={9} className="fill-amber/60 text-amber/60" />
                      ))}
                    </span>
                    <span className="ml-auto text-[10.5px] text-faint">{relTime(m.updatedAt)}</span>
                    <Pressable
                      onClick={() => setMemSheet({ mode: "edit", m })}
                      className="grid h-7 w-7 place-items-center rounded-full text-faint hover:bg-elev hover:text-frost"
                      aria-label="Edit memory"
                    >
                      <Pencil size={12.5} />
                    </Pressable>
                    <Pressable
                      onClick={() => deleteMemory(m.id)}
                      className="grid h-7 w-7 place-items-center rounded-full text-faint hover:bg-danger/10 hover:text-danger"
                      aria-label="Delete memory"
                    >
                      <Trash2 size={12.5} />
                    </Pressable>
                  </div>
                </motion.div>
              ))}
              {mems.length > 0 && (
                <div className="mt-2 flex justify-center">
                  {confirmWipe ? (
                    <div className="flex items-center gap-2 rounded-full border border-danger/40 bg-danger/10 px-4 py-2">
                      <span className="text-[12px] text-danger">Erase all memories?</span>
                      <Pressable onClick={wipeAll} className="text-[12px] font-bold text-danger">
                        Confirm
                      </Pressable>
                      <Pressable onClick={() => setConfirmWipe(false)} className="text-[12px] text-mist">
                        Cancel
                      </Pressable>
                    </div>
                  ) : (
                    <Pressable
                      onClick={() => setConfirmWipe(true)}
                      className="rounded-full border border-line px-4 py-2 text-[12px] font-medium text-faint hover:text-danger"
                    >
                      Erase all memories
                    </Pressable>
                  )}
                </div>
              )}
            </div>
          )
        ) : notesLoading ? (
          <div className="flex justify-center pt-14">
            <Loader2 className="animate-spin text-violet" size={22} />
          </div>
        ) : notesList.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title={noteQuery ? "No notes found" : showArchived ? "No archived notes" : "No notes yet"}
            body="Say “Create a note: …” in chat, or tap + to write one."
            action={
              <Pressable
                onClick={() => setNoteSheet({ mode: "add" })}
                className="mt-1 flex items-center gap-1.5 rounded-full bg-violet px-4 py-2 text-[12.5px] font-semibold text-white"
              >
                <Plus size={14} /> New note
              </Pressable>
            }
          />
        ) : (
          <div className="mt-2 grid gap-2.5">
            {notesList.map((n, i) => (
              <motion.div
                key={n.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
                className={clsx(
                  "rounded-2xl border bg-card p-4",
                  n.pinned ? "border-violet/30" : "border-line"
                )}
              >
                <div className="flex items-start gap-2">
                  {n.pinned && <Pin size={12} className="mt-1 shrink-0 text-violet" />}
                  <p className="flex-1 font-display text-[14.5px] font-semibold">{n.title}</p>
                </div>
                {n.content && (
                  <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed whitespace-pre-wrap text-mist">
                    {n.content}
                  </p>
                )}
                <div className="mt-3 flex items-center gap-1.5">
                  <span className="text-[10.5px] text-faint">{relTime(n.updatedAt)}</span>
                  <span className="ml-auto" />
                  <Pressable
                    onClick={() => noteAction(n, { pinned: !n.pinned }, n.pinned ? "Unpinned" : "Pinned")}
                    className="grid h-7 w-7 place-items-center rounded-full text-faint hover:bg-elev hover:text-violet"
                    aria-label={n.pinned ? "Unpin" : "Pin"}
                  >
                    {n.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                  </Pressable>
                  <Pressable
                    onClick={() =>
                      noteAction(n, { archived: !n.archived }, n.archived ? "Restored" : "Archived")
                    }
                    className="grid h-7 w-7 place-items-center rounded-full text-faint hover:bg-elev hover:text-frost"
                    aria-label={n.archived ? "Unarchive" : "Archive"}
                  >
                    {n.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                  </Pressable>
                  <Pressable
                    onClick={() => setNoteSheet({ mode: "edit", n })}
                    className="grid h-7 w-7 place-items-center rounded-full text-faint hover:bg-elev hover:text-frost"
                    aria-label="Edit note"
                  >
                    <Pencil size={13} />
                  </Pressable>
                  <Pressable
                    onClick={() => deleteNote(n.id)}
                    className="grid h-7 w-7 place-items-center rounded-full text-faint hover:bg-danger/10 hover:text-danger"
                    aria-label="Delete note"
                  >
                    <Trash2 size={13} />
                  </Pressable>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* memory sheet */}
      <Sheet
        open={memSheet !== null}
        onClose={() => setMemSheet(null)}
        title={memSheet?.mode === "edit" ? "Edit memory" : "Add memory"}
      >
        {memSheet && (
          <MemoryForm
            initial={memSheet.mode === "edit" ? memSheet.m : null}
            onSave={saveMemory}
          />
        )}
      </Sheet>

      {/* note sheet */}
      <Sheet
        open={noteSheet !== null}
        onClose={() => setNoteSheet(null)}
        title={noteSheet?.mode === "edit" ? "Edit note" : "New note"}
      >
        {noteSheet && (
          <NoteForm initial={noteSheet.mode === "edit" ? noteSheet.n : null} onSave={saveNote} />
        )}
      </Sheet>
    </div>
  );
}

function MemoryForm({
  initial,
  onSave,
}: {
  initial: MemoryItem | null;
  onSave: (content: string, category: string, id?: string) => Promise<void>;
}) {
  const [content, setContent] = useState(initial?.content ?? "");
  const [category, setCategory] = useState(initial?.category ?? "personal");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!content.trim()) return;
        setBusy(true);
        await onSave(content.trim(), category, initial?.id);
        setBusy(false);
      }}
    >
      <Field label="Memory">
        <textarea
          className={clsx(inputCls, "min-h-[100px] resize-none")}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="e.g. I prefer concise responses in Roman Urdu"
          maxLength={1000}
          autoFocus
        />
      </Field>
      <Field label="Category">
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {["personal", "preferences", "work", "projects", "important", "temporary"].map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </div>
      </Field>
      <Pressable
        type="submit"
        disabled={busy || !content.trim()}
        className="flex items-center justify-center gap-2 rounded-2xl bg-violet py-3.5 text-[14px] font-semibold text-white hover:bg-iris"
      >
        {busy && <Loader2 size={15} className="animate-spin" />}
        {initial ? "Save changes" : "Save memory"}
      </Pressable>
    </form>
  );
}

function NoteForm({
  initial,
  onSave,
}: {
  initial: NoteItem | null;
  onSave: (title: string, content: string, id?: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        await onSave(title.trim(), content, initial?.id);
        setBusy(false);
      }}
    >
      <Field label="Title">
        <input
          className={inputCls}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Note title"
          maxLength={200}
          autoFocus
        />
      </Field>
      <Field label="Content">
        <textarea
          className={clsx(inputCls, "min-h-[160px] resize-none")}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write it down…"
        />
      </Field>
      <Pressable
        type="submit"
        disabled={busy || !title.trim()}
        className="flex items-center justify-center gap-2 rounded-2xl bg-violet py-3.5 text-[14px] font-semibold text-white hover:bg-iris"
      >
        {busy && <Loader2 size={15} className="animate-spin" />}
        {initial ? "Save changes" : "Create note"}
      </Pressable>
    </form>
  );
}
