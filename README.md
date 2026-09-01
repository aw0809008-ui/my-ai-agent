# aura — your self-hosted personal AI

> A personal AI assistant that runs on infrastructure **you own**.
> App → your backend → your AI gateway → your GPU server → open-source models.
> **Zero proprietary AI APIs** — no OpenAI, Anthropic, Gemini, Groq, OpenRouter, Together, Replicate, etc.

---

## 1. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  PWA (Next.js, mobile-first)                                         │
│  Home · Chat (SSE streaming) · Memory · Notes · Tasks · Settings     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ HTTPS (session cookie auth)
┌──────────────────────────────▼───────────────────────────────────────┐
│  Application Backend (Next.js route handlers)                        │
│  auth · conversations · chat orchestrator · memories · notes         │
│  reminders · files · search-proxy · admin stats · rate limiting      │
└───────┬──────────────────────┬──────────────────┬────────────────────┘
        │                      │                  │
┌───────▼───────┐   ┌──────────▼─────────┐   ┌────▼────────────────────┐
│  PostgreSQL   │   │  AI Gateway        │   │  Web search abstraction │
│  (Drizzle ORM)│   │  (src/lib/ai-      │   │  SearXNG  → DuckDuckGo  │
│  users, msgs, │   │  gateway.ts)       │   │  (no API keys needed)   │
│  memories,    │   └──────────┬─────────┘   └─────────────────────────┘
│  notes, files │              │
└───────────────┘   ┌──────────▼──────────────────────────────────────┐
                    │  Self-hosted model server (your GPU host)       │
                    │  vLLM · Ollama · llama.cpp · TGI                │
                    │  chat LLM · vision · embeddings · whisper STT   │
                    └─────────────────────────────────────────────────┘
```

**Model-agnostic provider interface** (`src/lib/ai-gateway.ts`):

| Method | Purpose | Requirement |
|---|---|---|
| `generateText()` / `streamText()` | conversation, reasoning, tool selection | `AI_BASE_URL` + `AI_MODEL` |
| `analyzeImage()` | image/chart/document understanding | `VISION_MODEL` on the gateway |
| `generateEmbedding()` | memory/notes/file retrieval | `EMBEDDING_MODEL`, else built-in sparse lexical retrieval |
| `transcribeAudio()` | server voice transcription (Whisper-compatible) | `STT_MODEL` |
| `aiHealth()` | reachability + status chip in UI | — |

Swap models by changing env vars — the mobile app never changes.

**Model router:** explicit commands ("remind me…", "remember…", "search…") are executed by a
deterministic local intent parser (`src/lib/intent.ts`) — zero GPU tokens, instant, and they
keep working when the LLM is down. Open-ended conversation goes to the self-hosted LLM with a
validated tool-call protocol.

## 2. What actually works out of the box

| Feature | Status |
|---|---|
| Email/password auth (bcrypt), sessions, logout, password reset | ✅ real |
| Onboarding (name, language, timezone, memory, notifications) | ✅ real |
| Streaming chat UI (SSE), markdown/code/tables, conversation history, rename/pin/archive | ✅ real |
| Reminders from natural language (timezones, recur daily/weekly, snooze, in-app + browser notifications) | ✅ real, no LLM needed |
| Long-term memory (save/recall/edit/wipe, category, importance, semantic retrieval) | ✅ real |
| Notes (semantic search, pin, archive) | ✅ real |
| Web search (SearXNG self-hosted → DuckDuckGo fallback) with source cards | ✅ real |
| Document upload + inline analysis (TXT/MD/CSV/JSON; basic PDF text extraction) with RAG chunking | ✅ real |
| Image analysis | ⚙️ requires `VISION_MODEL` on your gateway |
| Voice input | ✅ on-device browser ASR (Chrome) · server Whisper via `STT_MODEL` fallback |
| Text-to-speech | ✅ browser voices (settings: voice/speed/autoplay/mute) |
| Open-ended LLM conversation + LLM-chosen tool calls | ⚙️ requires `AI_BASE_URL` + `AI_MODEL` |
| Admin dashboard (users, requests, tool errors, model status, storage) | ✅ real |
| Data export (JSON), rate limiting, request validation, file limits | ✅ real |

**Real-functionality rule:** where a feature needs your self-hosted model, the UI says so
honestly instead of faking output. Nothing pretends to be AI.

## 3. Installation

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL at minimum
npx drizzle-kit push          # create tables
npm run dev
```

Open on a phone (or a 390px device frame) for the intended experience.

## 4. Environment variables

See **`.env.example`** — everything is documented there. Server-side only; the client
receives no secrets (the mobile app → backend → gateway flow means model credentials never
touch the device).

## 5. Database

PostgreSQL via Drizzle. Tables: `users`, `sessions`, `password_reset_tokens`, `profiles`,
`user_settings`, `conversations`, `messages`, `memories`, `notes`, `reminders`, `files`,
`tool_calls`, `notifications`, `usage_events` — with FKs (cascade), indexes, and per-user
ownership enforced in every query. Apply with `npx drizzle-kit push`.

Embeddings are stored as float arrays and compared in-process (personal-scale). For
multi-user scale, enable pgvector and set `EMBEDDING_MODEL` for neural embeddings — the
retrieval interface in `src/lib/embeddings.ts` / `ai-gateway.ts` already abstracts this.

## 6. Model setup (GPU host)

**Recommended starting models** (license-clean, strong quality/GB):

| Role | Model | Min VRAM | Why |
|---|---|---|---|
| Chat | **Qwen2.5-14B-Instruct** (AWQ/GPTQ ≈ 9 GB) or **Llama-3.1-8B-Instruct** (≈ 6 GB FP8) | 12 GB | excellent tool-following + multilingual (incl. Urdu), permissive license |
| Vision | **Qwen2.5-VL-7B-Instruct** | ≈ 10 GB | best open OCR/document understanding per GB |
| Embeddings | **bge-m3** | ≈ 2 GB | multilingual, strong hybrid retrieval |
| STT | **whisper-large-v3-turbo** | ≈ 6 GB | fast, accurate, multilingual |
| TTS (future) | Kokoro-82M / Piper | CPU-ok | tiny, real-time |

### Run the inference server (vLLM — simplest production option)

```bash
# on your GPU host (≥ 24 GB recommended for chat+vision together)
pip install vllm
vllm serve Qwen/Qwen2.5-14B-Instruct-AWQ \
  --served-model-name qwen2.5-14b \
  --max-model-len 8192 --port 8000
```

Point the backend at it:

```
AI_BASE_URL=http://<gpu-host>:8000
AI_MODEL=qwen2.5-14b
```

**Ollama alternative:** `ollama serve` then `AI_BASE_URL=http://<gpu-host>:11434`, `AI_MODEL=qwen2.5:7b-instruct`.
**llama.cpp:** `llama-server -m model.gguf --port 8080` (same `/v1` API).

To **replace the model**: rerun the server with a different model and update `AI_MODEL`. Done.

## 7. Tools (function calling)

Internal registry: `search_web`, `save_memory`, `search_memory`, `delete_memory`,
`create_note`, `search_notes`, `create_reminder`, `list_reminders`, `analyze_file`,
`analyze_image`, `get_current_time`.

Every call: **schema validation (zod) → permission/ownership checks → timeout → execution →
audit row in `tool_calls`**. The model requests; the backend decides. No arbitrary
model-generated code paths. Add a new tool by adding one `ToolDef` in `src/lib/tools.ts`.

## 8. API map

```
POST /api/auth/register|login|logout      GET /api/auth/me   PATCH /api/auth/profile
POST /api/auth/reset  PUT /api/auth/reset
POST /api/chat (SSE stream)               POST /api/transcribe
GET|POST /api/conversations               GET|PATCH|DELETE /api/conversations/[id]
GET /api/conversations/[id]/messages
GET|POST|DELETE /api/memories             PATCH|DELETE /api/memories/[id]
GET|POST /api/notes                       PATCH|DELETE /api/notes/[id]
GET|POST /api/reminders                   PATCH|DELETE /api/reminders/[id]
GET|POST /api/files                       GET|DELETE /api/files/[id]
POST /api/search                          GET /api/notifications
GET /api/export                           GET /api/admin/stats (admin only)
GET /api/health
```

## 9. Security notes

- Sessions: random 256-bit tokens, **sha256 at rest**, httpOnly SameSite cookies, 30-day expiry.
- Passwords: bcrypt(12). Reset tokens: hashed, single-use, 30-min TTL, session wipe on reset.
- Rate limits per user/IP on auth, chat, search, upload, STT, export.
- File uploads: 2 MB cap, MIME/extension whitelist, owner-only serving, never executed.
- Every query is scoped by `userId`; admin routes check `role='admin'`.
- No stack traces to clients; structured JSON logs with request IDs server-side.

## 10. Deployment

### Vercel (fastest)

1. Push this repo to GitHub, then **Import Project** in Vercel (Framework: Next.js — auto-detected).
2. Create a Postgres database — e.g. **Neon** or **Vercel Postgres** (free tier) — and copy its
   **pooled** connection string.
3. Vercel → Project → Settings → Environment Variables:
   - `DATABASE_URL` — required (pooled Postgres URL)
   - optional: `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, `VISION_MODEL`, `STT_MODEL`,
     `EMBEDDING_MODEL`, `SEARXNG_URL`, `EXPOSE_RESET_LINK` (`false` for public deployments)
4. Create the tables once (from your machine, with env set):
   ```bash
   DATABASE_URL=<your-pooled-url> npx drizzle-kit push
   ```
5. Deploy. Open your `*.vercel.app` domain, register the first account (it becomes **admin**),
   complete onboarding — done.

Notes for Vercel: SSE streaming works on serverless functions; uploads are capped at 2 MB
(Vercel body limit is 4.5 MB). The first registered user owns the admin dashboard.

### Self-hosted (VPS / Docker / bare metal)

One Node process is enough to start (backend + frontend). Put it behind HTTPS (Caddy/nginx),
run Postgres 15+, and point `AI_BASE_URL` at your GPU box over a private network or
WireGuard/Tailscale. Add a push relay (`NOTIFICATION_CONFIG` hook) and SearXNG container when
ready. Everything is modular — files can move to object storage, embeddings to pgvector,
search to SearXNG without app changes.

## 11. Roadmap (architecture already supports)

Image/video generation · agents & browser automation · email/calendar/Drive/GitHub/WhatsApp
connectors · multi-model routing · server TTS (Kokoro/Piper) · pgvector for large-scale RAG ·
react-native shell reusing this exact API.

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| "AI not linked" chip | Set `AI_BASE_URL` + `AI_MODEL`, restart backend |
| "Model server unreachable" | GPU box down / firewall; check `GET /v1/models` from the backend host |
| Voice says STT unavailable | Use Chrome (on-device ASR) or set `STT_MODEL` |
| Vision says not configured | Set `VISION_MODEL` to a VLM on your gateway |
| Search empty | Network egress blocked, or set up SearXNG (`SEARXNG_URL`) |
