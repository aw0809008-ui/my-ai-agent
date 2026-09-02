"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Code2,
  Copy,
  FileCode2,
  History,
  Maximize2,
  Minimize2,
  Monitor,
  RefreshCw,
  Smartphone,
  Undo2,
  Wrench,
  X,
} from "lucide-react";
import clsx from "clsx";
import { Spinner } from "@/components/ui";
import { api } from "@/lib/client";
import { buildPreviewHtml, type PreviewFile } from "@/lib/preview-runtime";

export interface ProjectData {
  id: string;
  name: string;
  entry: string;
  files: PreviewFile[];
  versions?: { id: string; label: string; createdAt: string }[];
}

interface Props {
  projectId: string;
  onClose: () => void;
  /** ask the assistant to repair a compile/runtime error */
  onFix: (errorText: string) => void;
  busy?: boolean;
}

type Tab = "preview" | "code";

export function WebAppWorkspace({ projectId, onClose, onFix, busy }: Props) {
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("preview");
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [mobileFrame, setMobileFrame] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [autoHealing, setAutoHealing] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  /** error signatures already auto-repaired — prevents fix→error→fix loops */
  const healedRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const p = await api<ProjectData>(`/api/projects/${projectId}`);
      setProject(p);
      setActiveFile((cur) => cur ?? p.entry ?? p.files[0]?.path ?? null);
      setNonce((n) => n + 1);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // reload when the assistant finishes changing the project
  useEffect(() => {
    if (busy === false) {
      const t = setTimeout(load, 250);
      return () => clearTimeout(t);
    }
  }, [busy, load]);

  // messages from the sandboxed (null-origin) iframe
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return; // only our frame
      const d = e.data as { __auraPreview?: boolean; type?: string; message?: string };
      if (!d || d.__auraPreview !== true) return;
      if (d.type === "error") {
        setPreviewError(String(d.message ?? "Unknown preview error").slice(0, 1200));
        setPreviewReady(true);
      } else if (d.type === "ready") {
        setPreviewError(null);
        setPreviewReady(true);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const srcDoc = useMemo(() => {
    if (!project) return "";
    return buildPreviewHtml(project.files, project.entry);
  }, [project]);

  // ---- self-healing ------------------------------------------------------
  // The first time a given compile/runtime error appears, ask the assistant to
  // repair it automatically. Each distinct error is only auto-healed ONCE, and
  // never while a generation is already running, so this cannot loop.
  useEffect(() => {
    if (!previewError || busy || !project) return;
    const signature = previewError.slice(0, 160);
    if (healedRef.current.has(signature)) return;
    healedRef.current.add(signature);
    // deferred so no state update runs synchronously inside the effect
    const t = setTimeout(() => {
      setAutoHealing(true);
      onFix(previewError);
    }, 400);
    return () => clearTimeout(t);
  }, [previewError, busy, project, onFix]);

  // clear the healing flag once the assistant finishes
  useEffect(() => {
    if (busy !== false) return;
    const t = setTimeout(() => setAutoHealing(false), 0);
    return () => clearTimeout(t);
  }, [busy]);

  const refresh = () => {
    setPreviewError(null);
    setPreviewReady(false);
    setNonce((n) => n + 1);
  };

  const restore = async (versionId: string) => {
    try {
      await api(`/api/projects/${projectId}`, {
        method: "PATCH",
        json: { restoreVersionId: versionId },
      });
      setShowVersions(false);
      await load();
      refresh();
    } catch {
      /* surfaced by loadError on next load */
    }
  };

  const current = project?.files.find((f) => f.path === activeFile) ?? null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        "flex min-h-0 flex-col overflow-hidden border border-line bg-card",
        fullscreen
          ? "fixed inset-0 z-50 rounded-none"
          : "h-[460px] rounded-2xl lg:h-[560px]"
      )}
      aria-label="Web app workspace"
    >
      {/* toolbar */}
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-abyss px-3 py-2">
        <FileCode2 size={15} className="shrink-0 text-violet" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {project?.name ?? "Loading app…"}
        </span>

        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-line bg-card p-0.5">
          {(["preview", "code"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={clsx(
                "rounded-md px-2.5 py-1 text-[11.5px] font-semibold capitalize transition-colors",
                tab === t ? "bg-elev text-frost" : "text-faint hover:text-mist"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "preview" && (
          <>
            <button
              onClick={() => setMobileFrame((m) => !m)}
              className="hidden h-7 w-7 place-items-center rounded-lg text-faint hover:bg-elev hover:text-frost sm:grid"
              aria-label={mobileFrame ? "Desktop width" : "Mobile width"}
              title={mobileFrame ? "Desktop width" : "Mobile width"}
            >
              {mobileFrame ? <Monitor size={14} /> : <Smartphone size={14} />}
            </button>
            <button
              onClick={refresh}
              className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:bg-elev hover:text-frost"
              aria-label="Refresh preview"
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
          </>
        )}
        {project?.versions && project.versions.length > 0 && (
          <button
            onClick={() => setShowVersions((s) => !s)}
            className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:bg-elev hover:text-frost"
            aria-label="Version history"
            title="Version history"
          >
            <History size={14} />
          </button>
        )}
        <button
          onClick={() => setFullscreen((f) => !f)}
          className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:bg-elev hover:text-frost"
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:bg-elev hover:text-frost"
          aria-label="Close workspace"
        >
          <X size={14} />
        </button>
      </header>

      {/* version list */}
      <AnimatePresence>
        {showVersions && project?.versions && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 overflow-hidden border-b border-line bg-elev"
          >
            <ul className="max-h-32 overflow-y-auto p-2 slim-scroll">
              {project.versions.map((v) => (
                <li key={v.id}>
                  <button
                    onClick={() => restore(v.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-mist hover:bg-card hover:text-frost"
                  >
                    <Undo2 size={12} className="text-faint" />
                    <span className="flex-1 truncate">Restore “{v.label}”</span>
                    <span className="text-[10.5px] text-faint">
                      {new Date(v.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {/* body */}
      <div className="relative min-h-0 flex-1">
        {loadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <AlertTriangle size={20} className="text-danger" />
            <p className="text-[13px] text-danger">{loadError}</p>
            <button
              onClick={load}
              className="mt-1 rounded-lg border border-line px-3 py-1.5 text-[12px] text-mist hover:text-frost"
            >
              Retry
            </button>
          </div>
        ) : !project ? (
          <div className="flex h-full items-center justify-center gap-2 text-[13px] text-mist">
            <Spinner className="h-4 w-4" /> Loading workspace…
          </div>
        ) : tab === "preview" ? (
          <div className="flex h-full flex-col">
            <div
              className={clsx(
                "min-h-0 flex-1 bg-white",
                mobileFrame && "mx-auto w-full max-w-[390px] border-x border-line"
              )}
            >
              {/* SANDBOXED: allow-scripts only → null origin. No same-origin, no
                  forms, no popups, no top navigation. Generated code cannot read
                  our cookies/storage/DOM or call our APIs as the user. */}
              <iframe
                key={nonce}
                ref={iframeRef}
                title="App preview"
                srcDoc={srcDoc}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                className="h-full w-full border-0 bg-white"
              />
            </div>
            {!previewReady && !previewError && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-card/70">
                <span className="flex items-center gap-2 text-[12.5px] text-mist">
                  <Spinner className="h-4 w-4" /> Compiling preview…
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full min-h-0">
            {/* file tree */}
            <aside className="w-[38%] max-w-[220px] shrink-0 overflow-y-auto border-r border-line bg-abyss p-1.5 slim-scroll">
              {project.files.map((f) => (
                <button
                  key={f.path}
                  onClick={() => setActiveFile(f.path)}
                  className={clsx(
                    "flex w-full items-center gap-1.5 truncate rounded-md px-2 py-1.5 text-left text-[11.5px] transition-colors",
                    activeFile === f.path
                      ? "bg-elev text-frost"
                      : "text-mist hover:bg-elev/60 hover:text-frost"
                  )}
                  title={f.path}
                >
                  <Code2 size={11} className="shrink-0 text-faint" />
                  <span className="truncate">{f.path}</span>
                </button>
              ))}
            </aside>
            {/* source */}
            <div className="relative min-w-0 flex-1 overflow-auto bg-[#0a0c12] slim-scroll">
              {current && (
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(current.content).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1400);
                  }}
                  className="absolute top-2 right-3 z-10 grid h-7 w-7 place-items-center rounded-lg border border-line bg-elev text-mist hover:text-frost"
                  aria-label="Copy file"
                >
                  {copied ? <Check size={12} className="text-mint" /> : <Copy size={12} />}
                </button>
              )}
              <pre className="min-w-full p-3 text-[11.5px] leading-relaxed text-frost/90">
                <code>{current?.content ?? "Select a file"}</code>
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* error panel */}
      <AnimatePresence>
        {previewError && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 overflow-hidden border-t border-danger/30 bg-danger/8"
          >
            <div className="flex items-start gap-2.5 p-3">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-danger">
                  {autoHealing || busy
                    ? "Preview failed — repairing automatically…"
                    : "Preview failed to compile"}
                </p>
                <pre className="mt-1 max-h-24 overflow-auto text-[11px] leading-snug whitespace-pre-wrap text-mist slim-scroll">
                  {previewError}
                </pre>
              </div>
              <button
                onClick={() => {
                  healedRef.current.add(previewError.slice(0, 160));
                  onFix(previewError);
                }}
                disabled={busy || autoHealing}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-danger/15 px-3 py-1.5 text-[11.5px] font-semibold text-danger disabled:opacity-50"
              >
                {busy || autoHealing ? (
                  <Spinner className="h-3 w-3 border-danger/30 border-t-danger" />
                ) : (
                  <Wrench size={12} />
                )}
                {busy || autoHealing ? "Fixing…" : "Fix it"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
