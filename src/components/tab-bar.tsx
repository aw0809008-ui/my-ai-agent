"use client";

import { usePathname, useRouter } from "next/navigation";
import { Home, MessagesSquare, Brain, AlarmClockCheck, Settings } from "lucide-react";
import { motion } from "framer-motion";
import clsx from "clsx";

const TABS = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/chat", label: "Chat", icon: MessagesSquare },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/tasks", label: "Tasks", icon: AlarmClockCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Bottom navigation for mobile + tablet. On desktop the sidebar takes over. */
export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav
      className="pointer-events-auto fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[430px] pb-safe md:max-w-[560px] lg:hidden"
      aria-label="Primary"
    >
      <div className="mx-3 mb-3 rounded-2xl border border-line glass elevated">
        <div className="grid grid-cols-5 px-1 py-1.5">
          {TABS.map((tab) => {
            const active = pathname.startsWith(tab.href);
            const Icon = tab.icon;
            return (
              <button
                key={tab.href}
                onClick={() => router.push(tab.href)}
                className="relative flex flex-col items-center gap-1 rounded-xl py-1.5"
                aria-label={tab.label}
                aria-current={active ? "page" : undefined}
              >
                {active && (
                  <motion.span
                    layoutId="tab-active"
                    className="absolute inset-x-1.5 inset-y-0 rounded-xl bg-elev"
                    transition={{ type: "spring", stiffness: 480, damping: 38 }}
                  />
                )}
                <Icon
                  size={19}
                  strokeWidth={active ? 2.2 : 1.8}
                  className={clsx(
                    "relative transition-colors",
                    active ? "text-violet" : "text-mist"
                  )}
                />
                <span
                  className={clsx(
                    "relative text-[10px] font-medium transition-colors",
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
