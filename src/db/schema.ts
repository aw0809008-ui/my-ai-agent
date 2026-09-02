import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";

// bytea column for storing small user files directly in Postgres
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("user"), // user | admin
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)]
);

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(), // sha256 of the cookie token
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)]
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("prt_user_idx").on(t.userId)]
);

// ---------------------------------------------------------------------------
// Profile & settings
// ---------------------------------------------------------------------------

export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull().default(""),
  timezone: text("timezone").notNull().default("UTC"),
  language: text("language").notNull().default("en"), // en | ur | roman-ur
  onboardingDone: boolean("onboarding_done").notNull().default(false),
  memoryEnabled: boolean("memory_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("dark"), // dark | light | system
  voice: jsonb("voice")
    .$type<{
      enabled?: boolean;
      autoplay?: boolean;
      rate?: number;
      voiceName?: string;
    }>()
    .notNull()
    .default({ enabled: false, autoplay: false, rate: 1, voiceName: "" }),
  notifications: jsonb("notifications")
    .$type<{ enabled?: boolean; sound?: boolean }>()
    .notNull()
    .default({ enabled: true, sound: true }),
  ai: jsonb("ai")
    .$type<{ style?: string; modelPreference?: string }>()
    .notNull()
    .default({ style: "balanced", modelPreference: "auto" }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New conversation"),
    pinned: boolean("pinned").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("conv_user_updated_idx").on(t.userId, t.updatedAt),
    index("conv_user_pinned_idx").on(t.userId, t.pinned),
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant | tool
    content: text("content").notNull(),
    sources: jsonb("sources").$type<
      { title: string; url: string; snippet: string }[]
    >(),
    toolEvents: jsonb("tool_events").$type<
      { name: string; status: string; detail?: string }[]
    >(),
    model: text("model"), // which model produced this assistant message
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("msg_conv_created_idx").on(t.conversationId, t.createdAt)]
);

// ---------------------------------------------------------------------------
// Memory (long-term) — embeddings stored as float arrays (sparse lexical
// vectors by default; swap to a neural embedding model via AI gateway).
// ---------------------------------------------------------------------------

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull().default("personal"), // personal | preferences | work | projects | important | temporary
    content: text("content").notNull(),
    importance: integer("importance").notNull().default(3), // 1..5
    embedding: jsonb("embedding").$type<number[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mem_user_idx").on(t.userId),
    index("mem_user_cat_idx").on(t.userId, t.category),
  ]
);

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Untitled note"),
    content: text("content").notNull().default(""),
    pinned: boolean("pinned").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    embedding: jsonb("embedding").$type<number[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notes_user_updated_idx").on(t.userId, t.updatedAt),
    index("notes_user_pinned_idx").on(t.userId, t.pinned),
  ]
);

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    task: text("task").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    recurrence: text("recurrence").notNull().default("none"), // none | daily | weekly
    status: text("status").notNull().default("pending"), // pending | done | dismissed
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    snoozeCount: integer("snooze_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("rem_user_due_idx").on(t.userId, t.dueAt),
    index("rem_user_status_idx").on(t.userId, t.status),
  ]
);

// ---------------------------------------------------------------------------
// Files (documents / images stored in Postgres, ≤ 2 MB each)
// ---------------------------------------------------------------------------

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    content: bytea("content").notNull(),
    extractedText: text("extracted_text"),
    embedding: jsonb("embedding").$type<number[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("files_user_idx").on(t.userId)]
);

// ---------------------------------------------------------------------------
// Tool calls, notifications, usage events (observability)
// ---------------------------------------------------------------------------

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    args: jsonb("args").$type<Record<string, unknown>>(),
    status: text("status").notNull(), // ok | error | denied
    durationMs: integer("duration_ms").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("tc_user_idx").on(t.userId), index("tc_tool_idx").on(t.tool)]
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("reminder"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("notif_user_read_idx").on(t.userId, t.read)]
);

// ---------------------------------------------------------------------------
// Web App Builder — generated projects + lightweight version snapshots.
// Files are stored as JSON (never on disk) so this works on serverless.
// Generated code is UNTRUSTED and is only ever executed inside a sandboxed,
// null-origin iframe in the browser — never on the server.
// ---------------------------------------------------------------------------

export interface ProjectFile {
  path: string;
  content: string;
}

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull().default("Untitled app"),
    framework: text("framework").notNull().default("react"),
    entry: text("entry").notNull().default("src/App.tsx"),
    files: jsonb("files").$type<ProjectFile[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("proj_user_updated_idx").on(t.userId, t.updatedAt),
    index("proj_conv_idx").on(t.conversationId),
  ]
);

export const projectVersions = pgTable(
  "project_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull().default("update"),
    files: jsonb("files").$type<ProjectFile[]>().notNull().default([]),
    entry: text("entry").notNull().default("src/App.tsx"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("pv_project_created_idx").on(t.projectId, t.createdAt)]
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // chat | embedding | search | stt | vision
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ue_user_idx").on(t.userId), index("ue_kind_idx").on(t.kind)]
);

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
