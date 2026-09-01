"use client";

import { type ReactNode, type ButtonHTMLAttributes } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, type LucideIcon } from "lucide-react";
import clsx from "clsx";

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-mist/30 border-t-violet",
        className
      )}
    />
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-3 px-8 py-12 text-center"
    >
      <div className="gradient-border grid h-14 w-14 place-items-center rounded-2xl bg-elev text-violet">
        <Icon size={24} strokeWidth={1.6} />
      </div>
      <div>
        <p className="font-display text-[15px] font-semibold text-frost">{title}</p>
        <p className="mt-1 max-w-[260px] text-[13px] leading-relaxed text-mist">{body}</p>
      </div>
      {action}
    </motion.div>
  );
}

export function Pressable({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={clsx("transition-colors duration-200 disabled:opacity-40", className)}
      {...(props as object)}
    >
      {children}
    </motion.button>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-6 pb-4">
      <div>
        <h1 className="font-display text-[22px] font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-mist">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[430px] rounded-t-3xl border-t border-line bg-abyss pb-safe"
          >
            <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-line" />
            <div className="flex items-center justify-between px-5 pt-3 pb-2">
              <p className="font-display text-[16px] font-semibold">{title}</p>
              <Pressable
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-full bg-elev text-mist"
                aria-label="Close"
              >
                <X size={16} />
              </Pressable>
            </div>
            <div className="max-h-[72dvh] overflow-y-auto px-5 pb-6 slim-scroll">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium tracking-wide text-mist uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full rounded-2xl border border-line bg-elev px-4 py-3 text-[14px] text-frost placeholder:text-faint outline-none transition-all duration-200 focus:border-violet/60 focus:ring-2 focus:ring-violet/20";

export function Chip({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Pressable
      onClick={onClick}
      className={clsx(
        "rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium",
        active
          ? "border-violet/50 bg-violet/15 text-frost"
          : "border-line bg-card text-mist hover:text-frost"
      )}
    >
      {children}
    </Pressable>
  );
}
