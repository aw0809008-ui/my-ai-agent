"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, RefreshCcw, X } from "lucide-react";
import { Orb } from "@/components/orb";
import { Pressable, inputCls } from "@/components/ui";
import { api, ApiFail } from "@/lib/client";
import clsx from "clsx";

type Phase = "listening" | "processing" | "review" | "error";

export function VoiceOverlay({
  open,
  onClose,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  onUse: (text: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("listening");
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<any>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const finalRef = useRef("");

  const stopAll = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {}
    try {
      if (mediaRecRef.current?.state === "recording") mediaRecRef.current.stop();
    } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setPhase("listening");
    setTranscript("");
    setInterim("");
    finalRef.current = "";
    setErrorMsg("");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch {
      setPhase("error");
      setErrorMsg("Microphone access was denied. Allow mic permission and try again.");
      return;
    }

    // live level meter
    try {
      const ac = new AudioContext();
      const src = ac.createMediaStreamSource(stream);
      const an = ac.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const loop = () => {
        if (!streamRef.current) return;
        an.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        setLevel(Math.min(1, (sum / buf.length / 140) * 1.4));
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    } catch {}

    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      const rec = new SR();
      recRef.current = rec;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || "en-US";
      rec.onresult = (e: any) => {
        let inter = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalRef.current += r[0].transcript + " ";
          else inter = r[0].transcript;
        }
        setTranscript(finalRef.current.trim());
        setInterim(inter);
      };
      rec.onerror = () => {};
      rec.onend = () => {
        // auto-restart while still in listening phase
        if (streamRef.current) {
          try {
            rec.start();
          } catch {}
        }
      };
      try {
        rec.start();
      } catch {}
    } else {
      // server transcription fallback via self-hosted Whisper endpoint
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : undefined;
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      mr.start(400);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    if (open) {
      // defer so state updates never run synchronously inside the effect
      queueMicrotask(() => {
        if (alive) start();
      });
    } else {
      stopAll();
    }
    return () => {
      alive = false;
      stopAll();
    };
  }, [open, start, stopAll]);

  const stopListening = async () => {
    const hadSR = Boolean(recRef.current);
    if (hadSR) {
      stopAll();
      const text = finalRef.current.trim();
      if (text) {
        setTranscript(text);
        setPhase("review");
      } else {
        setPhase("error");
        setErrorMsg("I didn't catch anything. Tap retry and speak clearly.");
      }
    } else if (mediaRecRef.current) {
      setPhase("processing");
      const mr = mediaRecRef.current;
      const stopped = new Promise<void>((res) => {
        mr.onstop = () => res();
      });
      try {
        recRef.current = null;
        mr.stop();
      } catch {}
      await stopped;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      try {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        const fd = new FormData();
        fd.append("audio", blob, "voice.webm");
        const res = await api<{ text: string }>("/api/transcribe", {
          method: "POST",
          body: fd,
        });
        if (res.text.trim()) {
          setTranscript(res.text.trim());
          setPhase("review");
        } else {
          setPhase("error");
          setErrorMsg("The transcription came back empty. Try again.");
        }
      } catch (e) {
        setPhase("error");
        setErrorMsg(
          e instanceof ApiFail
            ? e.message +
                " (This browser has no on-device speech recognition — set STT_MODEL on your AI gateway for server transcription.)"
            : "Transcription failed."
        );
      }
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 mx-auto flex w-full max-w-[430px] flex-col bg-void/95 backdrop-blur-2xl md:max-w-[560px]"
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(55% 35% at 50% 12%, rgba(34,211,238,0.12), transparent 70%)",
            }}
          />
          <div className="relative flex justify-end p-4">
            <Pressable
              onClick={onClose}
              className="grid h-10 w-10 place-items-center rounded-full border border-line bg-card text-mist"
              aria-label="Cancel voice input"
            >
              <X size={17} />
            </Pressable>
          </div>

          <div className="relative flex flex-1 flex-col items-center justify-center gap-7 px-8">
            <Orb
              state={phase === "error" ? "error" : phase === "processing" ? "thinking" : "listening"}
              size={210}
              micLevel={level}
            />

            {phase === "listening" && (
              <>
                <div className="flex h-8 items-end gap-1">
                  {Array.from({ length: 17 }).map((_, i) => (
                    <span
                      key={i}
                      className="eq-bar w-1 rounded-full bg-gradient-to-t from-violet to-cyan"
                      style={{
                        height: `${8 + Math.sin(i / 1.7) * 6 + level * (16 + (i % 5) * 4)}px`,
                        animationDelay: `${i * 0.07}s`,
                      }}
                    />
                  ))}
                </div>
                <p className="font-display text-[15px] font-medium text-frost">Listening…</p>
                <p className="min-h-[44px] max-w-[300px] text-center text-[13px] leading-relaxed text-mist">
                  {transcript || interim ? (
                    <>
                      {transcript} <span className="text-cyan">{interim}</span>
                    </>
                  ) : (
                    "Speak now — your words appear here."
                  )}
                </p>
              </>
            )}

            {phase === "processing" && (
              <div className="flex items-center gap-2 text-mist">
                <Loader2 size={17} className="animate-spin" />
                <p className="text-[14px]">Transcribing on your server…</p>
              </div>
            )}

            {phase === "error" && (
              <p className="max-w-[310px] text-center text-[13px] leading-relaxed text-amber">
                {errorMsg}
              </p>
            )}

            {phase === "review" && (
              <div className="w-full max-w-[330px]">
                <p className="mb-2 text-center font-display text-[15px] font-medium">
                  Review before sending
                </p>
                <textarea
                  className={clsx(inputCls, "min-h-[110px] resize-none")}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="relative flex items-center justify-center gap-3 px-8 pb-12">
            {phase === "listening" && (
              <Pressable
                onClick={stopListening}
                className="flex items-center gap-2 rounded-full bg-violet px-7 py-3.5 text-[14px] font-semibold text-white shadow-lg shadow-violet/30"
              >
                <span className="h-3 w-3 rounded-[3px] bg-white" />
                Stop
              </Pressable>
            )}
            {phase === "error" && (
              <Pressable
                onClick={start}
                className="flex items-center gap-2 rounded-full bg-violet px-7 py-3.5 text-[14px] font-semibold text-white"
              >
                <RefreshCcw size={15} /> Retry
              </Pressable>
            )}
            {phase === "review" && (
              <>
                <Pressable
                  onClick={start}
                  className="rounded-full border border-line bg-card px-6 py-3.5 text-[13.5px] font-semibold text-mist"
                >
                  Redo
                </Pressable>
                <Pressable
                  onClick={() => {
                    if (transcript.trim()) onUse(transcript.trim());
                    onClose();
                  }}
                  className="flex items-center gap-2 rounded-full bg-violet px-7 py-3.5 text-[14px] font-semibold text-white shadow-lg shadow-violet/30"
                >
                  <Check size={15} /> Use text
                </Pressable>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
