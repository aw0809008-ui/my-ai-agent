"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Brain,
  ChevronRight,
  Cpu,
  Download,
  Globe,
  Info,
  LogOut,
  Moon,
  Palette,
  Server,
  ShieldCheck,
  Sun,
  User,
  Volume2,
  BellRing,
} from "lucide-react";
import { useShell } from "@/components/app-shell";
import { Chip, PageHeader, Pressable, Spinner, inputCls } from "@/components/ui";
import { api, clearToken } from "@/lib/client";
import { speak, stopSpeech } from "@/lib/speech";
import clsx from "clsx";

interface AdminStats {
  totals: Record<string, number>;
  byModel?: Record<string, number>;
  byCategory?: Record<string, number>;
  ai: { configured: boolean; reachable: boolean; model: string; provider?: string };
  recentErrors: { tool: string; error: string; at: string }[];
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, settings, ai, patchProfile, toast, refresh } = useShell();
  const [nameDraft, setNameDraft] = useState(user.displayName);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [notifPerm, setNotifPerm] = useState<string>("default");
  const [admin, setAdmin] = useState<AdminStats | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);

  useEffect(() => {
    const timeouts: number[] = [];
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const load = () => setVoices(window.speechSynthesis.getVoices());
      timeouts.push(window.setTimeout(load, 0));
      window.speechSynthesis.onvoiceschanged = load;
    }
    if (typeof Notification !== "undefined") {
      timeouts.push(window.setTimeout(() => setNotifPerm(Notification.permission), 0));
    }
    return () => timeouts.forEach((t) => window.clearTimeout(t));
  }, []);

  useEffect(() => {
    if (user.role !== "admin") return;
    const t = setTimeout(() => {
      setAdminBusy(true);
      api<AdminStats>("/api/admin/stats")
        .then(setAdmin)
        .catch(() => {})
        .finally(() => setAdminBusy(false));
    }, 0);
    return () => clearTimeout(t);
  }, [user.role]);

  const signOut = async () => {
    stopSpeech();
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearToken();
    router.replace("/welcome");
  };

  return (
    <div className="h-full overflow-y-auto pb-36 slim-scroll">
      <PageHeader title="Settings" subtitle="Your AI, your rules" />

      {/* profile */}
      <Section icon={User} title="Profile">
        <div className="grid gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet to-azure font-display text-[16px] font-bold text-white">
              {(user.displayName || user.email)[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold">{user.displayName}</p>
              <p className="truncate text-[12px] text-faint">{user.email}</p>
            </div>
            <span className="ml-auto rounded-full bg-violet/12 px-2.5 py-1 text-[10px] font-bold text-violet uppercase">
              {user.role}
            </span>
          </div>
          <div className="flex gap-2">
            <input
              className={clsx(inputCls, "py-2.5 text-[13px]")}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={80}
              placeholder="Display name"
            />
            <Pressable
              onClick={async () => {
                if (nameDraft.trim()) {
                  await patchProfile({ displayName: nameDraft.trim() });
                  toast("Name updated");
                }
              }}
              className="shrink-0 rounded-2xl bg-violet px-4 text-[13px] font-semibold text-white"
            >
              Save
            </Pressable>
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium tracking-wide text-faint uppercase">
              Timezone
            </span>
            <input
              className={clsx(inputCls, "py-2.5 text-[13px]")}
              defaultValue={user.timezone}
              onBlur={async (e) => {
                const tz = e.target.value.trim();
                if (tz && tz !== user.timezone) {
                  try {
                    await patchProfile({ timezone: tz });
                    toast("Timezone updated");
                  } catch {
                    toast("Invalid timezone");
                  }
                }
              }}
              placeholder="e.g. Asia/Karachi"
            />
          </label>
        </div>
      </Section>

      {/* AI engine */}
      <Section icon={Cpu} title="AI engine">
        <div className="rounded-2xl border border-line bg-abyss p-3.5">
          <div className="flex items-center gap-2.5">
            <span
              className={clsx(
                "h-2 w-2 rounded-full",
                ai.reachable ? "bg-mint" : ai.configured ? "bg-amber" : "bg-danger"
              )}
            />
            <p className="text-[13px] font-semibold">
              {ai.reachable
                ? "Self-hosted model connected"
                : ai.configured
                  ? "Model server unreachable"
                  : "No model server configured"}
            </p>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-mist">
            {ai.reachable ? (
              <>
                Running <span className="font-semibold text-frost">{ai.model}</span> via your own
                AI gateway. Tools, memory and search run on this backend regardless.
              </>
            ) : (
              <>
                Reminders, memory, notes and web search are fully operational. Set
                <code className="mx-1 rounded bg-elev px-1 py-0.5 text-[11px]">AI_BASE_URL</code>
                and
                <code className="mx-1 rounded bg-elev px-1 py-0.5 text-[11px]">AI_MODEL</code>
                on the server to enable open-ended chat (see README → Model setup).
              </>
            )}
          </p>
        </div>
      </Section>

      {/* language */}
      <Section icon={Globe} title="Language">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["en", "English"],
              ["ur", "اردو"],
              ["roman-ur", "Roman Urdu"],
            ] as const
          ).map(([v, label]) => (
            <Chip
              key={v}
              active={user.language === v}
              onClick={async () => {
                await patchProfile({ language: v });
                toast("Language preference saved");
              }}
            >
              {label}
            </Chip>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
          If you write in Roman Urdu, Aura answers in natural Roman Urdu — never auto-converted
          to formal script.
        </p>
      </Section>

      {/* appearance */}
      <Section icon={Palette} title="Appearance">
        <div className="flex gap-1.5">
          {(
            [
              ["dark", Moon, "Dark"],
              ["light", Sun, "Light"],
              ["system", Palette, "System"],
            ] as const
          ).map(([v, Icon, label]) => (
            <Pressable
              key={v}
              onClick={async () => {
                await patchProfile({ theme: v });
                toast(`Theme: ${label}`);
              }}
              className={clsx(
                "flex flex-1 flex-col items-center gap-1.5 rounded-2xl border py-3",
                settings.theme === v
                  ? "border-violet/50 bg-violet/12 text-frost"
                  : "border-line bg-abyss text-mist"
              )}
            >
              <Icon size={16} />
              <span className="text-[11.5px] font-semibold">{label}</span>
            </Pressable>
          ))}
        </div>
      </Section>

      {/* memory */}
      <Section icon={Brain} title="Memory">
        <Row
          label="Long-term memory"
          desc={user.memoryEnabled ? "Aura remembers across conversations" : "Nothing is stored long-term"}
        >
          <Toggle
            on={user.memoryEnabled}
            onChange={async (v) => {
              await patchProfile({ memoryEnabled: v });
              toast(v ? "Memory enabled" : "Memory disabled");
            }}
          />
        </Row>
        <Pressable
          onClick={() => router.push("/memory")}
          className="mt-1 flex w-full items-center justify-between rounded-2xl border border-line bg-abyss px-4 py-3 text-left"
        >
          <span className="text-[13px] font-medium">Inspect & erase memories</span>
          <ChevronRight size={15} className="text-faint" />
        </Pressable>
      </Section>

      {/* voice */}
      <Section icon={Volume2} title="Voice">
        <Row label="Text-to-speech" desc="Let Aura read replies aloud (browser voices)">
          <Toggle
            on={Boolean(settings.voice?.enabled)}
            onChange={async (v) => {
              await patchProfile({ voice: { enabled: v } });
              if (!v) stopSpeech();
            }}
          />
        </Row>
        <Row label="Auto-play replies" desc="Speak every assistant reply automatically" muted={!settings.voice?.enabled}>
          <Toggle
            on={Boolean(settings.voice?.autoplay)}
            onChange={async (v) => patchProfile({ voice: { autoplay: v } })}
          />
        </Row>
        <div className="mt-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12.5px] text-mist">Speed</span>
            <span className="text-[12px] font-semibold text-violet">
              {(settings.voice?.rate ?? 1).toFixed(1)}×
            </span>
          </div>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={settings.voice?.rate ?? 1}
            onChange={(e) => patchProfile({ voice: { rate: parseFloat(e.target.value) } })}
            className="w-full accent-violet"
            disabled={!settings.voice?.enabled}
          />
        </div>
        {voices.length > 0 && (
          <select
            className={clsx(inputCls, "mt-2 py-2.5 text-[13px]")}
            value={settings.voice?.voiceName ?? ""}
            onChange={(e) => patchProfile({ voice: { voiceName: e.target.value } })}
            disabled={!settings.voice?.enabled}
          >
            <option value="">System default voice</option>
            {voices.slice(0, 40).map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        )}
        <Pressable
          onClick={() =>
            speak("Salam! This is Aura, your personal AI, running on your own server.", {
              rate: settings.voice?.rate,
              voiceName: settings.voice?.voiceName,
            })
          }
          disabled={!settings.voice?.enabled}
          className="mt-2 rounded-full border border-violet/40 bg-violet/10 px-4 py-2 text-[12px] font-semibold text-violet"
        >
          Test voice
        </Pressable>
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Aura never speaks unless enabled here. A self-hosted TTS engine can be attached via the
          gateway for higher-quality voices.
        </p>
      </Section>

      {/* notifications */}
      <Section icon={BellRing} title="Notifications">
        <Row
          label="Reminder alerts"
          desc={`Browser permission: ${notifPerm}`}
        >
          <Toggle
            on={settings.notifications?.enabled !== false}
            onChange={async (v) => {
              await patchProfile({ notifications: { enabled: v } });
              if (v && typeof Notification !== "undefined" && Notification.permission === "default") {
                const p = await Notification.requestPermission();
                setNotifPerm(p);
              }
            }}
          />
        </Row>
        {notifPerm === "denied" && (
          <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-amber">
            <AlertTriangle size={12} /> Notifications are blocked in browser settings. In-app
            banners still work.
          </p>
        )}
      </Section>

      {/* privacy & data */}
      <Section icon={ShieldCheck} title="Privacy & Data">
        <Pressable
          onClick={() => {
            window.location.href = "/api/export";
            toast("Preparing your data export");
          }}
          className="flex w-full items-center gap-3 rounded-2xl border border-line bg-abyss px-4 py-3 text-left"
        >
          <Download size={15} className="text-violet" />
          <span className="flex-1 text-[13px] font-medium">Export all my data (JSON)</span>
          <ChevronRight size={15} className="text-faint" />
        </Pressable>
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
          Everything lives in your own PostgreSQL database — conversations, memories, notes,
          reminders, files. Nothing is sent to third-party AI providers.
        </p>
      </Section>

      {/* admin */}
      {user.role === "admin" && (
        <Section icon={Activity} title="System (admin)">
          {adminBusy ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : admin ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["Users", admin.totals.users],
                  ["Active 24h", admin.totals.activeUsers24h],
                  ["AI req 24h", admin.totals.aiRequests24h],
                  ["Chats", admin.totals.conversations],
                  ["Messages", admin.totals.messages],
                  ["Memories", admin.totals.memories],
                  ["Notes", admin.totals.notes],
                  ["Reminders", admin.totals.reminders],
                  ["Storage KB", Math.round(admin.totals.storageBytes / 1024)],
                ].map(([label, v]) => (
                  <div key={label as string} className="rounded-2xl border border-line bg-abyss p-3 text-center">
                    <p className="font-display text-[17px] font-bold text-frost">{v}</p>
                    <p className="mt-0.5 text-[10px] tracking-wide text-faint uppercase">{label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-2xl border border-line bg-abyss p-3.5">
                <div className="flex items-center gap-2">
                  <Server size={14} className="text-violet" />
                  <p className="text-[12.5px] font-semibold">Model server</p>
                  <span
                    className={clsx(
                      "ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                      admin.ai.reachable ? "bg-mint/15 text-mint" : "bg-danger/15 text-danger"
                    )}
                  >
                    {admin.ai.reachable ? "online" : "offline"}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] text-mist">
                  {admin.ai.configured
                    ? `${admin.ai.provider === "openrouter" ? "OpenRouter" : "Self-hosted"} · ${admin.ai.model}`
                    : "No model gateway configured"}
                </p>
                <p className="mt-1 text-[11.5px] text-mist">
                  Tool calls: {admin.totals.toolCallsOk} ok · {admin.totals.toolCallsError} errors
                  {" · "}Fallbacks 24h: {admin.totals.fallbacks24h ?? 0}
                  {" · "}Avg latency: {Math.round((admin.totals.avgLatencyMs24h ?? 0) / 1000)}s
                  {" · "}Web searches 24h: {admin.totals.webSearches24h ?? 0}
                </p>
              </div>
              {admin.byModel && Object.keys(admin.byModel).length > 0 && (
                <div className="mt-2 rounded-2xl border border-line bg-abyss p-3.5">
                  <p className="mb-2 text-[11.5px] font-semibold text-mist">
                    Requests by model (24h)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(admin.byModel)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 8)
                      .map(([model, count]) => (
                        <span
                          key={model}
                          className="rounded-full border border-violet/25 bg-violet/10 px-2.5 py-1 text-[10.5px] font-semibold text-violet"
                        >
                          {model}: {count}
                        </span>
                      ))}
                  </div>
                </div>
              )}
              {admin.recentErrors.length > 0 && (
                <div className="mt-2 rounded-2xl border border-danger/25 bg-danger/5 p-3.5">
                  <p className="mb-1.5 text-[11.5px] font-semibold text-danger">Recent tool errors</p>
                  {admin.recentErrors.map((e, i) => (
                    <p key={i} className="truncate text-[11px] text-mist">
                      {e.tool}: {e.error}
                    </p>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-[12px] text-faint">Stats unavailable.</p>
          )}
        </Section>
      )}

      {/* about */}
      <Section icon={Info} title="About">
        <div className="rounded-2xl border border-line bg-abyss p-4">
          <p className="font-display text-[13.5px] font-semibold">
            aura <span className="text-faint">v0.1.0</span>
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist">
            Self-hosted personal AI platform. App → your backend → your AI gateway → your GPU
            server running open-source models (vLLM / Ollama / llama.cpp). No external
            proprietary AI APIs anywhere.
          </p>
        </div>
      </Section>

      <div className="px-5">
        <Pressable
          onClick={signOut}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 py-3.5 text-[14px] font-semibold text-danger"
        >
          <LogOut size={15} /> Sign out
        </Pressable>
        <p className="mt-4 text-center text-[10.5px] text-faint">
          Your data stays on infrastructure you control.
        </p>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof User;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-4 px-5">
      <div className="mb-2 flex items-center gap-2 px-1">
        <Icon size={13} className="text-violet" />
        <h2 className="text-[11.5px] font-semibold tracking-[0.14em] text-mist uppercase">
          {title}
        </h2>
      </div>
      <div className="rounded-3xl border border-line bg-card p-4">{children}</div>
    </section>
  );
}

function Row({
  label,
  desc,
  children,
  muted,
}: {
  label: string;
  desc: string;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className={clsx("flex items-center justify-between gap-3 py-1.5", muted && "opacity-40")}>
      <div>
        <p className="text-[13.5px] font-medium">{label}</p>
        <p className="text-[11.5px] text-faint">{desc}</p>
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={clsx(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        on ? "bg-violet" : "bg-line"
      )}
      aria-pressed={on}
    >
      <span
        className={clsx(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
          on ? "left-[22px]" : "left-0.5"
        )}
      />
    </button>
  );
}
