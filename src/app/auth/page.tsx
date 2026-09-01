"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { Orb } from "@/components/orb";
import { Field, Pressable, Spinner, inputCls } from "@/components/ui";
import { api, ApiFail, setToken } from "@/lib/client";
import clsx from "clsx";

function AuthInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">(
    params.get("mode") === "register" ? "register" : "login"
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [resetInfo, setResetInfo] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ needsOnboarding: boolean; token?: string }>(
        `/api/auth/${mode}`,
        {
          method: "POST",
          json:
            mode === "register" ? { name: name.trim(), email, password } : { email, password },
        }
      );
      if (res.token) setToken(res.token); // iframe-safe bearer session
      router.replace(res.needsOnboarding ? "/onboarding" : "/home");
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const requestReset = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ message: string; devLink?: string }>("/api/auth/reset", {
        method: "POST",
        json: { email },
      });
      setResetInfo(res.message);
      if (res.devLink) setDevLink(res.devLink);
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-6 pt-safe md:max-w-[480px]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 32% at 50% 0%, rgba(124,92,252,0.14), transparent 70%)",
        }}
      />
      <div className="relative mt-4 flex items-center justify-between">
        <Pressable
          onClick={() => router.push("/welcome")}
          className="grid h-9 w-9 place-items-center rounded-full border border-line bg-card text-mist"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </Pressable>
        <span className="text-[12px] font-medium tracking-[0.25em] text-faint uppercase">aura</span>
        <span className="w-9" />
      </div>

      <div className="relative mt-8 flex justify-center">
        <Orb state={busy ? "thinking" : "idle"} size={120} />
      </div>

      <h1 className="relative mt-8 text-center font-display text-[24px] font-bold tracking-tight">
        {forgot ? "Reset your password" : mode === "login" ? "Welcome back" : "Create your Aura"}
      </h1>
      <p className="relative mt-1.5 text-center text-[13px] text-mist">
        {forgot
          ? "We’ll generate a secure reset link."
          : mode === "login"
            ? "Your assistant kept everything safe."
            : "Your own private AI environment."}
      </p>

      <AnimatePresence mode="wait">
        <motion.form
          key={forgot ? "forgot" : mode}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.25 }}
          onSubmit={forgot ? requestReset : submit}
          className="relative mt-8 grid gap-4"
        >
          {!forgot && (
            <div className="grid grid-cols-2 gap-1 rounded-2xl border border-line bg-card p-1">
              {(["login", "register"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={clsx(
                    "relative rounded-xl py-2 text-[13px] font-semibold transition-colors",
                    mode === m ? "text-frost" : "text-faint hover:text-mist"
                  )}
                >
                  {mode === m && (
                    <motion.span
                      layoutId="auth-tab"
                      className="absolute inset-0 rounded-xl bg-elev"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  )}
                  <span className="relative">{m === "login" ? "Sign in" : "Register"}</span>
                </button>
              ))}
            </div>
          )}

          {mode === "register" && !forgot && (
            <Field label="Name">
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="What should Aura call you?"
                required
                maxLength={80}
              />
            </Field>
          )}
          <Field label="Email">
            <input
              className={inputCls}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </Field>
          {!forgot && (
            <Field label="Password">
              <div className="relative">
                <input
                  className={clsx(inputCls, "pr-12")}
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "register" ? "8+ characters" : "••••••••"}
                  required
                  minLength={mode === "register" ? 8 : 1}
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute top-1/2 right-3.5 -translate-y-1/2 text-faint hover:text-mist"
                  aria-label="Toggle password visibility"
                >
                  {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </Field>
          )}

          {error && (
            <p className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[12.5px] text-danger">
              {error}
            </p>
          )}
          {resetInfo && (
            <div className="rounded-xl border border-mint/30 bg-mint/10 px-3.5 py-2.5 text-[12.5px] text-mint">
              <p>{resetInfo}</p>
              {devLink && (
                <button
                  type="button"
                  onClick={() => router.push(devLink)}
                  className="mt-1 font-semibold underline"
                >
                  Open reset link
                </button>
              )}
            </div>
          )}

          <Pressable
            type="submit"
            disabled={busy}
            className="mt-1 flex items-center justify-center gap-2 rounded-2xl bg-violet py-3.5 text-[14.5px] font-semibold text-white shadow-lg shadow-violet/20 hover:bg-iris"
          >
            {busy && <Spinner className="h-4 w-4 border-white/30 border-t-white" />}
            {forgot ? "Generate reset link" : mode === "login" ? "Sign in" : "Create account"}
          </Pressable>

          {!forgot && mode === "login" && (
            <button
              type="button"
              onClick={() => {
                setForgot(true);
                setError(null);
              }}
              className="text-center text-[12.5px] font-medium text-mist hover:text-frost"
            >
              Forgot password?
            </button>
          )}
          {forgot && (
            <button
              type="button"
              onClick={() => {
                setForgot(false);
                setResetInfo(null);
                setDevLink(null);
              }}
              className="text-center text-[12.5px] font-medium text-mist hover:text-frost"
            >
              Back to sign in
            </button>
          )}
        </motion.form>
      </AnimatePresence>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthInner />
    </Suspense>
  );
}
