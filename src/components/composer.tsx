"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, FileText, ImageIcon, Mic, Paperclip, X } from "lucide-react";
import { Pressable, Spinner } from "@/components/ui";
import { api, type FileItem } from "@/lib/client";
import clsx from "clsx";

export interface ComposerHandle {
  setText: (t: string) => void;
  focus: () => void;
  openAttach: (mode: "image" | "file") => void;
}

interface Props {
  onSend: (text: string, fileIds: string[]) => void;
  onVoice: () => void;
  busy: boolean;
  placeholder?: string;
  onError?: (message: string) => void;
}

const MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);
const DOC_EXTS = new Set(["txt", "md", "csv", "json", "pdf"]);

function validateClient(f: File): string | null {
  const ext = (f.name.toLowerCase().split(".").pop() ?? "").trim();
  if (ext === "heic" || ext === "heif" || f.type === "image/heic")
    return "iPhone HEIC photos aren't supported yet — please export/convert to JPG first.";
  if (f.size > MAX_BYTES)
    return `"${f.name}" is over the 2 MB limit — on iPhone use "Options → Medium/Small" when sharing, or compress it.`;
  const okType =
    IMAGE_EXTS.has(ext) ||
    DOC_EXTS.has(ext) ||
    f.type.startsWith("image/") ||
    f.type.startsWith("text/") ||
    f.type === "application/pdf";
  if (!okType)
    return `"${f.name}" type isn't allowed. Supported: PNG, JPG, WebP, PDF, TXT, MD, CSV, JSON.`;
  return null;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { onSend, onVoice, busy, placeholder, onError },
  ref
) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<(Partial<FileItem> & { uploading?: boolean; error?: boolean })[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const acceptRef = useRef<string>(
    "image/png,image/jpeg,image/webp,.txt,.md,.csv,.json,application/pdf,text/plain,text/csv,application/json"
  );

  const autosize = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 132) + "px";
  }, []);

  useImperativeHandle(ref, () => ({
    setText: (t: string) => {
      setText(t);
      requestAnimationFrame(() => {
        autosize();
        taRef.current?.focus();
      });
    },
    focus: () => taRef.current?.focus(),
    openAttach: (mode: "image" | "file") => {
      acceptRef.current =
        mode === "image"
          ? "image/png,image/jpeg,image/webp"
          : ".txt,.md,.csv,.json,application/pdf,text/plain,text/csv,application/json";
      if (fileRef.current) {
        fileRef.current.accept = acceptRef.current;
        fileRef.current.click();
      }
    },
  }));

  const upload = async (list: FileList) => {
    for (const f of Array.from(list).slice(0, 4)) {
      // Client-side pre-validation: no silent server round-trip for obvious failures
      const fail = validateClient(f);
      if (fail) {
        onError?.(fail);
        setFiles((prev) => [
          ...prev,
          { id: `v-${Date.now()}-${f.name}`, name: fail, error: true },
        ]);
        continue;
      }
      const tempId = `u-${Date.now()}-${f.name}`;
      setFiles((prev) => [...prev, { id: tempId, name: f.name, uploading: true }]);
      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await api<FileItem>("/api/files", { method: "POST", body: fd });
        setFiles((prev) =>
          prev.map((p) => (p.id === tempId ? { ...res, uploading: false } : p))
        );
      } catch (e) {
        const msg = (e as Error).message;
        onError?.(msg);
        setFiles((prev) =>
          prev.map((p) =>
            p.id === tempId ? { ...p, uploading: false, error: true, name: msg } : p
          )
        );
      }
    }
  };

  const canSend = (text.trim().length > 0 || files.some((f) => !f.error && f.id)) && !busy;

  const send = () => {
    if (!canSend) return;
    const ids = files.filter((f) => f.id && !f.error && !f.uploading).map((f) => f.id!) as string[];
    onSend(text.trim(), ids);
    setText("");
    setFiles([]);
    requestAnimationFrame(autosize);
  };

  const empty = text.trim().length === 0 && files.length === 0;

  return (
    // In-flow flex child of the chat column — always visible at the bottom,
    // never pushed by message content, never hidden behind the mobile tab bar
    // (the bottom padding clears the fixed tab bar; desktop rail resets it).
    <div className="pointer-events-none shrink-0 bg-gradient-to-t from-void via-void/80 to-transparent px-3 pt-2 pb-[calc(78px+env(safe-area-inset-bottom,0px))] md:px-6 lg:pt-3 lg:pb-5">
      <div className="pointer-events-auto mx-auto w-full max-w-[780px] rounded-[26px] border border-line glass p-2 shadow-2xl shadow-black/40 transition-all duration-300 focus-within:border-violet/50 focus-within:shadow-violet/10">
        {/* attachment chips */}
        <AnimatePresence>
          {files.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex flex-wrap gap-1.5 px-1.5 pt-1 pb-1.5"
            >
              {files.map((f) => (
                <span
                  key={f.id}
                  className={clsx(
                    "flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
                    f.error ? "border-danger/40 bg-danger/10 text-danger" : "border-line bg-card text-mist"
                  )}
                >
                  {f.uploading ? (
                    <Spinner className="h-3 w-3" />
                  ) : f.isImage || /\.(png|jpe?g|webp)$/i.test(f.name ?? "") ? (
                    <ImageIcon size={11} />
                  ) : (
                    <FileText size={11} />
                  )}
                  <span className="max-w-[180px] truncate">{f.name}</span>
                  <button
                    onClick={() => setFiles((prev) => prev.filter((p) => p.id !== f.id))}
                    className="text-faint hover:text-frost"
                    aria-label="Remove attachment"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-end gap-1.5">
          <Pressable
            onClick={() => {
              acceptRef.current =
                "image/png,image/jpeg,image/webp,.txt,.md,.csv,.json,application/pdf,text/plain,text/csv,application/json";
              if (fileRef.current) {
                fileRef.current.accept = acceptRef.current;
                fileRef.current.click();
              }
            }}
            disabled={busy}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-mist hover:bg-elev hover:text-frost"
            aria-label="Attach a file"
          >
            <Paperclip size={18} />
          </Pressable>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) upload(e.target.files);
              e.target.value = "";
            }}
          />

          <textarea
            ref={taRef}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              autosize();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={placeholder ?? "Ask Aura anything…"}
            className="max-h-[132px] flex-1 resize-none bg-transparent px-1.5 py-2.5 text-[14.5px] leading-snug text-frost outline-none placeholder:text-faint"
          />

          {empty ? (
            <Pressable
              onClick={onVoice}
              disabled={busy}
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet text-white shadow-lg shadow-violet/30"
              aria-label="Voice input"
            >
              <span className="absolute inset-0 animate-ping rounded-full bg-violet/25 [animation-duration:2.4s]" />
              <Mic size={18} className="relative" />
            </Pressable>
          ) : (
            <Pressable
              onClick={send}
              disabled={!canSend}
              className={clsx(
                "grid h-11 w-11 shrink-0 place-items-center rounded-full text-white transition-all duration-200",
                canSend
                  ? "bg-gradient-to-br from-violet to-azure shadow-lg shadow-violet/30"
                  : "bg-line text-mist"
              )}
              aria-label="Send message"
            >
              {busy ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : <ArrowUp size={18} />}
            </Pressable>
          )}
        </div>
      </div>
    </div>
  );
});
