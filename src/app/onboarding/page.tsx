"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Brain,
  Globe,
  BellRing,
  Sparkles,
  AlarmClockCheck,
  Check,
} from "lucide-react";
import { Orb, type OrbState } from "@/components/orb";
import { Chip, Pressable, Spinner, inputCls } from "@/components/ui";
import { api } from "@/lib/client";
import clsx from "clsx";

const capabilities = [
  {
    icon: Sparkles,
    title: "Think",
    body: "Ask anything. Streaming answers from your own self-hosted model.",
  },
  {
    icon: Globe,
    title: "Search",
    body: "Live web results with sources — no proprietary search APIs.",
  },
  {
    icon: Brain,
    title: "Remember",
    body: "Persistent long-term memory you can inspect, edit, and erase.",
  },
  {
    icon: AlarmClockCheck,
    title: "Get things done",
    body: "Reminders, notes, and tasks created in plain language.",
  },
];

const orbStates: OrbState[] = ["idle", "thinking", "responding", "listening"];

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<"en" | "ur" | "roman-ur">("en");
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [notif, setNotif] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const safeTz = () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz || "UTC";
    } catch {
      return "UTC";
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/profile", {
        method: "PATCH",
        json: {
          displayName: name.trim() || "Friend",
          timezone: safeTz(),
          language,
          memoryEnabled,
          onboardingDone: true,
        },
      });
      router.replace("/home");
    } catch (e) {
      if ((e as { status?: number }).status === 401) router.replace("/auth");
      else setError("Couldn't save your preferences. Try again.");
      setBusy(false);
    }
  };

  const askNotifications = async () => {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setNotif(p === "granted");
  };

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col overflow-hidden px-6 pt-safe md:max-w-[480px]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 36% at 50% 0%, rgba(124,92,252,0.15), transparent 70%)",
        }}
      />

      {/* progress */}
      <div className="relative mt-6 flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-line">
            <motion.div
              className="h-full rounded-full bg-violet"
              initial={false}
              animate={{ width: step >= i ? "100%" : "0%" }}
              transition={{ duration: 0.35 }}
            />
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div
            key="s0"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="relative flex flex-1 flex-col items-center"
          >
            <div className="mt-12">
              <Orb state={orbState} size={180} />
            </div>
            <h1 className="mt-10 text-center font-display text-[26px] font-bold tracking-tight">
              Meet your <span className="gradient-text">personal AI</span>.
            </h1>
            <p className="mt-3 max-w-[290px] text-center text-[13.5px] leading-relaxed text-mist">
              Aura lives on your own server — not in someone else&apos;s cloud.
              Private by architecture, not by promise.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {orbStates.map((s) => (
                <Chip key={s} active={orbState === s} onClick={() => setOrbState(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </motion.div>
        )}

        {step === 1 && (
          <motion.div
            key="s1"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="relative flex flex-1 flex-col"
          >
            <h1 className="mt-12 font-display text-[26px] font-bold tracking-tight">
              Think. Search. Remember.
              <br />
              <span className="gradient-text">Get things done.</span>
            </h1>
            <div className="mt-8 grid gap-3">
              {capabilities.map((c, i) => (
                <motion.div
                  key={c.title}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 * i + 0.15 }}
                  className="flex items-start gap-3.5 rounded-2xl border border-line bg-card p-4"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet/12 text-violet">
                    <c.icon size={18} strokeWidth={1.8} />
                  </div>
                  <div>
                    <p className="font-display text-[15px] font-semibold">{c.title}</p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-mist">{c.body}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div
            key="s2"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="relative flex flex-1 flex-col"
          >
            <div className="mt-12 flex justify-center">
              <Orb state="listening" size={130} />
            </div>
            <h1 className="mt-10 text-center font-display text-[26px] font-bold tracking-tight">
              What should I call you?
            </h1>
            <p className="mt-2 text-center text-[13px] text-mist">
              This is how Aura will greet you.
            </p>
            <input
              className={clsx(inputCls, "mt-8 text-center text-[17px]")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={40}
              autoFocus
            />
          </motion.div>
        )}

        {step === 3 && (
          <motion.div
            key="s3"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="relative flex flex-1 flex-col"
          >
            <h1 className="mt-10 font-display text-[26px] font-bold tracking-tight">
              Tune your companion.
            </h1>
            <div className="mt-7 grid gap-5">
              <div>
                <p className="mb-2 text-[12px] font-medium tracking-wide text-mist uppercase">
                  Preferred language
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["en", "English"],
                      ["ur", "اردو"],
                      ["roman-ur", "Roman Urdu"],
                    ] as const
                  ).map(([v, label]) => (
                    <Chip key={v} active={language === v} onClick={() => setLanguage(v)}>
                      {label}
                    </Chip>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setMemoryEnabled((m) => !m)}
                className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4 text-left"
              >
                <div className="flex items-start gap-3">
                  <Brain size={18} className="mt-0.5 text-violet" />
                  <div>
                    <p className="text-[14px] font-semibold">Long-term memory</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-mist">
                      Remember preferences and facts across conversations. Editable and erasable anytime.
                    </p>
                  </div>
                </div>
                <span
                  className={clsx(
                    "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                    memoryEnabled ? "bg-violet" : "bg-line"
                  )}
                >
                  <span
                    className={clsx(
                      "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                      memoryEnabled ? "left-[22px]" : "left-0.5"
                    )}
                  />
                </span>
              </button>

              <button
                onClick={askNotifications}
                className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4 text-left"
              >
                <div className="flex items-start gap-3">
                  <BellRing size={18} className="mt-0.5 text-violet" />
                  <div>
                    <p className="text-[14px] font-semibold">Reminder notifications</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-mist">
                      Get notified while the app is open. Push delivery plugs into your own service.
                    </p>
                  </div>
                </div>
                {notif ? (
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-mint/20 text-mint">
                    <Check size={14} />
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full border border-line px-3 py-1 text-[11.5px] font-semibold text-mist">
                    Enable
                  </span>
                )}
              </button>
              {error && <p className="text-[12.5px] text-danger">{error}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* footer */}
      <div className="relative flex items-center justify-between pb-10">
        <button
          onClick={() => (step === 0 ? router.replace("/home") : setStep((s) => s - 1))}
          className="text-[13px] font-medium text-faint hover:text-mist"
        >
          {step === 0 ? "Skip" : "Back"}
        </button>
        <Pressable
          onClick={() => {
            if (step < 3) setStep((s) => s + 1);
            else finish();
          }}
          disabled={busy || (step === 2 && !name.trim())}
          className="flex items-center gap-2 rounded-full bg-violet px-6 py-3 text-[14px] font-semibold text-white shadow-lg shadow-violet/25 hover:bg-iris"
        >
          {busy ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : null}
          {step < 3 ? "Continue" : "Begin"}
          <ArrowRight size={16} />
        </Pressable>
      </div>
    </div>
  );
}
