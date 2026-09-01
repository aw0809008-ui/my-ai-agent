"use client";

import { usePathname, useRouter } from "next/navigation";
import { Home, MessagesSquare, Brain, AlarmClockCheck, Settings } from "lucide-react";
import { motion } from "framer-motion";
import clsx from "clsx";

const TABS = [
  { href: "/home", label: "Home", icon: Home, match: ["/home"] },
  { href: "/chat", label: "Chat", icon: MessagesSquare, match: ["/chat"] },
  { href: "/memory", label: "Memory", icon: Brain, match: ["/memory"] },
  { href: "/tasks", label: "Tasks", icon: AlarmClockCheck, match: ["/tasks"] },
  { href: "/settings", label: "Settings", icon: Settings, match: ["/settings"] },
];

export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="pointer-events-auto fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[430px] pb-safe md:max-w-[560px] lg:top-0 lg:right-auto lg:bottom-0 lg:left-0 lg:mx-0 lg:h-full lg:w-[84px] lg:max-w-none lg:pb-0">
      <div className="mx-3 mb-3 rounded-3xl border border-line glass lg:mx-0 lg:mb-0 lg:flex lg:h-full lg:flex-col lg:rounded-none lg:border-0 lg:border-r">
        {/* desktop brand mark */}
        <div className="hidden lg:flex lg:h-16 lg:items-center lg:justify-center">
          <button
            onClick={() => router.push("/home")}
            className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-violet to-azure font-display text-[17px] font-bold text-white shadow-lg shadow-violet/25"
            aria-label="Aura home"
          >
            a
          </button>
        </div>
        <div className="grid grid-cols-5 px-1 py-1.5 lg:flex lg:flex-1 lg:flex-col lg:items-center lg:justify-center lg:gap-1.5 lg:px-0 lg:py-4">
          {TABS.map((tab) => {
            const active = tab.match.some((m) => pathname.startsWith(m));
            const Icon = tab.icon;
            return (
              <button
                key={tab.href}
                onClick={() => router.push(tab.href)}
                className="relative flex flex-col items-center gap-0.5 rounded-2xl py-1.5 lg:w-14 lg:gap-1 lg:py-2.5"
                aria-label={tab.label}
              >
                {active && (
                  <motion.span
                    layoutId="tab-active"
                    className="absolute inset-x-2 inset-y-0 rounded-2xl bg-violet/15 lg:inset-x-0"
                    transition={{ type: "spring", stiffness: 480, damping: 38 }}
                  />
                )}
                <Icon
                  size={20}
                  strokeWidth={active ? 2.2 : 1.7}
                  className={clsx(
                    "relative transition-colors duration-200 lg:h-[22px] lg:w-[22px]",
                    active ? "text-violet" : "text-mist"
                  )}
                />
                <span
                  className={clsx(
                    "relative text-[10px] font-medium transition-colors duration-200",
                    active ? "text-frost" : "text-faint"
                  )}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
