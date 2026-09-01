"use client";

// Shared client helpers + types for the Aura UI.

export interface ApiUser {
  id: string;
  email: string;
  role: string;
  displayName: string;
  timezone: string;
  language: "en" | "ur" | "roman-ur";
  onboardingDone: boolean;
  memoryEnabled: boolean;
}

export interface UserSettings {
  theme: "dark" | "light" | "system";
  voice: { enabled?: boolean; autoplay?: boolean; rate?: number; voiceName?: string };
  notifications: { enabled?: boolean; sound?: boolean };
  ai: { style?: string; modelPreference?: string };
}

export interface AiHealth {
  configured: boolean;
  reachable: boolean;
  model: string;
}

export interface ConversationItem {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface SourceItem {
  title: string;
  url: string;
  snippet: string;
}

export interface ToolEventItem {
  name: string;
  status: string;
  detail?: string;
}

export interface MessageItem {
  id: string;
  role: "user" | "assistant" | string;
  content: string;
  sources?: SourceItem[] | null;
  toolEvents?: ToolEventItem[] | null;
  createdAt: string;
}

export interface MemoryItem {
  id: string;
  content: string;
  category: string;
  importance: number;
  score?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  archived: boolean;
  score?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderItem {
  id: string;
  task: string;
  dueAt: string;
  timezone: string;
  recurrence: string;
  status: string;
  overdue: boolean;
  notified: boolean;
  createdAt: string;
}

export interface FileItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  hasText: boolean;
  isImage: boolean;
  createdAt: string;
}

export class ApiFail extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Bearer session fallback for contexts where third-party cookies are blocked
// (cross-site iframes, preview embeds). The httpOnly cookie remains primary.
//
// Layered storage:
//   1. In-memory module variable — ALWAYS works during an SPA session, even
//      when the browser blocks ALL third-party storage (cookies + localStorage)
//      inside an iframe. Survives every client-side navigation.
//   2. localStorage — survives full page reloads when storage is allowed.
const TOKEN_KEY = "aura_token";
let memoryToken: string | null = null;

export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    const t = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (t) memoryToken = t;
    return t;
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  memoryToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage blocked — memory layer still covers this session */
  }
}

export function clearToken() {
  memoryToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function api<T = unknown>(
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...authHeaders(),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    const err = data?.error;
    throw new ApiFail(res.status, err?.code ?? "ERROR", err?.message ?? "Request failed.");
  }
  return data as T;
}

export function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatReminderTime(iso: string, tz: string): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  const dayFmt = (x: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(x);
  const now = new Date();
  if (dayFmt(d) === dayFmt(now)) return `Today, ${time}`;
  if (dayFmt(d) === dayFmt(new Date(now.getTime() + 86400000))) return `Tomorrow, ${time}`;
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(d) + `, ${time}`
  );
}
