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
import { AlertCircle, ArrowUp, FileText, Mic, Paperclip, Square, X } from "lucide-react";
import { Spinner } from "@/components/ui";
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
  /** stop an in-flight generation */
  onStop?: () => void;
}

interface Attachment {
  key: string;
  id?: string;
  name: string;
  previewUrl?: string;
  isImage?: boolean;
  uploading?: boolean;
  error?: string;
}

const MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);
const DOC_EXTS = new Set(["txt", "md", "csv", "json", "pdf"]);
const ALL_ACCEPT =
  "image/png,image/jpeg,image/webp,.txt,.md,.csv,.json,application/pdf,text/plain,text/csv,application/json";
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const DOC_ACCEPT = ".txt,.md,.csv,.json,application/pdf,text/plain,text/csv,application/json";

function validateClient(f: File): string | null {
  const ext = (f.name.toLowerCase().split(".").pop() ?? "").trim();
  if (ext === "heic" || ext === "heif" || f.type === "image/heic")
    return "HEIC photos aren’t supported — export as JPG first.";
  if (f.size > MAX_BYTES)
    return `“${f.name}” is larger than 2 MB. Share it as Medium/Small or compress it.`;
  const okType =
    IMAGE_EXTS.has(ext) ||
    DOC_EXTS.has(ext) ||
    f.type.startsWith("image/") ||
    f.type.startsWith("text/") ||
    f.type === "application/pdf";
  if (!okType) return `“${f.name}” isn’t supported. Use PNG, JPG, WebP, PDF, TXT, MD, CSV or JSON.`;
  return null;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { onSend, onVoice, busy, placeholder, onError, onStop },
  ref
) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  useEffect(
    () => () => {
      objectUrls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    []
  );

  const autosize = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 148) + "px";
  }, []);

  const pick = useCallback((mode: "image" | "file" | "all") => {
    if (!fileRef.current) return;
    fileRef.current.accept =
      mode === "image" ? IMAGE_ACCEPT : mode === "file" ? DOC_ACCEPT : ALL_ACCEPT;
    fileRef.current.click();
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
    openAttach: (mode: "image" | "file") => pick(mode),
  }));

  const upload = async (list: FileList) => {
    for (const f of Array.from(list).slice(0, 4)) {
      const key = `${Date.now()}-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
      const fail = validateClient(f);
      if (fail) {
        onError?.(fail);
        setFiles((p) => [...p, { key, name: f.name, error: fail }]);
        continue;
      }
      const isImage = f.type.startsWith("image/");
      let previewUrl: string | undefined;
      if (isImage) {
        previewUrl = URL.createObjectURL(f);
        objectUrls.current.push(previewUrl);
      }
      setFiles((p) => [...p, { key, name: f.name, uploading: true, isImage, previewUrl }]);
      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await api<FileItem>("/api/files", { method: "POST", body: fd });
        setFiles((p) =>
          p.map((a) => (a.key === key ? { ...a, id: res.id, uploading: false } : a))
        );
      } catch (e) {
        const msg = (e as Error).message;
        onError?.(msg);
        setFiles((p) => p.map((a) => (a.key === key ? { ...a, uploading: false, error: msg } : a)));
      }
    }
  };

  const remove = (key: string) => setFiles((p) => p.filter((a) => a.key !== key));

  const ready = files.filter((f) => f.id && !f.error && !f.uploading);
  const uploading = files.some((f) => f.uploading);
  const canSend = (text.trim().length > 0 || ready.length > 0) && !busy && !uploading;
  const empty = text.trim().length === 0 && files.length === 0;

  const send = () => {
    if (!canSend) return;
    onSend(text.trim(), ready.map((f) => f.id!) as string[]);
    setText("");
    setFiles([]);
    requestAnimationFrame(autosize);
  };

  return (
    <div className="pointer-events-none shrink-0 bg-gradient-to-t from-void via-void/85 to-transparent px-3 pt-3 pb-[calc(78px+env(safe-area-inset-bottom,0px))] md:px-6 lg:pt-4 lg:pb-5">
      <div className="pointer-events-auto mx-auto w-full max-w-[780px]">
        <div
          className={clsx(
            "rounded-2xl border bg-card p-2 transition-colors duration-200 elevated",
            "border-line focus-within:border-violet/55"
          )}
        >
          {/* attachment previews */}
          <AnimatePresence initial={false}>
            {files.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="flex flex-wrap gap-2 px-1 pt-1 pb-2"
              >
                {files.map((f) => (
                  <div
                    key={f.key}
                    className={clsx(
                      "group relative flex items-center gap-2 rounded-xl border py-1.5 pr-7 pl-1.5",
                      f.error ? "border-danger/40 bg-danger/8" : "border-line bg-elev"
                    )}
                  >
                    {f.error ? (
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-danger/12 text-danger">
                        <AlertCircle size={15} />
                      </span>
                    ) : f.previewUrl ? (
                      <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-abyss">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.previewUrl} alt="" className="h-full w-full object-cover" />
                        {f.uploading && (
                          <span className="absolute inset-0 grid place-items-center bg-black/55">
                            <Spinner className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-abyss text-mist">
                        {f.uploading ? <Spinner className="h-3.5 w-3.5" /> : <FileText size={15} />}
                      </span>
                    )}
                    <span className="min-w-0 max-w-[160px]">
                      <span
                        className={clsx(
                          "block truncate text-[11.5px] font-medium",
                          f.error ? "text-danger" : "text-frost"
                        )}
                      >
                        {f.error ? f.error : f.name}
                      </span>
                      <span className="block text-[10px] text-faint">
                        {f.error ? "not attached" : f.uploading ? "uploading…" : "ready"}
                      </span>
                    </span>
                    <button
                      onClick={() => remove(f.key)}
                      className="absolute top-1/2 right-1.5 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-md text-faint hover:bg-card hover:text-frost"
                      aria-label={`Remove ${f.name}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-end gap-1">
            <button
              onClick={() => pick("all")}
              disabled={busy}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-mist transition-colors hover:bg-elev hover:text-frost disabled:opacity-40"
              aria-label="Attach image or file"
              title="Attach (PNG, JPG, WebP, PDF, TXT ≤ 2 MB)"
            >
              <Paperclip size={17} />
            </button>
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
              placeholder={placeholder ?? "Ask anything…"}
              aria-label="Message"
              className="max-h-[148px] min-h-[36px] flex-1 resize-none bg-transparent px-1.5 py-2 text-[14.5px] leading-6 text-frost outline-none placeholder:text-faint"
            />

            {busy && onStop ? (
              <button
                onClick={onStop}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-elev text-frost transition-colors hover:border-danger/50 hover:text-danger"
                aria-label="Stop generating"
                title="Stop generating"
              >
                <Square size={13} strokeWidth={3} className="fill-current" />
              </button>
            ) : empty ? (
              <button
                onClick={onVoice}
                disabled={busy}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-mist transition-colors hover:bg-elev hover:text-frost disabled:opacity-40"
                aria-label="Voice input"
                title="Voice input"
              >
                <Mic size={17} />
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!canSend}
                className={clsx(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors",
                  canSend
                    ? "bg-violet text-white hover:bg-iris"
                    : "bg-elev text-faint"
                )}
                aria-label={busy ? "Sending" : "Send message"}
              >
                {busy || uploading ? (
                  <Spinner className="h-4 w-4 border-white/30 border-t-white" />
                ) : (
                  <ArrowUp size={17} strokeWidth={2.4} />
                )}
              </button>
            )}
          </div>
        </div>
        <p className="mt-1.5 hidden text-center text-[10.5px] text-faint lg:block">
          Enter to send · Shift + Enter for a new line
        </p>
      </div>
    </div>
  );
});
