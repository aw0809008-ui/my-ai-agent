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
    <nav className="pointer-events-auto fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[430px] pb-safe">
      <div className="mx-3 mb-3 rounded-3xl border border-line glass">
        <div className="grid grid-cols-5 px-1 py-1.5">
          {TABS.map((tab) => {
            const active = tab.match.some((m) => pathname.startsWith(m));
            const Icon = tab.icon;
            return (
              <button
                key={tab.href}
                onClick={() => router.push(tab.href)}
                className="relative flex flex-col items-center gap-0.5 rounded-2xl py-1.5"
                aria-label={tab.label}
              >
                {active && (
                  <motion.span
                    layoutId="tab-active"
                    className="absolute inset-x-2 inset-y-0 rounded-2xl bg-violet/15"
                    transition={{ type: "spring", stiffness: 480, damping: 38 }}
                  />
                )}
                <Icon
                  size={20}
                  strokeWidth={active ? 2.2 : 1.7}
                  className={clsx(
                    "relative transition-colors duration-200",
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
