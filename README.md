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

## 1b. Model Router (OpenRouter orchestration)

`src/lib/model-router.ts` sits between the chat API and providers:

```
prompt ─► classify task (multi-signal, deterministic) ─► capability filter
      ─► preference scoring ─► ONE best model streams ─► fallback chain (max 3)
```

- **Registry** (`src/lib/model-registry.ts`): every model's ID, enabled flag, per-task
  preference, vision/audio/video/tools/JSON/reasoning flags and context size come from
  env vars (`MODEL_GLM`, `MODEL_GLM_VISION=true`, …). Multimodal flags default to
  **false** — enable them only after confirming the capability on
  https://openrouter.ai/models. Nothing pretends a model can see images.
- **Capability verification**: the provider's `/models` metadata (`architecture.input_modalities`,
  `tool_support`, `supported_parameters`, `context_length`) is fetched on a short-lived cache and
  **overrides assumptions** — a model is only used for images/audio/video/tools when OpenRouter
  itself reports that capability. Provider-confirmed capabilities unlock automatically;
  unconfirmed claims are ignored.

**Current routing matrix** (rank 1 = primary):

| Task | Chain |
|---|---|
| general chat | GLM → Gemma |
| coding / debugging | MiniMax → Laguna → GLM |
| hard reasoning | Nemotron Super → GLM → Gemma |
| planning | Nemotron Super → GLM → MiniMax |
| writing | GLM → Gemma |
| summarization | Gemma → GLM |
| agent / tool execution | GLM → MiniMax → Nemotron Super |
| multimodal | Nemotron Omni → Gemma (only if provider-verified) |
| current info | **web search FIRST** → synthesis: GLM (plain) / Nemotron Super (hard) / MiniMax (code) |
- **Provider** (`src/lib/openrouter.ts`): server-side only. Timeout + exponential
  backoff (2 attempts/model) for 429/5xx/network, streamed tokens, native tool-calling
  and JSON-mode pass-through *only when the registry says the model supports them*.
- **Fallbacks**: after a pre-first-token failure (429, timeout, 5xx, empty stream,
  unlisted model) the next compatible model in the chain is tried (max 3). Mid-stream
  failures finish cleanly instead of swapping models mid-answer. Total failure yields
  a friendly message — offline tools keep working.
- **Free-model protection**: one model per prompt (no parallel fan-out), per-user rate
  limit (25 chat requests/min), 120s stream caps, short-lived health cache (45s), and
  structured logs for `model_selected` / `model_ok` / `model_failed` (no keys, no prompts).
- The chat UI shows which model answered under each reply; the admin panel shows
  requests-per-model, fallback counts, average latency and web-search usage (24h).

## 1c. Legacy provider interface (`src/lib/ai-gateway.ts`)

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

## 6b. Web search hardening (`src/lib/search.ts`)

Keyless provider chain with sanitized failure logging — the previous single-provider
DuckDuckGo parser silently returned `[]` when DDG blocked the server IP.

```
SearXNG (SEARXNG_URL, self-hosted — most reliable)
  → DuckDuckGo HTML → DuckDuckGo Lite → Mojeek → Bing (with /ck/a redirect decoding)
```

- Every provider reports a sanitized status (http code / empty / parse failure) to
  server logs via `web_search` / `web_search_exhausted` events — never the query
  payload.
- Results are URL-validated (http/https only), DDG/Bing redirect wrappers are
  decoded, deduped by domain+path, titles/snippets sanitized.
- On total failure the tool returns an honest error telling the model **not to
  fabricate current information**; the user sees a specific reason, not a generic
  message.
- Providers can be disabled individually for ops debugging:
  `SEARCH_DISABLE_DDG=1`, `SEARCH_DISABLE_DDG_LITE=1`, `SEARCH_DISABLE_MOJEEK=1`,
  `SEARCH_DISABLE_BING=1`.
- **Production note:** public engines aggressively challenge datacenter IPs. For
  dependable search, run a small SearXNG container and set `SEARXNG_URL`.

## 6c. Uploads & vision

- App-level limits: ≤ **2 MB** per file (deliberately below Vercel's ~4.5 MB
  serverless body cap), PNG/JPG/WEBP/PDF/TXT/MD/CSV/JSON only, user-scoped storage in
  Postgres, owner-only serving, server-side MIME + extension whitelist.
- Client pre-validation avoids silent failures; upload errors surface as a toast +
  chip with the exact reason. iPhone **HEIC** photos aren't supported (clear
  guidance shown — export as JPG).
- Vision requests route to provider-verified image-capable models
  (Nemotron 3 Nano Omni → Gemma 4 31B fallback). If the provider's capability
  probe is temporarily down, registry-assigned vision models stay candidates so a
  transient hiccup doesn't hard-fail the flow; the provider request is the verdict.

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

### Production checklist

- [ ] `DATABASE_URL` (pooled Postgres — Supabase **pooler** host / Neon `-pooler`)
- [ ] Tables pushed once: `DATABASE_URL=... npx drizzle-kit push`
- [ ] `OPENROUTER_API_KEY` set (Production env), model IDs copied **exactly** from
      openrouter.ai/models — note `minimax/minimax-m2.5:free` does **not** exist
      (use `minimax/minimax-m2.7:free` or `minimax/minimax-m3:free`)
- [ ] `SEARXNG_URL` set for reliable search (public engines block cloud IPs)
- [ ] `EXPOSE_RESET_LINK=false` for public deployments
- [ ] Vercel **Deployment Protection → Vercel Authentication: Disabled** (or
      Preview-only). If enabled on Production, every URL — including APIs — 302s to
      a Vercel SSO page and the app appears broken.
- [ ] Admin login → open `/api/ai/debug` after each env change. It reports env
      presence (never values), provider listing status, and a real minimal probe
      with the exact failure category (auth / quota / not_found / rate_limited /
      upstream / network).

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

**Audit hardening (June):** chat history now always uses the latest 12 messages
(long threads previously dropped them); summarization classifier catches
*summarize/summarise/summary*; generic memory recall ("what do you remember about
me") falls back to importance+recency instead of a semantic threshold that
stop-word queries could never pass; retry no longer duplicates the assistant
bubble; fallback chains capped at 3 models; auth self-heal avoids extra writes;
expired sessions are purged on login; first-user admin is race-hardened.

## Rate limiting note

Rate limits are in-memory per serverless instance (auth 12/min, chat 25/min,
search 15/min, upload 20/min, export 5/min per key). On Vercel they apply
per-warm-instance — sufficient for a personal app; move to a shared store
(e.g. Upstash) for multi-user scale.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "AI not linked" chip | Set `OPENROUTER_API_KEY` + `MODEL_*` (or self-hosted `AI_BASE_URL`/`AI_MODEL`) |
| Chat says models unavailable | Open `/api/ai/debug` (admin) — it names the exact reason (401 key / 404 model ID / 429 free quota / 5xx upstream) |
| Search returns nothing | Check server logs `web_search_exhausted`; set `SEARXNG_URL` — public engines challenge datacenter IPs |
| All URLs redirect to a Vercel SSO page | Deployment Protection → Vercel Authentication: Disabled / Preview-only |
| Image upload rejected | ≤ 2 MB, PNG/JPG/WEBP only; iPhone photos: share as "Medium" or convert HEIC → JPG |
| "No vision-capable model" | Set `MODEL_NEMOTRON_OMNI`/Gemma with provider-verified image input |
| Voice says STT unavailable | Use Chrome (on-device ASR) or set `STT_MODEL` |
