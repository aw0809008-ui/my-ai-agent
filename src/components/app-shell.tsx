"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { BellRing, Check, Clock, X } from "lucide-react";
import clsx from "clsx";
import { Orb } from "@/components/orb";
import { Sidebar } from "@/components/sidebar";
import { TabBar } from "@/components/tab-bar";
import { Pressable } from "@/components/ui";
import { api, clearToken, type AiHealth, type ApiUser, type UserSettings } from "@/lib/client";

interface ShellCtx {
  user: ApiUser;
  settings: UserSettings;
  ai: AiHealth;
  refresh: () => Promise<void>;
  patchProfile: (body: Record<string, unknown>) => Promise<void>;
  toast: (msg: string) => void;
  /** open the mobile navigation drawer */
  openNav: () => void;
}

const Ctx = createContext<ShellCtx | null>(null);

export function useShell(): ShellCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShell must be used inside AppShell");
  return v;
}

interface DueReminder {
  id: string;
  task: string;
  dueAt: string;
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<ApiUser | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [ai, setAi] = useState<AiHealth>({ configured: false, reachable: false, model: "" });
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [due, setDue] = useState<DueReminder[]>([]);
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{
        user: ApiUser;
        settings: UserSettings | null;
        ai: AiHealth;
      }>("/api/auth/me");
      setUser(data.user);
      setSettings(
        data.settings ?? {
          theme: "dark",
          voice: { enabled: false, autoplay: false, rate: 1, voiceName: "" },
          notifications: { enabled: true, sound: true },
          ai: { style: "balanced", modelPreference: "auto" },
        }
      );
      setAi(data.ai ?? { configured: false, reachable: false, model: "" });
      if (!data.user.onboardingDone) router.replace("/onboarding");
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        clearToken();
        router.replace("/welcome");
      } else setError("Couldn't reach the server. Check your connection and retry.");
    }
  }, [router]);

  useEffect(() => {
    // defer the first fetch so no setState runs synchronously inside the effect
    const t = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  // apply theme
  useEffect(() => {
    if (!settings) return;
    let t = settings.theme ?? "dark";
    localStorage.setItem("aura-theme", t);
    if (t === "system")
      t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.documentElement.dataset.theme = t;
  }, [settings?.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 3200);
  }, []);

  const openNav = useCallback(() => setNavOpen(true), []);

  // restore sidebar collapse preference
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setCollapsed(localStorage.getItem("aura-sidebar") === "collapsed");
      } catch {
        /* storage blocked */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("aura-sidebar", next ? "collapsed" : "expanded");
      } catch {
        /* storage blocked */
      }
      return next;
    });
  }, []);

  const patchProfile = useCallback(
    async (body: Record<string, unknown>) => {
      await api("/api/auth/profile", { method: "PATCH", json: body });
      await load();
    },
    [load]
  );

  // ---- reminder notification poller (real local notifications) -----------
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const poll = async () => {
      try {
        const data = await api<{ reminders: DueReminder[] }>("/api/notifications");
        if (!alive || !data.reminders.length) return;
        setDue((prev) => {
          const existing = new Set(prev.map((p) => p.id));
          const fresh = data.reminders.filter((r) => !existing.has(r.id));
          return [...prev, ...fresh];
        });
        // browser-level notification when permitted & enabled
        if (
          settings?.notifications?.enabled !== false &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          for (const r of data.reminders) {
            new Notification("Aura reminder", { body: r.task, tag: r.id });
          }
        }
        // mark as notified server-side
        for (const r of data.reminders) {
          api(`/api/reminders/${r.id}`, { method: "PATCH", json: { action: "notify" } }).catch(
            () => {}
          );
        }
      } catch {
        /* offline — try again next tick */
      }
    };
    poll();
    const iv = setInterval(poll, 40_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [user, settings?.notifications?.enabled]);

  const dismissDue = (id: string) => setDue((prev) => prev.filter((r) => r.id !== id));

  // -----------------------------------------------------------------------
  if (error) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col items-center justify-center gap-4 px-8 text-center">
        <Orb state="error" size={120} />
        <p className="font-display text-[17px] font-semibold">Connection problem</p>
        <p className="text-[13px] text-mist">{error}</p>
        <Pressable
          onClick={() => {
            setError(null);
            load();
          }}
          className="rounded-full bg-violet px-5 py-2.5 text-[13px] font-semibold text-white"
        >
          Retry
        </Pressable>
      </div>
    );
  }

  if (!user || !settings) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col items-center justify-center gap-5">
        <Orb state="idle" size={110} />
        <p className="shimmer-text font-display text-[13px] font-medium tracking-[0.2em] uppercase">
          Waking Aura
        </p>
      </div>
    );
  }

  return (
    <Ctx.Provider value={{ user, settings, ai, refresh: load, patchProfile, toast, openNav }}>
      <Sidebar
        mobileOpen={navOpen}
        onMobileClose={() => setNavOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        isAdmin={user.role === "admin"}
        userName={user.displayName}
        userEmail={user.email}
      />
      <div
        className={clsx(
          "app-frame relative mx-auto flex w-full max-w-[430px] flex-col overflow-hidden border-x border-line/50 bg-void transition-[padding] duration-200 md:max-w-none md:border-0",
          collapsed ? "lg:pl-[68px]" : "lg:pl-[264px]"
        )}
      >
        {/* due reminder banners */}
        <AnimatePresence>
          {due.map((r) => (
            <motion.div
              key={r.id}
              initial={{ y: -80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -80, opacity: 0 }}
              className="absolute inset-x-3 top-3 z-40 rounded-2xl border border-violet/30 bg-elev/95 p-3.5 shadow-2xl shadow-violet/10 backdrop-blur-xl lg:right-6 lg:left-auto lg:w-[420px]"
            >
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet/15 text-violet">
                  <BellRing size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold tracking-wide text-violet uppercase">
                    Reminder
                  </p>
                  <p className="mt-0.5 truncate text-[14px] font-medium text-frost">{r.task}</p>
                  <div className="mt-2 flex gap-2">
                    <Pressable
                      onClick={async () => {
                        await api(`/api/reminders/${r.id}`, {
                          method: "PATCH",
                          json: { action: "done" },
                        }).catch(() => {});
                        dismissDue(r.id);
                        toast("Marked as done");
                      }}
                      className="flex items-center gap-1 rounded-full bg-mint/15 px-3 py-1.5 text-[12px] font-semibold text-mint"
                    >
                      <Check size={13} /> Done
                    </Pressable>
                    <Pressable
                      onClick={async () => {
                        await api(`/api/reminders/${r.id}`, {
                          method: "PATCH",
                          json: { action: "snooze", snoozeMinutes: 10 },
                        }).catch(() => {});
                        dismissDue(r.id);
                        toast("Snoozed for 10 minutes");
                      }}
                      className="flex items-center gap-1 rounded-full bg-amber/15 px-3 py-1.5 text-[12px] font-semibold text-amber"
                    >
                      <Clock size={13} /> Snooze
                    </Pressable>
                  </div>
                </div>
                <Pressable
                  onClick={() => dismissDue(r.id)}
                  className="text-faint"
                  aria-label="Dismiss"
                >
                  <X size={16} />
                </Pressable>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>

        {/* toast */}
        <AnimatePresence>
          {toastMsg && (
            <motion.div
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              className="pointer-events-none fixed bottom-24 left-1/2 z-50 w-full max-w-[430px] -translate-x-1/2 px-6 lg:bottom-10"
            >
              <div className="mx-auto w-fit rounded-full border border-line bg-elev/95 px-4 py-2 text-[13px] text-frost shadow-xl backdrop-blur-xl">
                {toastMsg}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <TabBar />
      </div>
    </Ctx.Provider>
  );
}
