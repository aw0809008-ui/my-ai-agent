"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Orb } from "@/components/orb";
import { Field, Pressable, Spinner, inputCls } from "@/components/ui";
import { api, ApiFail } from "@/lib/client";

function ResetInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/reset", { method: "PUT", json: { token, password } });
      setDone(true);
      setTimeout(() => router.replace("/auth"), 1600);
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-6 pt-safe">
      <div className="mt-14 flex justify-center">
        <Orb state={done ? "responding" : "idle"} size={110} />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-8"
      >
        <h1 className="text-center font-display text-[24px] font-bold tracking-tight">
          {done ? "Password updated" : "Choose a new password"}
        </h1>
        <p className="mt-1.5 text-center text-[13px] text-mist">
          {done ? "Redirecting you to sign in…" : "Minimum 8 characters."}
        </p>
        {!done && (
          <form onSubmit={submit} className="mt-8 grid gap-4">
            <Field label="New password">
              <input
                className={inputCls}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirm password">
              <input
                className={inputCls}
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
              />
            </Field>
            {error && (
              <p className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[12.5px] text-danger">
                {error}
              </p>
            )}
            {token.length < 10 && (
              <p className="rounded-xl border border-amber/30 bg-amber/10 px-3.5 py-2.5 text-[12.5px] text-amber">
                This reset link is missing its token. Request a new one from the sign-in screen.
              </p>
            )}
            <Pressable
              type="submit"
              disabled={busy || token.length < 10}
              className="flex items-center justify-center gap-2 rounded-2xl bg-violet py-3.5 text-[14.5px] font-semibold text-white hover:bg-iris"
            >
              {busy && <Spinner className="h-4 w-4 border-white/30 border-t-white" />}
              Update password
            </Pressable>
          </form>
        )}
      </motion.div>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <ResetInner />
    </Suspense>
  );
}
