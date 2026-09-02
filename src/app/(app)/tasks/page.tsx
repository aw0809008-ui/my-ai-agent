"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  AlarmClockCheck,
  AlarmClockOff,
  BellRing,
  Check,
  Clock,
  Loader2,
  MessageSquarePlus,
  Plus,
  RefreshCcw,
  Trash2,
  Undo2,
  Zap,
} from "lucide-react";
import { useShell } from "@/components/app-shell";
import { Chip, EmptyState, Field, PageHeader, Pressable, Sheet, inputCls } from "@/components/ui";
import { api, formatReminderTime, type ReminderItem } from "@/lib/client";
import clsx from "clsx";

export default function TasksPage() {
  const router = useRouter();
  const { toast, user } = useShell();
  const [items, setItems] = useState<ReminderItem[]>([]);
  const [doneItems, setDoneItems] = useState<ReminderItem[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [snoozeFor, setSnoozeFor] = useState<ReminderItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ items: ReminderItem[] }>("/api/reminders?scope=upcoming");
      setItems(d.items);
      if (showDone) {
        const dd = await api<{ items: ReminderItem[] }>("/api/reminders?scope=done");
        setDoneItems(dd.items);
      }
    } finally {
      setLoading(false);
    }
  }, [showDone]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (r: ReminderItem, json: Record<string, unknown>, msg: string) => {
    try {
      await api(`/api/reminders/${r.id}`, { method: "PATCH", json });
      toast(msg);
      setSnoozeFor(null);
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const remove = async (r: ReminderItem) => {
    await api(`/api/reminders/${r.id}`, { method: "DELETE" }).catch(() => {});
    setItems((prev) => prev.filter((p) => p.id !== r.id));
    toast("Reminder deleted");
  };

  const overdue = items.filter((r) => r.overdue);
  const upcoming = items.filter((r) => !r.overdue);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Tasks & Reminders"
        subtitle={`Times shown in ${user.timezone}`}
        right={
          <Pressable
            onClick={() => setSheetOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-2xl bg-violet text-white shadow-lg shadow-violet/25"
            aria-label="New reminder"
          >
            <Plus size={18} />
          </Pressable>
        }
      />

      <div className="px-5 pb-2">
        <div className="flex gap-1.5">
          <Chip active={!showDone} onClick={() => setShowDone(false)}>
            Upcoming
          </Chip>
          <Chip active={showDone} onClick={() => setShowDone(true)}>
            Completed
          </Chip>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-32 slim-scroll lg:pb-14 lg:px-8">
        <div className="lg:mx-auto lg:w-full lg:max-w-[780px]">
        {loading ? (
          <div className="flex justify-center pt-14">
            <Loader2 className="animate-spin text-violet" size={22} />
          </div>
        ) : !showDone ? (
          items.length === 0 ? (
            <EmptyState
              icon={AlarmClockCheck}
              title="No upcoming reminders"
              body="The fastest way to create one is Chat — just say “Remind me Friday at 8 PM to publish the listing”. Manage them here afterwards."
              action={
                <div className="mt-1 flex flex-wrap justify-center gap-2">
                  <Pressable
                    onClick={() =>
                      router.push(
                        `/chat/new?q=${encodeURIComponent("Remind me tomorrow at 9 AM to ")}`
                      )
                    }
                    className="flex items-center gap-1.5 rounded-full bg-violet px-4 py-2 text-[12.5px] font-semibold text-white"
                  >
                    <MessageSquarePlus size={14} /> Create from Chat
                  </Pressable>
                  <Pressable
                    onClick={() => setSheetOpen(true)}
                    className="flex items-center gap-1.5 rounded-full border border-line bg-card px-4 py-2 text-[12.5px] font-semibold text-mist"
                  >
                    <Plus size={14} /> Add manually
                  </Pressable>
                </div>
              }
            />
          ) : (
            <>
              {overdue.length > 0 && (
                <Section label="Due now" accent="text-amber">
                  {overdue.map((r) => (
                    <ReminderCard
                      key={r.id}
                      r={r}
                      onDone={() => act(r, { action: "done" }, "Done — nice")}
                      onSnooze={() => setSnoozeFor(r)}
                      onDelete={() => remove(r)}
                    />
                  ))}
                </Section>
              )}
              {upcoming.length > 0 && (
                <Section label="Upcoming" accent="text-violet">
                  {upcoming.map((r) => (
                    <ReminderCard
                      key={r.id}
                      r={r}
                      onDone={() => act(r, { action: "done" }, "Done early")}
                      onSnooze={() => setSnoozeFor(r)}
                      onDelete={() => remove(r)}
                    />
                  ))}
                </Section>
              )}
            </>
          )
        ) : doneItems.length === 0 ? (
          <EmptyState
            icon={Check}
            title="Nothing completed yet"
            body="Finished reminders land here."
          />
        ) : (
          <Section label="Completed" accent="text-mint">
            {doneItems.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-2xl border border-line bg-card p-4"
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mint/15 text-mint">
                  <Check size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] text-mist line-through">{r.task}</p>
                  <p className="text-[11px] text-faint">
                    {formatReminderTime(r.dueAt, r.timezone)}
                  </p>
                </div>
                <Pressable
                  onClick={() => act(r, { action: "reopen" }, "Reopened")}
                  className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-elev hover:text-frost"
                  aria-label="Reopen"
                >
                  <Undo2 size={14} />
                </Pressable>
                <Pressable
                  onClick={() => remove(r)}
                  className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-danger/10 hover:text-danger"
                  aria-label="Delete"
                >
                  <Trash2 size={14} />
                </Pressable>
              </div>
            ))}
          </Section>
        )}
        </div>
      </div>

      {/* new reminder sheet */}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="New reminder">
        <ReminderForm
          onSaved={() => {
            setSheetOpen(false);
            load();
          }}
        />
      </Sheet>

      {/* snooze sheet */}
      <Sheet open={snoozeFor !== null} onClose={() => setSnoozeFor(null)} title="Snooze">
        {snoozeFor && (
          <div className="grid gap-2">
            {[
              { label: "10 minutes", mins: 10 },
              { label: "1 hour", mins: 60 },
              { label: "3 hours", mins: 180 },
              { label: "Tomorrow morning", mins: 0 },
            ].map((o) => (
              <Pressable
                key={o.label}
                onClick={() =>
                  o.mins === 0
                    ? act(
                        snoozeFor,
                        {
                          dueAt: new Date(
                            new Date().setHours(24 + 9, 0, 0, 0)
                          ).toISOString(),
                        },
                        "Snoozed to tomorrow 9:00"
                      )
                    : act(snoozeFor, { action: "snooze", snoozeMinutes: o.mins }, `Snoozed ${o.label}`)
                }
                className="flex items-center gap-3 rounded-2xl border border-line bg-card p-4 text-left hover:border-violet/40"
              >
                <Clock size={16} className="text-violet" />
                <span className="text-[14px] font-medium">{o.label}</span>
              </Pressable>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}

function Section({
  label,
  accent,
  children,
}: {
  label: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <p className={clsx("mb-2 px-1 text-[11px] font-semibold tracking-[0.14em] uppercase", accent)}>
        {label}
      </p>
      <div className="grid gap-2.5">{children}</div>
    </div>
  );
}

function ReminderCard({
  r,
  onDone,
  onSnooze,
  onDelete,
}: {
  r: ReminderItem;
  onDone: () => void;
  onSnooze: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        "rounded-2xl border bg-card p-4",
        r.overdue ? "border-amber/30" : "border-line"
      )}
    >
      <div className="flex items-start gap-3">
        <Pressable
          onClick={onDone}
          className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-violet/50 text-transparent transition-all hover:bg-violet/15 hover:text-violet"
          aria-label="Mark done"
        >
          <Check size={13} strokeWidth={3} />
        </Pressable>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-snug font-medium text-frost">{r.task}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span
              className={clsx(
                "flex items-center gap-1 text-[11.5px] font-medium",
                r.overdue ? "text-amber" : "text-mist"
              )}
            >
              {r.overdue ? <BellRing size={11.5} /> : <Clock size={11.5} />}
              {formatReminderTime(r.dueAt, r.timezone)}
            </span>
            {r.recurrence !== "none" && (
              <span className="flex items-center gap-1 rounded-full bg-violet/12 px-2 py-0.5 text-[10px] font-semibold text-violet uppercase">
                <RefreshCcw size={9} /> {r.recurrence}
              </span>
            )}
            {r.overdue && (
              <span className="flex items-center gap-1 rounded-full bg-amber/12 px-2 py-0.5 text-[10px] font-semibold text-amber uppercase">
                <Zap size={9} /> due
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Pressable
            onClick={onSnooze}
            className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-elev hover:text-amber"
            aria-label="Snooze"
          >
            <AlarmClockOff size={14} />
          </Pressable>
          <Pressable
            onClick={onDelete}
            className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-danger/10 hover:text-danger"
            aria-label="Delete"
          >
            <Trash2 size={14} />
          </Pressable>
        </div>
      </div>
    </motion.div>
  );
}

function ReminderForm({ onSaved }: { onSaved: () => void }) {
  const { toast } = useShell();
  const [task, setTask] = useState("");
  const [when, setWhen] = useState("");
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly">("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await api("/api/reminders", {
            method: "POST",
            json: { task: task.trim(), when: when.trim(), recurrence },
          });
          toast("Reminder created");
          onSaved();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Task">
        <input
          className={inputCls}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Call Ali"
          maxLength={300}
          required
          autoFocus
        />
      </Field>
      <Field label="When (plain language)">
        <input
          className={inputCls}
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          placeholder="tomorrow at 9am · in 2 hours · friday 5pm"
          required
        />
      </Field>
      <Field label="Repeats">
        <div className="flex gap-1.5 pt-0.5">
          {(["none", "daily", "weekly"] as const).map((r) => (
            <Chip key={r} active={recurrence === r} onClick={() => setRecurrence(r)}>
              {r === "none" ? "Once" : r}
            </Chip>
          ))}
        </div>
      </Field>
      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[12.5px] text-danger">
          {error}
        </p>
      )}
      <Pressable
        type="submit"
        disabled={busy}
        className="flex items-center justify-center gap-2 rounded-2xl bg-violet py-3.5 text-[14px] font-semibold text-white hover:bg-iris"
      >
        {busy && <Loader2 size={15} className="animate-spin" />}
        Create reminder
      </Pressable>
    </form>
  );
}
