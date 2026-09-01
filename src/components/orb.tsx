"use client";

import { useEffect, useRef } from "react";
import clsx from "clsx";

export type OrbState =
  | "idle"
  | "listening"
  | "thinking"
  | "responding"
  | "error"
  | "offline";

interface Particle {
  a: number; // angle
  r: number; // radius factor
  s: number; // speed
  z: number; // size
  o: number; // opacity
}

const STATE_COLORS: Record<OrbState, [string, string, string]> = {
  idle: ["#7c5cfc", "#4a8dff", "#22d3ee"],
  listening: ["#22d3ee", "#4a8dff", "#7c5cfc"],
  thinking: ["#a78bfa", "#7c5cfc", "#22d3ee"],
  responding: ["#6d6af8", "#22d3ee", "#7c5cfc"],
  error: ["#fbbf24", "#f87171", "#a78bfa"],
  offline: ["#3d465e", "#525d7d", "#6b7694"],
};

export function Orb({
  state = "idle",
  size = 200,
  micLevel = 0,
  className,
}: {
  state?: OrbState;
  size?: number;
  micLevel?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const micRef = useRef(micLevel);
  stateRef.current = state;
  micRef.current = micLevel;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const N = 46;
    const parts: Particle[] = Array.from({ length: N }, (_, i) => ({
      a: (i / N) * Math.PI * 2,
      r: 0.62 + Math.random() * 0.42,
      s: 0.0018 + Math.random() * 0.004,
      z: 0.6 + Math.random() * 1.7,
      o: 0.25 + Math.random() * 0.65,
    }));

    let raf = 0;
    let t = 0;
    const draw = () => {
      t += 1;
      const st = stateRef.current;
      const [c1, c2, c3] = STATE_COLORS[st];
      const cx = size / 2;
      const cy = size / 2;
      const base = size / 2;
      const mic = st === "listening" ? micRef.current : 0;
      const speedMul = st === "thinking" ? 3.4 : st === "responding" ? 1.7 : st === "offline" ? 0.35 : 1;
      const glowMul = st === "offline" ? 0.35 : st === "error" ? 0.8 : 1;

      ctx.clearRect(0, 0, size, size);

      // particles orbiting
      for (const p of parts) {
        p.a += p.s * speedMul * (1 + mic * 2);
        const wobble = Math.sin(t * 0.02 + p.a * 3) * 0.045 * (st === "thinking" ? 2.2 : 1);
        const rad = base * (p.r + wobble + mic * 0.14);
        const x = cx + Math.cos(p.a) * rad;
        const y = cy + Math.sin(p.a) * rad * 0.96;
        const alpha = p.o * glowMul * (0.55 + 0.45 * Math.sin(t * 0.03 + p.a * 5));
        ctx.beginPath();
        ctx.fillStyle = (p.a * 3) % 3 < 1 ? c1 : (p.a * 3) % 3 < 2 ? c2 : c3;
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.arc(x, y, p.z * (st === "thinking" ? 1.25 : 1), 0, Math.PI * 2);
        ctx.fill();
      }

      // orbiting energy streak (thinking)
      if (st === "thinking") {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = c3;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        const start = t * 0.035;
        ctx.arc(cx, cy, base * 0.78, start, start + Math.PI * 0.85);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  const [c1, c2, c3] = STATE_COLORS[state];
  const breatheClass =
    state === "thinking"
      ? "animate-[breathe_2.2s_ease-in-out_infinite]"
      : state === "responding"
        ? "animate-[breathe_3.4s_ease-in-out_infinite]"
        : state === "offline"
          ? ""
          : "animate-breathe";

  const listenScale = state === "listening" ? 1 + micLevel * 0.16 : 1;

  return (
    <div
      className={clsx("relative grid place-items-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Aura is ${state}`}
    >
      {/* outer pulse ring (listening / responding) */}
      {(state === "listening" || state === "responding") && (
        <div
          className="ring-pulse absolute rounded-full border"
          style={{ inset: 0, borderColor: `${c2}55` }}
        />
      )}

      {/* ambient glow */}
      <div
        className={clsx("absolute rounded-full blur-3xl transition-opacity duration-700", breatheClass)}
        style={{
          inset: "-18%",
          opacity: state === "offline" ? 0.25 : 0.6,
          background: `radial-gradient(circle at 35% 30%, ${c1}66, transparent 60%), radial-gradient(circle at 70% 70%, ${c3}55, transparent 60%)`,
          transform: `scale(${listenScale})`,
          transition: "transform 120ms linear",
        }}
      />

      {/* rotating conic halo */}
      <div
        className={clsx(
          "absolute rounded-full",
          state === "offline" ? "animate-spin-slower" : "animate-spin-slow"
        )}
        style={{
          inset: "4%",
          background: `conic-gradient(from 0deg, transparent 0deg, ${c1}55 60deg, transparent 130deg, ${c3}44 220deg, transparent 300deg)`,
          filter: "blur(10px)",
          opacity: state === "offline" ? 0.35 : 0.9,
        }}
      />

      {/* core sphere */}
      <div
        className={clsx("relative rounded-full", breatheClass)}
        style={{
          width: "58%",
          height: "58%",
          transform: `scale(${listenScale})`,
          background: `
            radial-gradient(circle at 32% 26%, rgba(255,255,255,0.85), rgba(255,255,255,0) 26%),
            radial-gradient(circle at 68% 74%, ${c3}cc, transparent 62%),
            radial-gradient(circle at 40% 55%, ${c2}, ${c1} 78%)
          `,
          boxShadow: `0 0 ${state === "offline" ? 18 : 44}px ${c1}66, inset 0 -10px 26px rgba(5,8,18,0.55), inset 0 8px 18px rgba(255,255,255,0.18)`,
          transition: "transform 120ms linear, box-shadow 500ms ease",
        }}
      >
        {/* inner swirl */}
        <div
          className={clsx("absolute inset-0 rounded-full", state === "offline" ? "animate-spin-slower" : "animate-spin-slow")}
          style={{
            background: `conic-gradient(from 90deg, transparent, rgba(255,255,255,0.28) 40deg, transparent 110deg, transparent 200deg, ${c3}55 260deg, transparent 320deg)`,
            mixBlendMode: "screen",
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 50% 115%, rgba(4,7,16,0.75), transparent 55%)",
          }}
        />
      </div>

      {/* particles */}
      <canvas ref={canvasRef} style={{ width: size, height: size }} className="absolute inset-0" />

      {/* offline indicator */}
      {state === "offline" && (
        <div className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-elev/90 px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" />
          <span className="text-[10px] font-medium tracking-wide text-mist uppercase">offline</span>
        </div>
      )}
    </div>
  );
}
