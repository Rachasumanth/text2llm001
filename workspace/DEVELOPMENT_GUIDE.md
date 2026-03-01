# Development Guide — Low-Cost Multi-User Web Rollout

This guide is for adding a **multi-user web mode** to text2llm with **minimum cloud cost**, building on what already exists.

> **Context:** text2llm is already a production-grade personal AI gateway with 35+ messaging channels, native apps (macOS/iOS/Android), a Lit SPA Control UI, 20+ AI providers, 30+ agent tools, a plugin/extension system, memory/RAG, browser automation, and Docker/Fly.io deployment. This plan adds a **browser-only web path** for users who don't run their own gateway.

---

## What Already Exists (Do Not Rebuild)

Before planning new work, know what's built:

| Layer                                   | Status      | Location                                                                           |
| --------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| Chat UI (Lit 3.3.2 SPA)                 | **Shipped** | `ui/` — full dashboard, chat, settings, themes                                     |
| Gateway server (HTTP + WS)              | **Shipped** | `src/gateway/` — JSON-RPC, OpenAI-compatible API                                   |
| Agent orchestration                     | **Shipped** | `src/agents/` — streaming, compaction, failover, sub-agents                        |
| 20+ AI providers                        | **Shipped** | Anthropic, OpenAI, Gemini, Groq, Bedrock, Ollama, xAI, etc.                        |
| Auth (token/password/Ed25519/Tailscale) | **Shipped** | `src/gateway/auth.ts`, `src/gateway/device-auth.ts`                                |
| 8 core + 27 extension channels          | **Shipped** | `src/telegram/`, `src/discord/`, `extensions/`                                     |
| Plugin system (jiti loader)             | **Shipped** | `src/plugins/`, `src/plugin-sdk/`                                                  |
| Memory/RAG (SQLite + sqlite-vec)        | **Shipped** | `src/memory/`                                                                      |
| Native apps (macOS/iOS/Android)         | **Shipped** | `apps/`                                                                            |
| Config system (JSON5 + Zod)             | **Shipped** | `src/config/`                                                                      |
| Docker + Fly.io + Render deploy         | **Shipped** | `Dockerfile`, `fly.toml`, `render.yaml`                                            |
| Browser-runtime storage adapters        | **Partial** | `src/browser-runtime/` — IndexedDB, Web Crypto stubs                               |
| Browser-compatible agent core           | **Partial** | ~55% of agent logic has zero `node:` imports (see `WEB_VS_SERVER_SPLIT_REPORT.md`) |

---

## Architecture (4 Parts)

Parts 1 through 3 are included in the **free** tier, providing the core chat and gateway experience. Part 4 is the **paid** tier, unlocking compute-heavy dataset and model features with strong security.

### Part 1 — Browser Client (local-first default) [Free]

Runs in the user's browser. Reuses existing modules where possible:

- **Chat UI** — already shipped (`ui/`), needs standalone mode without gateway WS dependency
- **Agent core** — system prompt, model selection, compaction, streaming, context guard, tool policy (~20 files, ~5,500 LOC already browser-safe)
- **User API-key model calls** — `fetch()` to providers that allow browser CORS (very few — see CORS note below)
- **Session storage** — IndexedDB (adapter exists in `src/browser-runtime/`, needs wiring)
- **Config** — IndexedDB (replace `src/config/io.ts` filesystem reads with `BrowserConfigIO`)
- **Credentials** — Web Crypto API + IndexedDB (encrypted at rest)

### Part 2 — Shared Cloud Proxy (single stateless service) [Free]

This is **not** a fallback — it's the **primary path** for most LLM calls, because major providers (OpenAI, Anthropic, Google) block browser-origin CORS requests.

- **LLM proxy** — forwards browser requests to providers using the user's API key (passed per-request, never stored server-side)
- **Stateless** — no sessions, no per-user state, no containers
- **Webhook normalization** — for channel integrations that need server endpoints (Telegram webhooks, Slack events)
- **Rate limiting + quota enforcement** — per-user, per-minute, daily caps
- Can be built on the existing `workspace/text2llm-web/server.mjs` Express skeleton or as a minimal Cloudflare Worker / Hono app

> **CORS reality check:** OpenAI, Anthropic, and Google Gemini all reject browser-origin requests. The proxy handles ~90% of traffic. Size and cost-model it as the default path, not a fallback.

### Part 3 — Supabase (auth + metadata only) [Free]

- OAuth login (Google, GitHub)
- User profile + settings sync
- Usage event logging (provider, tokens, latency, cost)
- Optional cross-device session metadata sync

**Not for:** chat history storage, credentials, or inference.

### Part 4 — Compute & Processing Workers [Paid]

Provides heavy lifting for data and model processing. This requires a paid subscription (managed via Stripe/Supabase) to offset compute costs and ensure strong security isolation.

- **Multi-Format Dataset Creator**: Bypasses the shared proxy via presigned Cloud Storage URLs (S3/R2) to securely upload >1GB datasets.
- **Background Workers**: Stateless Node workers utilizing the `data-pipeline` skill to clean, deduplicate, and format raw datasets into JSONL, Parquet, or CSV.
- **Strong Security**: Enforces presigned URL expiration, strict CORS, Row-Level Security (RLS) in Supabase for jobs, and isolated worker environments to protect proprietary data.

---

## Routing Policy

For each LLM request, follow this order:

1. **Direct browser → provider** — only if the provider has a permissive CORS policy (Ollama local, some open-source endpoints). User's API key in the `Authorization` header.
2. **Browser → shared proxy → provider** — the normal path. User's API key forwarded in a request header, not stored. Proxy adds rate-limit checks, strips CORS errors, streams SSE back.
3. **Degrade to local-only** — if proxy is down, browser retries direct call. If that also fails, show cached/offline response or error gracefully.

---

## What Needs Building (Scoped to Existing Code)

### Browser Agent Shim Layer

The `@mariozechner/pi-coding-agent` SDK has `node:` imports in 20+ files. text2llm uses it for 5 things:

| Function                        | Current Source  | Browser Replacement                                                         |
| ------------------------------- | --------------- | --------------------------------------------------------------------------- |
| `createAgentSession()`          | pi-coding-agent | `src/web/browser-agent-session.ts` — state container using in-memory arrays |
| `SessionManager`                | pi-coding-agent | `BrowserSessionManager` — IndexedDB read/write instead of JSONL files       |
| `codingTools` (read/write/edit) | pi-coding-agent | Disable in browser mode (no filesystem)                                     |
| `estimateTokens()`              | pi-coding-agent | Port pure-JS tokenizer or use tiktoken WASM                                 |
| `generateSummary()`             | pi-coding-agent | Already in `src/agents/compaction.ts` (browser-safe)                        |

**Effort:** ~5-7 days. See `ARCHITECTURE_SPLIT_PLAN.md` for the full file-by-file plan.

### Agent Runner Filesystem Removal

`src/agents/pi-embedded-runner/run.ts` and `attempt.ts` use `node:fs/promises` for:

- Reading workspace `AGENTS.md` → replace with bundled string or `fetch()`
- Writing debug logs → remove or use `console`
- Temp file paths via `node:os` → remove (browser has no temp dir)
- Skill file loading → bundle skills or fetch from URL

**Effort:** ~3-5 days.

### Browser Config Adapter

Replace `src/config/io.ts` (641 lines, `node:fs`) with a ~150-line IndexedDB adapter:

- No `$include` directives (browser has no filesystem)
- No `${ENV_VAR}` substitution (browser has no env vars)
- Config edited via UI settings panel
- Use `idb` library (~1.2KB) for IndexedDB wrapper

**Effort:** ~2 days.

### Browser Session Storage

Replace `src/gateway/session-utils.fs.ts` (441 lines, JSONL files) with IndexedDB:

- One IndexedDB object store per agent
- Each session is a key → array of message objects
- Existing `src/browser-runtime/` has partial adapters to build on

**Effort:** ~2-3 days.

### Shared Proxy Service

A thin stateless API (Express, Hono, or Cloudflare Worker):

```
POST /v1/proxy/chat/completions
  Headers: X-Provider-Key: <user's key>, X-Provider: openai|anthropic|google|...
  Body: OpenAI-compatible chat completion request
  Response: SSE stream passthrough

POST /v1/proxy/embeddings (optional, for memory)
  Same pattern

GET /health
```

- Validates user identity (Supabase JWT)
- Enforces per-user rate limits (in-memory or Redis)
- Forwards request to provider with user's key
- Streams response back
- Logs usage event to Supabase

The existing `workspace/text2llm-web/server.mjs` (~7,600 lines) is a prototype but is too heavy — it includes GPU routing, terminal emulation, and training flows. Extract only the proxy/auth parts or start fresh with a focused 200-line proxy.

**Effort:** ~3-4 days for a clean implementation.

### API Key Security

User API keys in the browser need careful handling:

- **In transit:** Always HTTPS. Keys sent per-request to the proxy in a header, never in URL params.
- **At rest:** Encrypted in IndexedDB using Web Crypto API (`AES-GCM` with a key derived from user's auth session). Keys are decrypted only at call time.
- **Server-side:** The proxy forwards keys but never stores them. Keys exist in memory only for the duration of the proxied request.
- **Session-only option:** Offer "don't save key" mode where keys are held in JS memory and lost on tab close.

---

## Step-by-Step Rollout Plan

### Week 1 — Static Shell + Auth

1. **Deploy the existing UI as a standalone static site**
   - Build `ui/` with Vite, deploy to Cloudflare Pages / Vercel.
   - Strip the gateway WebSocket requirement — add a "web mode" flag that skips WS connection.
   - Deliverable: public URL loads the chat UI (non-functional, but renders).

2. **Add Supabase auth**
   - Create Supabase project. Enable Google + GitHub OAuth.
   - Add `@supabase/supabase-js` to `ui/`. Add login/logout flow.
   - Deliverable: user signs in, JWT stored in browser.

3. **Create Supabase tables + RLS**
   - `profiles(user_id uuid PK, display_name text, created_at timestamptz)`
   - `user_settings(user_id uuid PK, settings jsonb, updated_at timestamptz)`
   - `usage_events(id uuid PK, user_id uuid, route text, provider text, model text, input_tokens int, output_tokens int, latency_ms int, cost_usd numeric, error text, created_at timestamptz)`
   - RLS: each user reads/writes only their own rows.
   - Deliverable: user settings saved and reloaded across sessions.

### Week 2 — Proxy + Browser Agent

4. **Deploy the shared proxy**
   - Single `/v1/proxy/chat/completions` endpoint.
   - Validate Supabase JWT. Forward user's API key to provider. Stream SSE back.
   - Deploy to Fly.io (reuse existing `fly.toml` pattern) or Cloudflare Worker.
   - Deliverable: `curl` can proxy a chat completion through the service.

5. **Wire browser agent core**
   - Create `BrowserConfigIO` (IndexedDB config adapter).
   - Create `BrowserSessionManager` (IndexedDB session storage).
   - Wire existing browser-safe agent modules: system prompt → model selection → proxy fetch → streaming → compaction.
   - Deliverable: user can send a message and get a streamed LLM response, entirely in browser + proxy.

6. **Add API key management UI**
   - Settings panel: enter API keys for OpenAI, Anthropic, Google, etc.
   - Store encrypted in IndexedDB (Web Crypto AES-GCM).
   - Deliverable: user configures their own keys, keys survive page reload.

### Week 3 — Cost Controls + Tools

7. **Add rate limits + quotas in proxy**
   - Per-user: 20 req/min, 100K tokens/day (configurable via env).
   - Payload size limit: 128KB request body.
   - Return `429` with `Retry-After` header when exceeded.
   - Deliverable: no single user can spike costs.

8. **Add kill switches**
   - Env flags: `PROXY_ENABLED=false` disables all proxying.
   - Per-provider disable: `PROXY_DISABLE_ANTHROPIC=true`.
   - Deliverable: any route can be killed in <1 minute.

9. **Port safe browser tools**
   - `web-fetch` (already browser-safe via `fetch()`)
   - `web-search` (Brave/Perplexity — needs proxy for API key CORS)
   - `memory-tool` interface (IndexedDB-backed, no vector search in MVP — keyword search only)
   - Disable server-only tools: `bash`, `exec`, `browser` (Playwright), `sandbox`, file tools.
   - Deliverable: agent can search the web and fetch URLs from browser.

### Week 4 — Observability + Beta

10. **Add usage instrumentation**
    - Proxy logs every request to Supabase `usage_events` (async, non-blocking).
    - Include: provider, model, input/output tokens, latency, cost estimate, error.
    - Deliverable: usage data flowing.

11. **Add ops dashboard**
    - Simple Supabase SQL queries or a lightweight admin page:
      - Active users (past 24h)
      - Proxy request volume + error rate
      - Cloud cost estimate (sum of `cost_usd`)
      - Top users by token consumption
    - Add alerting: webhook to Discord/Slack when daily cost exceeds threshold.
    - Deliverable: daily health visibility + cost alerts.

12. **Degraded mode + beta launch**
    - If proxy returns 5xx, browser retries direct provider call (will work for Ollama, some open endpoints).
    - If all routes fail, show clear error with retry button (not a blank screen).
    - Invite 10-20 beta users. Track: % local vs proxy requests, p95 latency, error rate, daily cost.
    - Deliverable: stable beta with bounded spend.

### Week 5 (Buffer) — Stabilization

13. **Fix issues from beta feedback**
14. **Add cross-device session sync** (optional)
    - Sync session metadata (not full transcripts) to Supabase for multi-device continuity.
    - Conflict resolution: last-write-wins on settings, append-only on sessions.
15. **Performance tuning**
    - Lazy-load agent modules (code splitting).
    - Pre-warm IndexedDB on page load.
    - Cache provider model lists.

---

## Cloud Cost Guardrails (Do Not Skip)

- **No per-user containers.** The proxy is a single shared process.
- **No server-side API keys.** Users bring their own keys. The proxy never stores them.
- **Stateless proxy.** No sessions, no in-memory user state between requests.
- **Strict timeouts.** Proxy kills upstream requests after 120s (LLM streaming) or 30s (non-streaming).
- **Rate limits are mandatory before beta.** Not optional. Not "we'll add later."
- **Cache model lists.** Provider model discovery responses cached for 1 hour.
- **Usage alerts.** Automated webhook when daily aggregate cost exceeds $X.
- **Per-provider kill switches.** Every provider route can be disabled independently.

---

## Minimum Viable Database (Supabase)

```sql
-- User identity
CREATE TABLE profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  display_name text,
  created_at timestamptz DEFAULT now()
);

-- User preferences (agent config, model preferences, UI settings)
CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  settings jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);

-- Usage telemetry (cost tracking, observability)
CREATE TABLE usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  route text NOT NULL,          -- 'direct' | 'proxy'
  provider text NOT NULL,       -- 'openai' | 'anthropic' | 'google' | ...
  model text,
  input_tokens int,
  output_tokens int,
  latency_ms int,
  cost_usd numeric(10,6),      -- estimated cost
  error text,                   -- null on success
  created_at timestamptz DEFAULT now()
);

-- RLS: each user can only access their own rows
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own profile" ON profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users read own settings" ON user_settings FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users insert own events" ON usage_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users read own events" ON usage_events FOR SELECT USING (auth.uid() = user_id);
```

**Not in Supabase:** chat messages, session transcripts, API keys, or agent memory. These stay in the browser (IndexedDB).

---

## Relationship to Existing Gateway Mode

The web mode is **additive**, not a replacement:

| Feature       | Gateway Mode (existing)                | Web Mode (new)                      |
| ------------- | -------------------------------------- | ----------------------------------- |
| Runs on       | User's machine / VPS / Docker          | Browser tab                         |
| LLM calls via | Gateway server → provider API          | Browser → proxy → provider API      |
| Channels      | All 35+ (WhatsApp, Telegram, etc.)     | None (chat UI only in MVP)          |
| Tools         | All 30+ (bash, file, browser, etc.)    | Web-safe subset (web-fetch, search) |
| Memory/RAG    | SQLite + sqlite-vec                    | IndexedDB keyword search (MVP)      |
| Auth          | Token / password / Ed25519 / Tailscale | Supabase OAuth                      |
| Storage       | Local filesystem                       | IndexedDB + Supabase metadata       |
| Native apps   | macOS / iOS / Android                  | N/A                                 |
| Multi-user    | Single-user (personal)                 | Multi-user (shared proxy)           |

Users who want the full experience (channels, tools, native apps) continue using gateway mode. Web mode is for users who want a quick browser-based chat without running infrastructure.

---

## MVP Definition (Done Criteria)

MVP is done when all are true:

- [ ] User can sign in via Supabase OAuth (Google or GitHub).
- [ ] User can enter their own API key and it persists (encrypted in IndexedDB).
- [ ] User can chat with an LLM via the shared proxy with streamed responses.
- [ ] Chat history persists in IndexedDB across page reloads.
- [ ] Agent uses system prompt, model selection, and compaction (reusing existing modules).
- [ ] Proxy enforces per-user rate limits.
- [ ] Usage events are logged to Supabase with cost estimates.
- [ ] Kill switches can disable any provider route in <1 minute.
- [ ] If proxy is down, UI shows a clear error (not a blank screen).

---

## What NOT to Build in MVP

- **Channel integrations in web mode** — no WhatsApp/Telegram/Discord. Users who want channels use gateway mode.
- **Server-side tools** — no bash, file I/O, Playwright, Docker sandbox.
- **Vector memory/RAG** — keyword search in IndexedDB is sufficient for MVP. Vector search (sql.js WASM + sqlite-vec) is a post-MVP upgrade.
- **WebGPU local inference** — interesting but not needed for MVP. Add when there's demand.
- **Multi-device session sync** — single-device in MVP. Sync is a Week 5+ feature.
- **Your own hosted LLM inference** — users bring their own keys.
- **Team/workspace features** — this is a personal assistant, not a collaboration tool.

---

## Post-MVP Roadmap (When Usage Justifies It)

1. **Vector memory in browser** — sql.js WASM + sqlite-vec for embedding-based RAG.
2. **Cross-device sync** — session metadata + settings sync via Supabase.
3. **Canvas in web mode** — render agent-generated HTML artifacts in the browser.
4. **Selective channel support** — Telegram/Discord bots in web mode via proxy webhook endpoints.
5. **WebGPU local inference** — for small models (Phi, Gemma) when user has capable hardware.
6. **PWA + offline** — service worker for offline cached responses and background sync.

---

## Quick Checklist Before Launch

- [ ] `ui/` builds and deploys as standalone static site
- [ ] Supabase project created, OAuth providers configured
- [ ] RLS policies applied to all tables
- [ ] Proxy deployed and `POST /v1/proxy/chat/completions` works
- [ ] API key encryption + storage in IndexedDB tested
- [ ] Browser agent core wired (prompt → model select → proxy → stream → compaction)
- [ ] IndexedDB session persistence working across reloads
- [ ] Rate limits enforced (verify with load test)
- [ ] Kill switches tested (disable a provider, verify 503 response)
- [ ] Usage events flowing to Supabase
- [ ] Cost alert webhook firing
- [ ] Degraded mode tested (proxy down → clear error UI)
- [ ] Beta cohort of 10-20 users invited
