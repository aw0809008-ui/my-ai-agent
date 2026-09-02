"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ExternalLink,
  LayoutTemplate,
  Loader2,
  MessageSquarePlus,
  Trash2,
  X,
} from "lucide-react";
import { useShell } from "@/components/app-shell";
import { EmptyState, PageHeader, Pressable } from "@/components/ui";
import { WebAppWorkspace } from "@/components/webapp-workspace";
import { api, relTime } from "@/lib/client";

interface ProjectItem {
  id: string;
  name: string;
  framework: string;
  updatedAt: string;
  createdAt: string;
}

/**
 * Projects = workspace for AI-generated apps.
 * Chat remains the place where projects are CREATED and edited; this page is
 * for finding, previewing and managing them afterwards.
 */
export default function ProjectsPage() {
  const router = useRouter();
  const { toast } = useShell();
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api<{ items: ProjectItem[] }>("/api/projects");
      setItems(d.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const remove = async (id: string) => {
    setConfirmId(null);
    const prev = items;
    setItems((p) => p.filter((x) => x.id !== id));
    if (openId === id) setOpenId(null);
    try {
      await api(`/api/projects/${id}`, { method: "DELETE" });
      toast("Project deleted");
    } catch {
      setItems(prev);
      toast("Couldn't delete that project");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Projects"
        subtitle="Apps you built with Aura — created and edited from Chat"
        right={
          <Pressable
            onClick={() =>
              router.push(
                `/chat/new?q=${encodeURIComponent("Build me a ")}`
              )
            }
            className="grid h-10 w-10 place-items-center rounded-2xl bg-violet text-white"
            aria-label="Build a new app from Chat"
            title="Build a new app"
          >
            <MessageSquarePlus size={18} />
          </Pressable>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-32 slim-scroll lg:px-8 lg:pb-14">
        <div className="lg:mx-auto lg:w-full lg:max-w-[900px]">
          {loading ? (
            <div className="flex justify-center pt-14">
              <Loader2 className="animate-spin text-violet" size={22} />
            </div>
          ) : error ? (
            <div className="mt-6 rounded-xl border border-danger/30 bg-danger/8 p-4 text-center">
              <p className="text-[13px] text-danger">{error}</p>
              <Pressable
                onClick={load}
                className="mt-2 rounded-lg border border-line px-3 py-1.5 text-[12px] text-mist hover:text-frost"
              >
                Retry
              </Pressable>
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={LayoutTemplate}
              title="No projects yet"
              body="Ask Aura in Chat: “Build me a modern ecommerce landing page.” Generated apps appear here with a live preview, code and version history."
              action={
                <Pressable
                  onClick={() =>
                    router.push(
                      `/chat/new?q=${encodeURIComponent(
                        "Build me a modern landing page with a hero section, features and pricing"
                      )}`
                    )
                  }
                  className="mt-1 flex items-center gap-1.5 rounded-full bg-violet px-4 py-2 text-[12.5px] font-semibold text-white"
                >
                  <MessageSquarePlus size={14} /> Build one from Chat
                </Pressable>
              }
            />
          ) : (
            <>
              <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
                {items.map((p, i) => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.25) }}
                    className={`rounded-xl border bg-card p-4 transition-colors ${
                      openId === p.id ? "border-violet/40" : "border-line"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-elev text-violet">
                        <LayoutTemplate size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold text-frost">
                          {p.name}
                        </p>
                        <p className="text-[11px] text-faint">
                          {p.framework} · updated {relTime(p.updatedAt)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-1.5">
                      <Pressable
                        onClick={() => setOpenId(openId === p.id ? null : p.id)}
                        className="flex items-center gap-1.5 rounded-lg bg-violet/12 px-3 py-1.5 text-[12px] font-semibold text-violet"
                      >
                        <ExternalLink size={12} />
                        {openId === p.id ? "Close" : "Open"}
                      </Pressable>
                      <Pressable
                        onClick={() =>
                          router.push(
                            `/chat/new?q=${encodeURIComponent(
                              `Continue working on my "${p.name}" app: `
                            )}`
                          )
                        }
                        className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-mist hover:text-frost"
                      >
                        Edit in Chat
                      </Pressable>
                      <span className="ml-auto" />
                      {confirmId === p.id ? (
                        <span className="flex items-center gap-1">
                          <Pressable
                            onClick={() => remove(p.id)}
                            className="rounded-md px-2 py-1 text-[11.5px] font-bold text-danger"
                          >
                            Delete
                          </Pressable>
                          <Pressable
                            onClick={() => setConfirmId(null)}
                            className="grid h-6 w-6 place-items-center rounded-md text-faint"
                            aria-label="Cancel delete"
                          >
                            <X size={12} />
                          </Pressable>
                        </span>
                      ) : (
                        <Pressable
                          onClick={() => setConfirmId(p.id)}
                          className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:bg-danger/10 hover:text-danger"
                          aria-label={`Delete ${p.name}`}
                        >
                          <Trash2 size={13} />
                        </Pressable>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>

              {openId && (
                <div className="mt-4">
                  <WebAppWorkspace
                    projectId={openId}
                    onClose={() => setOpenId(null)}
                    onFix={(err) =>
                      router.push(
                        `/chat/new?q=${encodeURIComponent(
                          `Fix this error in my app: ${err.slice(0, 200)}`
                        )}`
                      )
                    }
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
