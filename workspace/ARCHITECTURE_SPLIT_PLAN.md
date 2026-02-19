# Implementation Plan: Zero-VM Client-Side Website

## Goal

Move **all** backend processing from the VM to the user's browser. The website is served as static files from a CDN. No server runs any bot logic, session management, agent processing, or storage. The user's browser does everything.

## Current State → Target State

```
CURRENT                                    TARGET
─────────────────────────                  ─────────────────────────
Static CDN → HTML/JS/CSS                   Static CDN → HTML/JS/CSS (unchanged)
     ↓                                          ↓
User's browser (just the UI)               User's browser (EVERYTHING)
     ↓ WebSocket                            ├── Agent reasoning loop
VM (does ALL processing)                    ├── LLM API calls (fetch)
 ├── Agent reasoning loop                   ├── Session storage (IndexedDB)
 ├── LLM API calls                          ├── Config (IndexedDB)
 ├── Session storage (filesystem)           ├── Credentials (IndexedDB + Web Crypto)
 ├── Config (filesystem)                    ├── Memory/RAG (sql.js WASM)
 ├── Credentials (filesystem)               ├── Model selection + failover
 ├── Memory/RAG (SQLite)                    ├── Streaming + compaction
 ├── Streaming + compaction                 ├── Tools (web-fetch, web-search, memory)
 └── Tools (bash, file, web)                └── UI (already browser-native)

                                           VM needed: NONE
```

---

## What the Browser Already Has (zero work needed)

These modules have **zero `node:` imports** and run in the browser today:

| Module              | File                                   | Lines     | What it does                                              |
| ------------------- | -------------------------------------- | --------- | --------------------------------------------------------- |
| **UI (entire app)** | `ui/src/`                              | ~55 files | Lit 3.3.2 SPA, Vite 7.3.1, chat, settings, themes         |
| **Gateway client**  | `ui/src/ui/gateway.ts`                 | 286       | WebSocket JSON-RPC client to gateway                      |
| **Device identity** | `ui/src/ui/device-identity.ts`         | 113       | Ed25519 keys via `@noble/ed25519`, stored in localStorage |
| **System prompt**   | `src/agents/system-prompt.ts`          | 628       | Builds system prompts from config                         |
| **Model selection** | `src/agents/model-selection.ts`        | 407       | Provider/model resolution, aliases, allowed models        |
| **Compaction**      | `src/agents/compaction.ts`             | 345       | Token estimation, progressive summarization               |
| **Streaming**       | `src/agents/pi-embedded-subscribe.ts`  | 595       | State machine for LLM streaming events                    |
| **Context guard**   | `src/agents/context-window-guard.ts`   | ~80       | Token budget calculation                                  |
| **Defaults**        | `src/agents/defaults.ts`               | ~30       | Default provider/model constants                          |
| **Identity**        | `src/agents/identity.ts`               | ~60       | Agent persona resolution                                  |
| **Tool policy**     | `src/agents/tool-policy.ts`            | ~90       | Tool allowlist per config                                 |
| **Usage tracking**  | `src/agents/usage.ts`                  | ~100      | Token/cost accounting (in-memory)                         |
| **Model compat**    | `src/agents/model-compat.ts`           | ~150      | Provider-specific shims                                   |
| **Model fallback**  | `src/agents/model-fallback.ts`         | ~120      | Cascade logic                                             |
| **Web fetch tool**  | `src/agents/tools/web-fetch.ts`        | 690       | URL fetching via `fetch()`                                |
| **Web search tool** | `src/agents/tools/web-search.ts`       | 703       | Brave/Perplexity/Grok search                              |
| **Memory tool**     | `src/agents/tools/memory-tool.ts`      | ~200      | Memory search/save interface                              |
| **Channel tools**   | `src/agents/tools/*-actions.ts`        | ~400      | Discord/Slack/Telegram/WhatsApp API calls                 |
| **Message tool**    | `src/agents/tools/message-tool.ts`     | ~150      | Cross-channel messaging                                   |
| **Session tools**   | `src/agents/tools/sessions-*.ts`       | ~300      | Session management                                        |
| **Agents list**     | `src/agents/tools/agents-list-tool.ts` | ~80       | Lists available agents                                    |
| **Plugin SDK**      | `src/plugin-sdk/`                      | ~200      | Types + schema validators                                 |
| **Helpers**         | `src/agents/pi-embedded-helpers/*.ts`  | ~350      | Errors, turns, thinking, messaging dedup                  |

**Total: ~5,500+ LOC already runs in browser with zero changes.**

---

## What Needs Adapters (specific file-by-file plan)

### Blocker 1: `@mariozechner/pi-coding-agent` (CRITICAL)

This external SDK has **static `node:` imports in 20+ files** including:

- `agent-session.js` → `node:fs`, `node:path`
- `bash-executor.js` → `node:crypto`, `node:fs`, `node:os`, `node:path`
- `exec.js` → `node:child_process`
- `file-processor.js` → `node:fs/promises`
- `resource-loader.js` → `node:fs`, `node:os`, `node:path`
- 15+ more files

**text2llm uses it for:**

1. `createAgentSession()` → creates the agent session object
2. `SessionManager` → manages session state/history
3. `codingTools` (read, write, edit) → file operations
4. `estimateTokens()` → token counting
5. `generateSummary()` → compaction summarization

**Solution:** Create a browser-compatible shim layer that replaces these 5 imports:

```typescript
// src/web/browser-agent-session.ts (NEW)

// Instead of importing from @mariozechner/pi-coding-agent, we create
// browser-compatible equivalents that use the same interfaces

export function createBrowserAgentSession(params: {
  model: string;
  provider: string;
  systemPrompt: string;
  tools: AnyAgentTool[];
  streamFn: typeof streamSimple;
}): AgentSession {
  // The AgentSession is mostly a state container:
  // - messages array (in memory)
  // - tool definitions
  // - stream function reference
  // No filesystem needed.
  return {
    messages: [],
    tools: params.tools,
    agent: { streamFn: params.streamFn },
    // ... (match the interface)
  };
}

export class BrowserSessionManager {
  // Instead of reading/writing JSONL files to disk,
  // read/write to IndexedDB via StorageAdapter
  constructor(private storage: StorageAdapter) {}

  async loadHistory(sessionKey: string): Promise<AgentMessage[]> {
    return this.storage.readSession(sessionKey);
  }
  async appendMessage(sessionKey: string, msg: AgentMessage): Promise<void> {
    await this.storage.appendToSession(sessionKey, msg);
  }
}
```

**Effort: ~3-5 days** — understand the exact interface contracts, build browser shims.

### Blocker 2: Agent Runner (`src/agents/pi-embedded-runner/`)

| File                         | `node:` imports               | What to do                                                                                                                                              |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.ts` (864 lines)         | `node:fs/promises`            | Used for: reading workspace AGENTS.md, writing debug logs. **Replace with:** fetch for AGENTS.md loading, remove debug file writes                      |
| `run/attempt.ts` (895 lines) | `node:fs/promises`, `node:os` | Used for: `os.tmpdir()`, `os.homedir()`, temp file paths. **Replace with:** remove temp file paths (browser has no filesystem), pass homedir via config |
| `session-manager-init.ts`    | `node:fs`                     | Session file init. **Replace with:** IndexedDB session init                                                                                             |
| `session-manager-cache.ts`   | —                             | Pure logic, already safe                                                                                                                                |
| `system-prompt.ts`           | `node:fs`                     | Reads skill files from disk. **Replace with:** bundled skills or fetch from URL                                                                         |
| `compact.ts`                 | —                             | Pure logic, already safe                                                                                                                                |
| `model.ts`                   | —                             | Pure logic, already safe                                                                                                                                |
| `abort.ts`                   | —                             | Pure logic, already safe                                                                                                                                |
| `history.ts`                 | —                             | Pure logic, already safe                                                                                                                                |
| `extensions.ts`              | —                             | Pure logic, already safe                                                                                                                                |
| `lanes.ts`                   | —                             | Pure logic, already safe                                                                                                                                |
| `logger.ts`                  | depends                       | May use console only — check                                                                                                                            |

**Effort: ~5-7 days** — mostly swapping filesystem calls with IndexedDB adapter calls.

### Blocker 3: Config Storage

**Current:** `src/config/io.ts` (641 lines) reads `~/.text2llm/text2llm.json` via `node:fs`.

**Format:** JSON5 file with `$include` directives and `${ENV_VAR}` substitution.

**Browser replacement:**

```typescript
// src/web/browser-config.ts (NEW, ~150 lines)

import { openDB } from "idb"; // tiny IndexedDB wrapper (1.2KB)

const DB_NAME = "text2llm";
const CONFIG_STORE = "config";

export class BrowserConfigIO {
  private db = openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(CONFIG_STORE);
    },
  });

  async loadConfig(): Promise<TEXT2LLMConfig> {
    const db = await this.db;
    const raw = await db.get(CONFIG_STORE, "main");
    if (!raw) return getDefaultConfig();
    return validateConfig(raw);
  }

  async saveConfig(config: TEXT2LLMConfig): Promise<void> {
    const db = await this.db;
    await db.put(CONFIG_STORE, config, "main");
  }

  // No $include (browser has no filesystem)
  // No ${ENV_VAR} (browser has no env vars)
  // Config is edited via UI settings panel
}
```

**Effort: ~2 days**

### Blocker 4: Session Storage

**Current:** `src/gateway/session-utils.fs.ts` (441 lines) reads/writes JSONL to `~/.text2llm/agents/<agentId>/sessions/<sessionId>.jsonl`.

**Format:** Each line is one of:

```jsonl
{"message": {"role": "user", "content": [{"type": "text", "text": "..."}], "timestamp": 123}}
{"message": {"role": "assistant", "content": [{"type": "text", "text": "..."}]}}
{"type": "compaction", "id": "...", "timestamp": "2025-01-01T00:00:00.000Z"}
```

**Browser replacement:**

```typescript
// src/web/browser-sessions.ts (NEW, ~200 lines)

import { openDB } from "idb";

const SESSIONS_STORE = "sessions"; // session metadata
const MESSAGES_STORE = "session-messages"; // messages per session

export class BrowserSessionStore {
  private db = openDB("text2llm", 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) db.createObjectStore("config");
      if (oldVersion < 2) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: "sessionKey" });
        const msgStore = db.createObjectStore(MESSAGES_STORE, {
          keyPath: ["sessionKey", "seq"],
        });
        msgStore.createIndex("bySession", "sessionKey");
      }
    },
  });

  async appendMessage(sessionKey: string, msg: unknown): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(MESSAGES_STORE, "readwrite");
    const count = await tx.store.index("bySession").count(sessionKey);
    await tx.store.put({ sessionKey, seq: count, ...msg });
    await tx.done;
  }

  async readSessionMessages(sessionKey: string): Promise<unknown[]> {
    const db = await this.db;
    return db.getAllFromIndex(MESSAGES_STORE, "bySession", sessionKey);
  }

  async listSessions(): Promise<SessionMeta[]> {
    const db = await this.db;
    return db.getAll(SESSIONS_STORE);
  }

  async deleteSession(sessionKey: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction([SESSIONS_STORE, MESSAGES_STORE], "readwrite");
    await tx.objectStore(SESSIONS_STORE).delete(sessionKey);
    const msgs = await tx
      .objectStore(MESSAGES_STORE)
      .index("bySession")
      .getAllKeys(sessionKey);
    for (const key of msgs) await tx.objectStore(MESSAGES_STORE).delete(key);
    await tx.done;
  }
}
```

**Effort: ~2-3 days**

### Blocker 5: Credential Storage

**Current:** `src/agents/auth-profiles/store.ts` (356 lines) reads/writes `~/.text2llm/agents/<agentId>/auth-profiles.json` with file locking.

**Format:**

```json
{
  "version": 1,
  "profiles": {
    "anthropic:default": {
      "type": "api_key",
      "provider": "anthropic",
      "key": "sk-..."
    },
    "openai:default": {
      "type": "api_key",
      "provider": "openai",
      "key": "sk-..."
    }
  },
  "order": { "anthropic": ["anthropic:default"] },
  "lastGood": { "anthropic": "anthropic:default" }
}
```

**Browser replacement:**

```typescript
// src/web/browser-credentials.ts (NEW, ~120 lines)

export class BrowserCredentialStore {
  private db = openDB('text2llm', 3, {
    upgrade(db, oldVersion) {
      if (oldVersion < 3) {
        db.createObjectStore('credentials', { keyPath: 'profileId' });
      }
    },
  });

  // Optionally encrypt API keys with a user-provided password
  // using Web Crypto API (AES-GCM)
  async saveProfile(profileId: string, profile: AuthProfile): Promise<void> {
    const db = await this.db;
    await db.put('credentials', { profileId, ...profile });
  }

  async getProfiles(): Promise<AuthProfileStore> { ... }
  async deleteProfile(profileId: string): Promise<void> { ... }

  // No file locking needed — IndexedDB transactions are atomic
}
```

**Effort: ~1-2 days**

### Blocker 6: Memory/RAG

**Current:** `src/memory/manager.ts` (2178 lines) uses `node:sqlite` with sqlite-vec native addon.

**Tables:**

- `chunks` — text chunks with embeddings (vector stored as JSON text)
- `chunks_fts` — FTS5 full-text search
- `embedding_cache` — cached embeddings by provider
- `files` — tracked file metadata
- `meta` — key-value metadata

**Search flow:** keyword search (FTS5 BM25) + vector search (sqlite-vec cosine) → merge

**Browser replacement:**

```typescript
// src/web/browser-memory.ts (NEW, ~400 lines)

import initSqlJs from "sql.js"; // SQLite compiled to WASM (~1.2MB)

export class BrowserMemoryManager {
  private db: Database;

  async init(): Promise<void> {
    const SQL = await initSqlJs({
      locateFile: (file) => `https://sql.js.org/dist/${file}`,
    });

    // Load existing DB from IndexedDB, or create new
    const saved = await idb.get("text2llm", "memory-db");
    this.db = saved ? new SQL.Database(saved) : new SQL.Database();

    // Create same schema as Node version
    this.db.run(`CREATE TABLE IF NOT EXISTS chunks (...)`);
    this.db.run(
      `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(...)`,
    );
    // Note: sqlite-vec won't work in WASM — use JS cosine similarity instead
  }

  async search(query: string): Promise<MemorySearchResult[]> {
    // 1. FTS5 keyword search (works in sql.js)
    const keywordResults = this.db.exec(
      `SELECT * FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT 20`,
      [query],
    );

    // 2. Vector search — compute cosine similarity in JS
    const queryEmbedding = await this.embedQuery(query);
    const allChunks = this.db.exec(`SELECT id, embedding FROM chunks`);
    const vectorResults = allChunks
      .map((chunk) => ({
        ...chunk,
        score: cosineSimilarity(queryEmbedding, JSON.parse(chunk.embedding)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    // 3. Merge (same algorithm as Node version)
    return mergeHybridResults(keywordResults, vectorResults);
  }

  // Persist DB to IndexedDB after every write
  async persist(): Promise<void> {
    await idb.put("text2llm", this.db.export(), "memory-db");
  }
}
```

**Effort: ~5-7 days** (FTS5 works in sql.js, but sqlite-vec doesn't — need JS vector similarity fallback)

---

## The Build Pipeline Change

### Current Build (Node.js target)

```
tsdown.config.ts → builds 6 Node.js bundles → dist/
ui/vite.config.ts → builds browser SPA → dist/control-ui/
```

### New Build (add browser bundle)

```
tsdown.config.ts    → (unchanged) Node.js bundles → dist/         (for desktop users)
ui/vite.config.ts   → (modified) full browser app → dist/web/     (the zero-VM website)
```

**What changes in Vite config:**

```typescript
// ui/vite.config.ts (MODIFIED)

export default defineConfig(() => ({
  base: process.env.TEXT2LLM_CONTROL_UI_BASE_PATH || "./",
  publicDir: path.resolve(here, "public"),

  // NEW: resolve browser shims instead of Node.js modules
  resolve: {
    alias: {
      // Point agent imports to browser-compatible versions
      "../../../src/config/io.js": "../../../src/web/browser-config.js",
      "../../../src/gateway/session-utils.fs.js":
        "../../../src/web/browser-sessions.js",
      "../../../src/agents/auth-profiles/store.js":
        "../../../src/web/browser-credentials.js",
      "../../../src/memory/manager.js": "../../../src/web/browser-memory.js",
      // Stub out Node.js modules that get transitively imported
      "node:fs": "../../../src/web/stubs/fs.js",
      "node:fs/promises": "../../../src/web/stubs/fs.js",
      "node:os": "../../../src/web/stubs/os.js",
      "node:path": "path-browserify",
      "node:crypto": "../../../src/web/stubs/crypto.js",
      "node:child_process": "../../../src/web/stubs/noop.js",
      "node:net": "../../../src/web/stubs/noop.js",
      "node:sqlite": "../../../src/web/stubs/noop.js",
      chokidar: "../../../src/web/stubs/noop.js",
    },
  },

  build: {
    outDir: path.resolve(here, "../dist/web"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // Tree-shake out server-only code
      treeshake: { moduleSideEffects: false },
    },
  },
}));
```

**Effort: ~2-3 days** for build pipeline + stub modules.

---

## Phase-by-Phase Implementation

### Phase 0: Foundation — Storage Adapters (Week 1-2)

Create the interface abstraction layer so the same code can run on Node.js or browser.

**New files:**

| File to create                   | Lines (est.) | What it does                           |
| -------------------------------- | ------------ | -------------------------------------- |
| `src/web/storage-adapter.ts`     | 60           | `StorageAdapter` interface definition  |
| `src/web/browser-config.ts`      | 150          | Config via IndexedDB                   |
| `src/web/browser-sessions.ts`    | 200          | Sessions via IndexedDB                 |
| `src/web/browser-credentials.ts` | 120          | Credentials via IndexedDB + Web Crypto |
| `src/web/browser-memory.ts`      | 400          | Memory/RAG via sql.js WASM             |
| `src/web/stubs/fs.ts`            | 30           | No-op for unused `node:fs` imports     |
| `src/web/stubs/os.ts`            | 20           | Returns browser-sensible defaults      |
| `src/web/stubs/crypto.ts`        | 30           | Maps to `globalThis.crypto`            |
| `src/web/stubs/noop.ts`          | 10           | Empty export for unused modules        |

**Files to modify:**

| File                                | Change                                                   | Why                                         |
| ----------------------------------- | -------------------------------------------------------- | ------------------------------------------- |
| `src/config/io.ts`                  | Add `ConfigIO` interface, accept injected storage        | Decouple from `node:fs`                     |
| `src/gateway/session-utils.fs.ts`   | Add `SessionStore` interface, accept injected storage    | Decouple from `node:fs`                     |
| `src/agents/auth-profiles/store.ts` | Add `CredentialStore` interface, accept injected storage | Decouple from `node:fs` + `proper-lockfile` |

**Total: ~1,020 new LOC + ~200 LOC modifications. Effort: 2 weeks.**

### Phase 1: Browser Agent Core (Week 3-4)

Wire the agent reasoning loop to work in the browser, bypassing `@mariozechner/pi-coding-agent`.

**New files:**

| File                               | Lines (est.) | What it does                                                               |
| ---------------------------------- | ------------ | -------------------------------------------------------------------------- |
| `src/web/browser-agent-session.ts` | 250          | Browser-compatible `createAgentSession` + `SessionManager`                 |
| `src/web/browser-tools.ts`         | 150          | Browser-safe tool set (web-fetch, web-search, memory — no bash/file tools) |
| `src/web/browser-runner.ts`        | 300          | Browser entry for agent loop (wraps `run.ts` logic without filesystem)     |

**Key wiring:**

```
User types in chat
     ↓
BrowserRunner.run(userMessage)
     ↓
1. browserConfig.loadConfig()           ← IndexedDB (not filesystem)
2. browserCredentials.getApiKey()       ← IndexedDB (not filesystem)
3. systemPrompt.build(config)           ← pure logic (no change)
4. modelSelection.resolve(config)       ← pure logic (no change)
5. BrowserAgentSession.create(...)      ← in-memory (not pi-coding-agent)
6. streamSimple(messages, tools, ...)   ← fetch() to LLM API (no change)
7. piEmbeddedSubscribe(stream)          ← pure state machine (no change)
8. browserSessions.append(response)     ← IndexedDB (not filesystem)
     ↓
Response streamed to UI
```

**Effort: 2 weeks.**

### Phase 2: CORS Proxy + Build Pipeline (Week 5)

**Problem:** Browser `fetch()` to `api.openai.com` may be blocked by CORS.

**Solution:** Cloudflare Worker proxy (~10 lines, free tier):

```typescript
// cloudflare-worker/cors-proxy.ts
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const target = url.searchParams.get("url");
    if (!target) return new Response("Missing url param", { status: 400 });

    const resp = await fetch(target, {
      method: request.method,
      headers: new Headers(request.headers),
      body: request.body,
    });

    const newHeaders = new Headers(resp.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Access-Control-Allow-Headers", "*");
    return new Response(resp.body, {
      status: resp.status,
      headers: newHeaders,
    });
  },
};
```

**Build pipeline changes:**

- Add `vite.web.config.ts` for the standalone browser build
- Add `scripts/build-web.sh` to produce `dist/web/` (deployable to any static host)
- Configure `resolve.alias` for all `node:` shims
- Add `@anthropic-ai/sdk` → browser-compatible fetch wrapper (the SDK already supports browser via `dangerouslyAllowBrowser: true`)

**Effort: 1 week.**

### Phase 3: Service Worker + Offline (Week 6-7)

**What the Service Worker does:**

1. Caches all static assets (HTML, JS, CSS) for offline use
2. Acts as background agent — keeps running even when user switches tabs
3. Manages the agent queue (user sends message → SW processes → pushes result to tab)

```typescript
// src/web/service-worker.ts (NEW, ~200 lines)

const CACHE_NAME = "text2llm-v1";
const STATIC_ASSETS = ["/", "/index.html", "/assets/*.js", "/assets/*.css"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches
      .match(event.request)
      .then((cached) => cached || fetch(event.request)),
  );
});

// Agent processing in background
self.addEventListener("message", async (event) => {
  if (event.data.type === "chat.send") {
    const result = await browserRunner.run(event.data.message);
    // Post result back to all open tabs
    const clients = await self.clients.matchAll();
    clients.forEach((client) =>
      client.postMessage({ type: "chat.response", ...result }),
    );
  }
});
```

**Effort: 2 weeks.**

### Phase 4: Full Integration + Testing (Week 8-10)

**Tasks:**

1. Wire browser entry point: `ui/src/main.ts` → detect "standalone mode" (no gateway WS) → use `BrowserRunner` directly
2. Build import/export: let users export sessions/config as JSON files and import them
3. Test all provider APIs via CORS proxy (OpenAI, Anthropic, Google, OpenRouter, Together, Groq)
4. Test sql.js memory/RAG in browser
5. Test session persistence across page reloads
6. Test Service Worker offline mode
7. Performance profiling (IndexedDB read/write latency, sql.js query speed)

**Effort: 3 weeks.**

---

## File Inventory: What Gets Created, Modified, and Dropped

### New Files (browser runtime) — ~2,000 LOC total

```
src/web/                          ← NEW directory
├── storage-adapter.ts            ← interface definition
├── browser-config.ts             ← config via IndexedDB
├── browser-sessions.ts           ← sessions via IndexedDB
├── browser-credentials.ts        ← credentials via IndexedDB + Web Crypto
├── browser-memory.ts             ← memory/RAG via sql.js
├── browser-agent-session.ts      ← browser AgentSession shim
├── browser-tools.ts              ← browser-safe tool registration
├── browser-runner.ts             ← browser agent loop entry
├── service-worker.ts             ← offline + background processing
├── cors-proxy-url.ts             ← CORS proxy URL config
└── stubs/
    ├── fs.ts                     ← no-op fs
    ├── os.ts                     ← browser os defaults
    ├── crypto.ts                 ← Web Crypto wrapper
    └── noop.ts                   ← empty module
```

### Modified Files — ~500 LOC changes

| File                                                | Change                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| `ui/src/main.ts`                                    | Add standalone mode detection                                     |
| `ui/src/ui/gateway.ts`                              | Add `BrowserRunner` fallback when no WS gateway                   |
| `ui/vite.config.ts` _(or new `vite.web.config.ts`)_ | Add resolve aliases for browser build                             |
| `src/config/io.ts`                                  | Extract `ConfigIO` interface (keep existing impl as `FsConfigIO`) |
| `src/agents/auth-profiles/store.ts`                 | Extract interface (keep existing impl)                            |

### Desktop-Only (NOT included in browser build, tree-shaken out)

```
src/gateway/server*.ts            ← HTTP/WS listener (dropped)
src/cli/                          ← terminal I/O (dropped)
src/commands/                     ← CLI commands (dropped)
src/daemon/                       ← OS services (dropped)
src/agents/bash-tools*.ts         ← shell execution (dropped)
src/agents/sandbox/               ← Docker (dropped)
src/browser/                      ← Playwright (dropped)
src/infra/ssh-tunnel.ts           ← SSH (dropped)
src/infra/tls/                    ← TLS certs (dropped)
src/signal/                       ← signal-cli binary (dropped)
src/imessage/                     ← AppleScript (dropped)
src/web/ (WhatsApp Baileys)       ← Node sockets (dropped)
src/discord/ (server impl)        ← discord.js gateway (dropped)
src/telegram/ (server impl)       ← webhook server (dropped)
src/slack/ (server impl)          ← Bolt server (dropped)
src/tts/                          ← Node file I/O (dropped)
src/media/host.ts, store.ts       ← HTTP server (dropped)
```

---

## What Users Can vs Cannot Do

### Can do (100% in browser, zero VM):

- **Chat with any LLM** — Anthropic, OpenAI, Google, OpenRouter, Together, Groq, Mistral, etc. (via user's API keys)
- **Streaming responses** — real-time token-by-token display
- **Multi-model support** — switch providers, use fallbacks
- **Agent reasoning** — system prompts, tool calling, compaction
- **Tools** — web search, web fetch, memory search/save
- **Session history** — persistent across page reloads (IndexedDB)
- **Multiple sessions** — create, switch, archive, delete
- **Configuration** — model preferences, system prompts, tool policies
- **Memory/RAG** — full-text search + vector similarity (sql.js WASM)
- **Offline mode** — cached site works without internet (for local model use)
- **Import/export** — download sessions and config as JSON, import on another device
- **All UI features** — themes, focus mode, thinking display, split view

### Cannot do (need desktop `text2llm gateway run`):

- Run shell commands (bash tool)
- Control a browser (Playwright)
- Connect to messaging channels (Discord, Telegram, Slack, WhatsApp, etc.)
- File system access (read/write arbitrary files)
- Docker sandbox
- TTS audio file handling
- Background persistent processing (goes away when tab closes, but Service Worker helps)

### Cannot do (need Part 2 cloud):

- Train LLMs from scratch at meaningful scale
- Host models for production inference
- Cross-device sync
- Team collaboration
- Marketplace

---

## Dependency Changes for Browser Build

### New dependencies

| Package           | Size          | What for                       |
| ----------------- | ------------- | ------------------------------ |
| `sql.js`          | 1.2 MB (WASM) | SQLite in browser (memory/RAG) |
| `idb`             | 1.2 KB        | Tiny IndexedDB wrapper         |
| `path-browserify` | 6 KB          | `node:path` polyfill           |

### Existing dependencies that work in browser

| Package                                | Notes                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `lit` 3.3.2                            | Already browser-native                                                                                  |
| `marked` 17.0.2                        | Already browser-native                                                                                  |
| `dompurify` 3.3.1                      | Already browser-native                                                                                  |
| `@noble/ed25519` 3.0.0                 | Already browser-native                                                                                  |
| `@mariozechner/pi-ai` (`streamSimple`) | Uses `fetch()` internally — browser-safe. Dynamic `node:` imports are lazy and won't trigger in browser |
| `@mariozechner/pi-agent-core`          | Zero `node:` imports — browser-safe                                                                     |
| `JSON5`                                | Already browser-native                                                                                  |

### Dependencies NOT included in browser build

| Package                          | Why excluded                                                       |
| -------------------------------- | ------------------------------------------------------------------ |
| `@mariozechner/pi-coding-agent`  | 20+ static `node:` imports. Replaced by `browser-agent-session.ts` |
| `@mariozechner/pi-tui`           | Terminal UI — not needed                                           |
| `discord.js`                     | WebSocket gateway client for Discord — server only                 |
| `grammy`                         | Telegram bot framework — server only                               |
| `@slack/bolt`                    | Slack bot framework — server only                                  |
| `chokidar`                       | File watcher — not needed                                          |
| `proper-lockfile`                | File locking — not needed                                          |
| `better-sqlite3` / `node:sqlite` | Replaced by sql.js                                                 |
| `playwright`                     | Browser automation — server only                                   |

---

## Timeline Summary

| Phase       | Weeks | What gets done                                             | Deliverable                                      |
| ----------- | ----- | ---------------------------------------------------------- | ------------------------------------------------ |
| **Phase 0** | 1-2   | Storage adapters (IndexedDB config, sessions, credentials) | Agent core can use browser storage               |
| **Phase 1** | 3-4   | Browser agent session + runner                             | Chat works in browser without gateway            |
| **Phase 2** | 5     | CORS proxy + build pipeline                                | `pnpm build:web` produces deployable static site |
| **Phase 3** | 6-7   | Service Worker + offline mode                              | Site works offline, background processing        |
| **Phase 4** | 8-10  | Integration testing, polish, all providers                 | **Ship v1: zero-VM website**                     |

**Total: ~10 weeks to go from VM-dependent to fully client-side.**

**New code: ~2,000 LOC.** Modified code: ~500 LOC. No existing functionality removed (desktop mode still works).

---

## Risks and Mitigations

| Risk                                  | Impact                                         | Mitigation                                                                                                                       |
| ------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **CORS blocks on LLM APIs**           | Users can't call OpenAI/Anthropic from browser | Cloudflare Worker proxy (free tier, ~10 lines). Many providers already allow browser CORS (OpenRouter, Together, Groq).          |
| **`pi-coding-agent` interface drift** | Our browser shim breaks when SDK updates       | Pin SDK version. Long-term: upstream browser support to `@mariozechner/pi-coding-agent`.                                         |
| **sql.js performance**                | Slow RAG queries on large memory sets          | sql.js FTS5 is fast. For vector search, precompute top-N and cache. Falls back gracefully.                                       |
| **IndexedDB storage limits**          | Browser may limit storage to ~2GB              | Use `navigator.storage.persist()` to request persistent storage. Warn user if approaching limit. Offer export.                   |
| **Tab close loses in-flight work**    | User closes tab mid-generation                 | Service Worker continues processing. `beforeunload` event warns user. Auto-save every message.                                   |
| **API key exposure in browser**       | Keys visible in browser dev tools              | Same as any client-side app (like Cursor, Continue, etc.). Keys only exist in user's own browser. Not transmitted to any server. |
