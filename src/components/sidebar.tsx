"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlarmClockCheck,
  Brain,
  ChevronsLeft,
  ChevronsRight,
  Home,
  MessagesSquare,
  PanelLeftClose,
  Plus,
  Settings,
  Shield,
} from "lucide-react";
import clsx from "clsx";
import { api, relTime, type ConversationItem } from "@/lib/client";

const NAV = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/chat", label: "Chats", icon: MessagesSquare },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/tasks", label: "Tasks", icon: AlarmClockCheck },
];

interface Props {
  mobileOpen: boolean;
  onMobileClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  isAdmin: boolean;
  userName: string;
  userEmail: string;
}

export function Sidebar({
  mobileOpen,
  onMobileClose,
  collapsed,
  onToggleCollapse,
  isAdmin,
  userName,
  userEmail,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [convos, setConvos] = useState<ConversationItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    api<{ items: ConversationItem[] }>("/api/conversations")
      .then((d) => setConvos(d.items.slice(0, 12)))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load, pathname]);

  const go = (href: string) => {
    router.push(href);
    onMobileClose();
  };

  const activeConvo = pathname.startsWith("/chat/") ? pathname.split("/")[2] : null;

  const body = (drawer: boolean) => {
    const mini = collapsed && !drawer;
    return (
      <div className="flex h-full min-h-0 flex-col bg-abyss">
        {/* brand */}
        <div
          className={clsx(
            "flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-3",
            mini && "justify-center px-0"
          )}
        >
          <button
            onClick={() => go("/home")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet to-azure font-display text-[15px] font-bold text-white"
            aria-label="Aura home"
          >
            a
          </button>
          {!mini && (
            <>
              <span className="font-display text-[15px] font-semibold tracking-tight">aura</span>
              {drawer ? (
                <button
                  onClick={onMobileClose}
                  className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-mist hover:bg-elev hover:text-frost"
                  aria-label="Close navigation"
                >
                  <PanelLeftClose size={16} />
                </button>
              ) : (
                <button
                  onClick={onToggleCollapse}
                  className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-elev hover:text-frost"
                  aria-label="Collapse sidebar"
                >
                  <ChevronsLeft size={16} />
                </button>
              )}
            </>
          )}
        </div>

        {/* new chat */}
        <div className={clsx("px-3 pt-3", mini && "px-2")}>
          <button
            onClick={() => go("/chat/new")}
            className={clsx(
              "flex w-full items-center gap-2 rounded-xl bg-violet px-3 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-iris",
              mini && "justify-center px-0"
            )}
            aria-label="New chat"
            title="New chat"
          >
            <Plus size={16} strokeWidth={2.4} />
            {!mini && "New chat"}
          </button>
        </div>

        {/* primary nav */}
        <nav className={clsx("mt-3 grid gap-0.5 px-3", mini && "px-2")} aria-label="Main">
          {NAV.map((n) => {
            const active =
              n.href === "/chat"
                ? pathname.startsWith("/chat")
                : pathname.startsWith(n.href);
            return (
              <button
                key={n.href}
                onClick={() => go(n.href)}
                aria-current={active ? "page" : undefined}
                title={n.label}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors",
                  mini && "justify-center px-0",
                  active
                    ? "bg-elev text-frost"
                    : "text-mist hover:bg-elev/60 hover:text-frost"
                )}
              >
                <n.icon
                  size={16}
                  className={active ? "text-violet" : "text-faint"}
                  strokeWidth={active ? 2.2 : 1.8}
                />
                {!mini && n.label}
              </button>
            );
          })}
        </nav>

        {/* conversations */}
        {!mini && (
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            <p className="px-4 pb-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-faint uppercase">
              Recent
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 slim-scroll">
              {!loaded ? (
                <div className="grid gap-1.5 px-1 pt-1">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-7 animate-pulse rounded-lg bg-elev/70" />
                  ))}
                </div>
              ) : convos.length === 0 ? (
                <p className="px-2 py-2 text-[12px] leading-relaxed text-faint">
                  No conversations yet. Start one with New chat.
                </p>
              ) : (
                <div className="grid gap-0.5">
                  {convos.map((c) => {
                    const active = activeConvo === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => go(`/chat/${c.id}`)}
                        title={c.title}
                        aria-current={active ? "page" : undefined}
                        className={clsx(
                          "group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors",
                          active ? "bg-elev text-frost" : "text-mist hover:bg-elev/60 hover:text-frost"
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate text-[13px]">{c.title}</span>
                        <span className="shrink-0 text-[10px] text-faint opacity-0 transition-opacity group-hover:opacity-100">
                          {relTime(c.updatedAt)}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    onClick={() => go("/chat")}
                    className="mt-1 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium text-violet hover:bg-elev/60"
                  >
                    View all conversations
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {mini && <div className="flex-1" />}

        {/* footer */}
        <div className={clsx("border-t border-line p-3", mini && "px-2")}>
          {isAdmin && (
            <button
              onClick={() => go("/settings")}
              title="Admin"
              className={clsx(
                "mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-mist transition-colors hover:bg-elev/60 hover:text-frost",
                mini && "justify-center px-0"
              )}
            >
              <Shield size={15} className="text-faint" />
              {!mini && "Admin"}
            </button>
          )}
          <button
            onClick={() => go("/settings")}
            title="Settings"
            aria-current={pathname.startsWith("/settings") ? "page" : undefined}
            className={clsx(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
              pathname.startsWith("/settings")
                ? "bg-elev text-frost"
                : "text-mist hover:bg-elev/60 hover:text-frost",
              mini && "justify-center px-0"
            )}
          >
            {mini ? (
              <Settings size={16} className="text-faint" />
            ) : (
              <>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet to-azure text-[12px] font-bold text-white">
                  {(userName || userEmail || "A")[0].toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-frost">
                    {userName || "Account"}
                  </span>
                  <span className="block truncate text-[10.5px] text-faint">{userEmail}</span>
                </span>
                <Settings size={15} className="shrink-0 text-faint" />
              </>
            )}
          </button>
          {mini && (
            <button
              onClick={onToggleCollapse}
              className="mt-1 grid h-8 w-full place-items-center rounded-lg text-faint hover:bg-elev hover:text-frost"
              aria-label="Expand sidebar"
            >
              <ChevronsRight size={16} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* desktop rail */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-30 hidden border-r border-line lg:block",
          collapsed ? "w-[68px]" : "w-[264px]"
        )}
      >
        {body(false)}
      </aside>

      {/* mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onMobileClose}
              className="fixed inset-0 z-40 bg-black/60 lg:hidden"
              aria-label="Close navigation overlay"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
              className="fixed inset-y-0 left-0 z-50 w-[272px] border-r border-line lg:hidden"
              aria-label="Navigation"
            >
              {body(true)}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
