"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Brain, Globe, Lock } from "lucide-react";
import { Orb } from "@/components/orb";
import { Pressable } from "@/components/ui";
import { api, getToken, clearToken } from "@/lib/client";

const fade = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.12 * i, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function Welcome() {
  const router = useRouter();

  // If a valid bearer session exists (e.g. cookie blocked in an iframe),
  // skip straight to the app.
  useEffect(() => {
    if (!getToken()) return;
    api("/api/auth/me")
      .then(() => router.replace("/home"))
      .catch(() => clearToken());
  }, [router]);

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col overflow-hidden px-6 md:max-w-[520px]">
      {/* ambient background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 40% at 50% 0%, rgba(124,92,252,0.16), transparent 70%), radial-gradient(50% 35% at 85% 90%, rgba(34,211,238,0.08), transparent 70%)",
        }}
      />
      <div className="relative flex flex-1 flex-col items-center pt-safe">
        <motion.div variants={fade} initial="hidden" animate="show" custom={0} className="mt-16">
          <Orb state="idle" size={190} />
        </motion.div>

        <motion.h1
          variants={fade}
          initial="hidden"
          animate="show"
          custom={1}
          className="gradient-text mt-10 font-display text-[44px] font-bold tracking-tight"
        >
          aura
        </motion.h1>
        <motion.p
          variants={fade}
          initial="hidden"
          animate="show"
          custom={2}
          className="mt-3 text-center font-display text-[19px] font-medium text-frost"
        >
          Your personal AI,
          <br />
          on infrastructure you own.
        </motion.p>
        <motion.p
          variants={fade}
          initial="hidden"
          animate="show"
          custom={3}
          className="mt-3 max-w-[300px] text-center text-[13.5px] leading-relaxed text-mist"
        >
          Think, search, remember, and get things done — powered by self-hosted
          open-source models. No Big-Tech AI APIs. Your data stays yours.
        </motion.p>

        <motion.div
          variants={fade}
          initial="hidden"
          animate="show"
          custom={4}
          className="mt-7 flex items-center gap-4 text-[11px] font-medium text-faint"
        >
          <span className="flex items-center gap-1.5">
            <Lock size={12} className="text-violet" /> Self-hosted
          </span>
          <span className="flex items-center gap-1.5">
            <Brain size={12} className="text-violet" /> Long-term memory
          </span>
          <span className="flex items-center gap-1.5">
            <Globe size={12} className="text-violet" /> Web search
          </span>
        </motion.div>
      </div>

      <motion.div
        variants={fade}
        initial="hidden"
        animate="show"
        custom={5}
        className="relative pb-10"
      >
        <Pressable
          onClick={() => router.push("/auth?mode=register")}
          className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-violet py-4 text-[15px] font-semibold text-white shadow-lg shadow-violet/25 transition-colors hover:bg-iris"
        >
          Get started
          <ArrowRight size={17} className="transition-transform duration-300 group-hover:translate-x-0.5" />
        </Pressable>
        <Pressable
          onClick={() => router.push("/auth")}
          className="mt-3 w-full rounded-2xl border border-line bg-card py-4 text-[15px] font-medium text-mist hover:text-frost"
        >
          I already have an account
        </Pressable>
      </motion.div>
    </div>
  );
}
