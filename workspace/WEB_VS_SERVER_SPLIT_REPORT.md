# Web vs Server Split Report — Detailed Technical Audit

> Based on a file-by-file analysis of every `node:` import, native binary dependency,
> server listener, and filesystem operation across 200+ source files, 35 extensions,
> and 3 native apps.

---

## TL;DR — The Two Parts

```
┌──────────────────────────────────────────────────────────────────────────┐
│  PART 1 — WEB (runs in browser, user's device does the processing)     │
│                                                                        │
│  ✅ UI (already a browser SPA — Lit + Vite)                            │
│  ✅ Agent reasoning core (system prompt, compaction, model selection)   │
│  ✅ LLM API calls (fetch-based, user's API keys)                       │
│  ✅ Streaming response handling                                        │
│  ✅ 11 thin channel extensions (discord, telegram, slack, etc.)         │
│  ✅ Web tools (web-fetch, web-search)                                  │
│  ✅ Channel action tools (discord, slack, telegram, whatsapp actions)   │
│  ✅ Memory tool interface                                              │
│  ✅ Gateway client (already reimplemented in browser)                   │
│  ✅ Session display + navigation                                       │
│  ⚠️  Session storage (needs IndexedDB adapter, currently: filesystem)  │
│  ⚠️  Config (needs IndexedDB adapter, currently: YAML on disk)         │
│  ⚠️  Auth/credentials (needs browser secure storage adapter)           │
│  ⚠️  Media pipeline (needs WebCodecs/Canvas adapter)                   │
│                                                                        │
│  ~55% of current logic can run in the browser                          │
│  (with storage adapters for the ⚠️ items)                              │
├──────────────────────────────────────────────────────────────────────────┤
│  PART 2 — SERVER (must run on Node.js / native platform)               │
│                                                                        │
│  ❌ Gateway server (HTTP + WS listeners, TLS, port binding)            │
│  ❌ Bash/shell tools (child_process.spawn)                             │
│  ❌ Browser automation (spawns Chrome, Playwright)                      │
│  ❌ Sandbox/Docker (child_process, Docker socket)                      │
│  ❌ CLI (terminal I/O, process.argv, stdin/stdout)                     │
│  ❌ Daemon management (launchd, systemd, schtasks)                     │
│  ❌ 18 heavy extensions (native SDKs, TCP sockets, servers)             │
│  ❌ Signal channel (spawns signal-cli binary)                          │
│  ❌ iMessage (spawns AppleScript/osascript)                            │
│  ❌ WhatsApp Web provider (Baileys — Node sockets)                      │
│  ❌ Memory/SQLite (node:sqlite, sqlite-vec native addon)                │
│  ❌ File watchers (chokidar)                                           │
│  ❌ Canvas host server                                                 │
│  ❌ TLS certificate generation                                         │
│  ❌ SSH tunnels                                                        │
│  ❌ Tailscale integration                                              │
│  ❌ Native apps (Swift/Kotlin — separate binaries)                     │
│                                                                        │
│  ~45% of current code is server-only                                   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## PART 1 — What CAN Run in the Web Browser

### 1.1 Already Browser-Native (zero changes needed)

| Module             | Location               | What it does                                        | Why it works in browser                                                                             |
| ------------------ | ---------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Control UI**     | `ui/` (Lit + Vite SPA) | Full dashboard, chat, settings, themes, device auth | Already a pure browser app. Connects to gateway via `WebSocket` + `@noble/ed25519` + `localStorage` |
| **Gateway Client** | `ui/src/ui/gateway.ts` | Browser-side WS client to gateway                   | Already reimplemented for browser — uses native `WebSocket`, `localStorage`, web crypto             |

### 1.2 Agent Core — Pure Logic (no Node.js APIs)

These files have **zero `node:` imports** and use only standard JS/TS:

| Module                     | Files                                                | What it does                                       |
| -------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| **System prompt builder**  | `src/agents/system-prompt.ts`                        | Constructs system prompts from config + context    |
| **Model selection**        | `src/agents/model-selection.ts`                      | Resolves which provider/model to use               |
| **Context window guard**   | `src/agents/context-window-guard.ts`                 | Token budget calculation                           |
| **Compaction**             | `src/agents/compaction.ts`                           | Summarizes conversation when it gets too long      |
| **Streaming subscription** | `src/agents/pi-embedded-subscribe.ts`                | Handles streaming SSE/text responses from LLM APIs |
| **Error classification**   | `src/agents/pi-embedded-helpers/errors.ts`           | Classifies API error responses                     |
| **Turn ordering**          | `src/agents/pi-embedded-helpers/turns.ts`            | Validates message turn structure                   |
| **Thinking extraction**    | `src/agents/pi-embedded-helpers/thinking.ts`         | Extracts reasoning blocks                          |
| **Message dedup**          | `src/agents/pi-embedded-helpers/messaging-dedupe.ts` | Prevents duplicate sends                           |
| **Type definitions**       | `src/agents/pi-embedded-helpers/types.ts`            | Pure types                                         |
| **Defaults**               | `src/agents/defaults.ts`                             | Default model/provider constants                   |
| **Identity**               | `src/agents/identity.ts`                             | Agent identity/persona resolution                  |
| **Lanes**                  | `src/agents/lanes.ts`                                | Parallel request lane management                   |
| **Tool display**           | `src/agents/tool-display.ts`                         | Human-readable tool call formatting                |
| **Tool summaries**         | `src/agents/tool-summaries.ts`                       | Summarizes tool results for context                |
| **Tool policy**            | `src/agents/tool-policy.ts`                          | Which tools are allowed per config                 |
| **Usage tracking**         | `src/agents/usage.ts`                                | Token/cost accounting (in-memory)                  |
| **Failover error**         | `src/agents/failover-error.ts`                       | Error handling for model fallback                  |
| **Model compat**           | `src/agents/model-compat.ts`                         | Provider compatibility shims                       |
| **Model fallback**         | `src/agents/model-fallback.ts`                       | Cascade logic for model failures                   |

**Summary: ~20 core agent files are 100% browser-portable today.**

### 1.3 Agent Tools — Pure Logic (no Node.js APIs)

| Tool                 | File                                             | What it does                             |
| -------------------- | ------------------------------------------------ | ---------------------------------------- |
| **Web fetch**        | `src/agents/tools/web-fetch.ts`                  | Fetches URLs — uses `fetch()`            |
| **Web search**       | `src/agents/tools/web-search.ts`                 | Brave/Perplexity search — uses `fetch()` |
| **Memory**           | `src/agents/tools/memory-tool.ts`                | Memory operations via clean interface    |
| **Gateway**          | `src/agents/tools/gateway-tool.ts`               | Gateway control via WS                   |
| **Cron**             | `src/agents/tools/cron-tool.ts`                  | Cron management via gateway              |
| **Discord actions**  | `src/agents/tools/discord-actions*.ts` (4 files) | Discord API calls                        |
| **Slack actions**    | `src/agents/tools/slack-actions.ts`              | Slack API calls                          |
| **Telegram actions** | `src/agents/tools/telegram-actions.ts`           | Telegram API calls                       |
| **WhatsApp actions** | `src/agents/tools/whatsapp-actions.ts`           | WhatsApp reactions                       |
| **Message tool**     | `src/agents/tools/message-tool.ts`               | Cross-channel messaging                  |
| **Session status**   | `src/agents/tools/session-status-tool.ts`        | Session info display                     |
| **Session history**  | `src/agents/tools/sessions-history-tool.ts`      | History retrieval via gateway            |
| **Sessions helpers** | `src/agents/tools/sessions-helpers.ts`           | Utility functions                        |
| **Agents list**      | `src/agents/tools/agents-list-tool.ts`           | Lists available agents                   |
| **Nodes utils**      | `src/agents/tools/nodes-utils.ts`                | Node communication wrappers              |
| **Web tools barrel** | `src/agents/tools/web-tools.ts`                  | Re-exports                               |

**Summary: 16 tool files are 100% browser-portable today.**

### 1.4 Extensions — Browser-Portable (no Node.js APIs)

| Extension                   | Dependencies | Notes                        |
| --------------------------- | ------------ | ---------------------------- |
| `extensions/discord/`       | none         | Thin plugin-sdk wrapper      |
| `extensions/telegram/`      | none         | Thin plugin-sdk wrapper      |
| `extensions/slack/`         | none         | Thin plugin-sdk wrapper      |
| `extensions/signal/`        | none         | Thin plugin-sdk wrapper      |
| `extensions/imessage/`      | none         | Thin plugin-sdk wrapper      |
| `extensions/whatsapp/`      | none         | Thin plugin-sdk wrapper      |
| `extensions/line/`          | none         | Thin plugin-sdk wrapper      |
| `extensions/memory-core/`   | none         | Memory interface only        |
| `extensions/talk-voice/`    | none         | ElevenLabs TTS via `fetch()` |
| `extensions/copilot-proxy/` | none         | Proxy config registration    |
| `extensions/open-prose/`    | none         | Noop registration            |

**Summary: 11 extensions are 100% browser-portable.**

### 1.5 Needs Adapter / Polyfill (⚠️ — runs in browser with work)

| Module                                                                                   | Current Node.js deps                                                    | Browser replacement                                                                    | Effort                                               |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Session persistence** (`src/agents/pi-embedded-runner/run.ts`, `session-manager-*.ts`) | `node:fs/promises` — reads/writes JSONL session files                   | **IndexedDB** or **OPFS** (Origin Private File System) for session storage             | Medium — need a `SessionStore` interface abstraction |
| **Config** (`src/config/io.ts`, `src/config/paths.ts`)                                   | `node:fs`, `node:os`, `node:path` — reads YAML/JSON from `~/.text2llm/` | **IndexedDB** for config persistence, or import/export JSON blobs                      | Medium — need a `ConfigStore` interface              |
| **Auth/credentials** (`src/agents/auth-profiles/`, `src/agents/model-auth.ts`)           | `node:fs` — reads API keys from `~/.text2llm/credentials/`              | Browser `localStorage` (encrypted) or **Web Crypto API** + IndexedDB                   | Medium — need a `CredentialStore` interface          |
| **Model catalog** (`src/agents/models-config.ts`, `src/agents/model-catalog.ts`)         | `node:fs/promises`, `node:path` — reads/writes `models.json`            | IndexedDB                                                                              | Low — just storage swap                              |
| **`crypto.randomUUID()`** (4 tool files)                                                 | `node:crypto`                                                           | `globalThis.crypto.randomUUID()` — already available in all modern browsers since 2021 | Trivial — 4 one-line changes                         |
| **`Buffer` usage** (`src/agents/tools/image-tool.helpers.ts`)                            | Node `Buffer.from(b64, "base64")`                                       | `atob()` + `Uint8Array`                                                                | Trivial — 1 file                                     |
| **`node:path`** (7 files)                                                                | Path manipulation                                                       | `path-browserify` npm package or custom `posixPath` util                               | Low                                                  |
| **Routing logic** (`src/routing/`)                                                       | Mostly pure, some config reads                                          | IndexedDB adapter                                                                      | Low                                                  |
| **Event system** (`src/sessions/`, `src/channels/`)                                      | Pub/sub events, some `process.env`                                      | Remove `process.env` references                                                        | Low                                                  |
| **Media attachments** (`src/media-understanding/attachments.ts`)                         | `node:fs`, `node:os`, `node:url` — temp file handling                   | **Blob URLs** + browser memory                                                         | Medium                                               |
| **Media fetch** (`src/media/fetch.ts`)                                                   | Uses `fetch` but also `node:path` for temp files                        | Use `Blob` storage                                                                     | Low-Medium                                           |
| **Skills loading** (`src/agents/skills.ts`)                                              | `node:fs/promises` — reads skill files from disk                        | Fetch skills from URL / bundle into browser app                                        | Medium                                               |

### 1.6 LLM Training in Browser (NEW capability to build)

| Feature                   | Browser Technology                                   | Feasibility                                          |
| ------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| **Inference (1-7B)**      | WebLLM / transformers.js / llama.cpp WASM            | Proven — WebLLM runs Llama 3B at 30+ tok/s on M1     |
| **LoRA fine-tune (1-3B)** | WebGPU compute shaders                               | Experimental but demonstrated (WebLLM + custom WGSL) |
| **Dataset management**    | IndexedDB + File System Access API                   | Standard browser APIs, reliable                      |
| **Tokenizer training**    | WASM port of SentencePiece                           | Available                                            |
| **Model quantization**    | WASM port of llama.cpp quantize                      | Available                                            |
| **Evaluation**            | Run inference on eval set, compute metrics in JS     | Standard — all math                                  |
| **Model export (GGUF)**   | Generate binary blob, trigger download via `<a>` tag | Standard                                             |

---

## PART 2 — What CANNOT Run in the Web Browser

### 2.1 Gateway Server — The TCP/HTTP/WS Listener

**Why it can't run in browser:** A browser cannot bind to a TCP port, accept inbound connections, or run an HTTP/HTTPS server. The gateway is the central server.

| File                              | Node.js APIs                                            | What it does                                      |
| --------------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| `src/gateway/server-http.ts`      | `http.createServer`, `https.createServer`, `TlsOptions` | Binds to port 18789, serves HTTP + WS             |
| `src/gateway/server.ts`           | Orchestrates full server lifecycle                      | Server entry point                                |
| `src/gateway/server-startup.ts`   | `node:fs`, `node:os`, `node:crypto`                     | Boot sequence, PID files                          |
| `src/gateway/net.ts`              | `node:net`, `node:os`                                   | Network interface detection                       |
| `src/gateway/server-http.ts`      | `node:http`, `node:https`, `node:tls`                   | HTTP server creation                              |
| `src/gateway/server-close.ts`     | `http.Server`                                           | Graceful shutdown                                 |
| `src/gateway/origin-check.ts`     | Request validation                                      | CORS + origin checking (could be browser-adapted) |
| `src/gateway/server-browser.ts`   | `node:http`, Playwright                                 | Serves browser control tools                      |
| `src/gateway/server-channels.ts`  | —                                                       | Channel lifecycle management                      |
| `src/gateway/ws-log.ts`           | `node:fs`                                               | WebSocket message logging                         |
| `src/gateway/probe.ts`            | `node:crypto`                                           | Health check probing                              |
| `src/gateway/server-discovery.ts` | `node:fs`, `node:os`                                    | mDNS/Bonjour discovery                            |
| `src/gateway/server-tailscale.ts` | —                                                       | Tailscale Serve/Funnel integration                |
| `src/gateway/session-utils.fs.ts` | `node:fs/promises`, `node:os`, `node:path`              | Session file CRUD                                 |
| `src/gateway/config-reload.ts`    | `chokidar`                                              | File watcher for config hot-reload                |

**Total: ~60 gateway server files are strictly Node.js**

### 2.2 Bash/Shell Tools — child_process

**Why it can't run in browser:** Browsers have no access to the operating system's shell, cannot spawn processes, cannot read/write arbitrary filesystem paths.

| File                                  | Node.js APIs                        | What it does                        |
| ------------------------------------- | ----------------------------------- | ----------------------------------- |
| `src/agents/bash-tools.ts`            | —                                   | Tool definitions for bash execution |
| `src/agents/bash-tools.exec.ts`       | `node:child_process`, `node:crypto` | Spawns shell processes, PTY         |
| `src/agents/bash-tools.shared.ts`     | `ChildProcessWithoutNullStreams`    | Shared IPC types                    |
| `src/agents/bash-process-registry.ts` | `ChildProcessWithoutNullStreams`    | Tracks running processes            |
| `src/agents/shell-utils.ts`           | `node:child_process.spawn`          | Shell detection + spawning          |
| `src/agents/cli-runner.ts`            | —                                   | CLI subprocess orchestration        |
| `src/agents/cli-runner/*.ts`          | `node:child_process`                | Various subprocess runners          |

### 2.3 Sandbox / Docker

**Why it can't run in browser:** Docker socket access, container lifecycle management.

| File                                | Node.js APIs                           |
| ----------------------------------- | -------------------------------------- |
| `src/agents/sandbox/docker.ts`      | `node:child_process.spawn`, Docker CLI |
| `src/agents/sandbox/shared.ts`      | `node:crypto`                          |
| `src/agents/sandbox/config-hash.ts` | `node:crypto`                          |
| `src/agents/sandbox-paths.ts`       | `node:path`, `node:url`                |

### 2.4 Browser Automation — Playwright/Chrome

**Why it can't run in browser:** A browser tab cannot spawn another Chrome instance, control it via CDP, or run Playwright.

| File                                | Node.js APIs                                                    | What it does                     |
| ----------------------------------- | --------------------------------------------------------------- | -------------------------------- |
| `src/browser/chrome.ts`             | `node:child_process.spawn`                                      | Spawns Chrome process            |
| `src/browser/chrome.executables.ts` | `node:child_process.execFileSync`                               | Finds Chrome binary              |
| `src/browser/server.ts`             | `node:http.Server`                                              | Express server for browser tools |
| `src/browser/bridge-server.ts`      | `node:http.Server`, `node:net`                                  | WebSocket bridge                 |
| `src/browser/extension-relay.ts`    | `node:http.createServer`, `node:net`, `node:tls`, `node:stream` | Extension relay server           |
| `src/browser/control-auth.ts`       | `node:crypto`                                                   | Auth token management            |
| `src/agents/tools/browser-tool.ts`  | `node:crypto`, Playwright imports                               | Browser tool orchestration       |

### 2.5 CLI & Terminal

**Why it can't run in browser:** Terminal I/O, process arguments, stdin/stdout, signal handling.

| File                            | Node.js APIs                                                      |
| ------------------------------- | ----------------------------------------------------------------- |
| `src/cli/*.ts` (50+ files)      | `process.argv`, `process.stdin`, `process.stdout`, `process.exit` |
| `src/entry.ts`                  | `node:child_process.spawn`, `node:process`                        |
| `src/cli/prompt.ts`             | `process.stdin`, `process.stdout`                                 |
| `src/commands/*.ts` (40+ files) | `node:fs`, `node:child_process`, `node:os`                        |
| `src/wizard/*.ts`               | `node:fs`, interactive prompts                                    |
| `src/terminal/*.ts`             | ANSI codes, terminal width detection                              |

### 2.6 Daemon Management

**Why it can't run in browser:** OS service management (launchd, systemd, Windows Task Scheduler).

| File                        | Node.js APIs                             |
| --------------------------- | ---------------------------------------- |
| `src/daemon/launchd.ts`     | `node:child_process.execFile`, `node:fs` |
| `src/daemon/systemd.ts`     | `node:child_process.execFile`, `node:fs` |
| `src/daemon/schtasks.ts`    | `node:child_process.execFile`, `node:fs` |
| `src/daemon/inspect.ts`     | `node:child_process.execFile`, `node:fs` |
| `src/daemon/diagnostics.ts` | `node:fs`                                |

### 2.7 Channel Implementations — Server-Side

**Why they can't run in browser:** These maintain persistent connections (TCP sockets, long-polling servers, native binaries).

| Channel                | Node.js dependency                                  | Reason                                                   |
| ---------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| **WhatsApp (Baileys)** | `src/web/` — Node sockets, crypto, fs               | Baileys library uses Node.js TCP sockets for WA protocol |
| **Signal**             | `src/signal/daemon.ts` — `spawn("signal-cli")`      | Spawns the signal-cli Java binary                        |
| **iMessage**           | `src/imessage/client.ts` — `spawn`, reads SQLite DB | Spawns osascript/AppleScript + reads Messages.db         |
| **Discord**            | `src/discord/` — discord.js (EventEmitter, WS)      | discord.js uses Node.js `EventEmitter`, WS library       |
| **Telegram**           | `src/telegram/` — grammY, webhook server            | Runs HTTP webhook server via `http.createServer`         |
| **Slack**              | `src/slack/` — Bolt for JS, HTTP server             | Bolt starts an HTTP server for events API                |
| **Line**               | `src/line/` — HTTP server for webhooks              | `http.createServer` for webhook receiver                 |

### 2.8 Memory / SQLite

**Why it can't run in browser:** Uses `node:sqlite` (Node 22+ built-in SQLite) + `sqlite-vec` native extension for vector search.

| File                         | Node.js APIs                                                     |
| ---------------------------- | ---------------------------------------------------------------- |
| `src/memory/sqlite.ts`       | `require("node:sqlite")` — `DatabaseSync`                        |
| `src/memory/manager.ts`      | `chokidar`, `node:sqlite`, `node:crypto`, `node:fs`, `node:path` |
| `src/memory/embeddings.ts`   | `node:fs`                                                        |
| `src/memory/qmd-manager.ts`  | `node:child_process.spawn`, `node:os`                            |
| `extensions/memory-lancedb/` | `@lancedb/lancedb` (native Rust bindings)                        |

**Browser alternative:** `sql.js` (SQLite compiled to WASM) + in-browser vector search (Vectra/HNSWlib-WASM).

### 2.9 Media Pipeline — Server-Side

| File                     | Node.js APIs                                        | Reason                         |
| ------------------------ | --------------------------------------------------- | ------------------------------ |
| `src/media/host.ts`      | `node:fs`, `node:http`                              | Serves media files over HTTP   |
| `src/media/store.ts`     | `node:fs`, `node:crypto`, `node:http`, `node:https` | Downloads/stores media to disk |
| `src/media/image-ops.ts` | `node:fs`, `@napi-rs/canvas` (optional native)      | Image resize/conversion        |
| `src/media/server.ts`    | `node:http.Server`                                  | Media HTTP server              |
| `src/tts/tts.ts`         | `node:fs`, `node:os`                                | TTS audio file management      |

### 2.10 Extensions — Server-Only

| Extension                      | Why it can't run in browser                                   |
| ------------------------------ | ------------------------------------------------------------- |
| `extensions/msteams/`          | Express HTTP server, `proper-lockfile`                        |
| `extensions/matrix/`           | `@matrix-org/matrix-sdk-crypto-nodejs` — native Rust bindings |
| `extensions/bluebubbles/`      | `node:http`, `node:crypto`, persistent connection             |
| `extensions/googlechat/`       | `google-auth-library`, `node:http`                            |
| `extensions/feishu/`           | `@larksuiteoapi/node-sdk`, `node:fs`                          |
| `extensions/zalo/`             | `undici`, `node:http`, `node:fs`                              |
| `extensions/zalouser/`         | `node:child_process` (spawns `zca-cli`)                       |
| `extensions/mattermost/`       | `Buffer` usage                                                |
| `extensions/nextcloud-talk/`   | `node:http.createServer`, `node:crypto`, `node:fs`            |
| `extensions/irc/`              | `node:net`, `node:tls` — raw TCP/TLS sockets                  |
| `extensions/nostr/`            | `node:crypto`, `node:fs`, `node:http`, `node:net`             |
| `extensions/tlon/`             | `node:stream`, `node:util`                                    |
| `extensions/voice-call/`       | `node:http`, `node:child_process`, `ws` server                |
| `extensions/lobster/`          | `node:child_process`, `node:fs`                               |
| `extensions/llm-task/`         | `node:fs/promises`, `node:os`                                 |
| `extensions/device-pair/`      | `node:os`                                                     |
| `extensions/phone-control/`    | `node:fs/promises`                                            |
| `extensions/diagnostics-otel/` | OpenTelemetry SDK (Node.js)                                   |

### 2.11 Infrastructure / Networking

| File                           | Node.js APIs                              | Reason                             |
| ------------------------------ | ----------------------------------------- | ---------------------------------- |
| `src/infra/ssh-tunnel.ts`      | `node:child_process.spawn`, `node:net`    | SSH tunnel management              |
| `src/infra/ssh-config.ts`      | `node:child_process.spawn`                | SSH config parsing                 |
| `src/infra/tls/gateway.ts`     | `node:tls`, `node:child_process.execFile` | TLS cert generation                |
| `src/infra/ports.ts`           | `node:net`                                | Port availability checking         |
| `src/infra/exec-host.ts`       | `node:net`, `node:crypto`                 | Execution approval IPC             |
| `src/infra/system-presence.ts` | `node:child_process.spawnSync`            | OS presence detection              |
| `src/infra/machine-name.ts`    | `node:child_process.execFile`, `node:os`  | Hostname resolution                |
| `src/infra/device-identity.ts` | `node:crypto`, `node:fs`                  | Device key management              |
| `src/infra/dns`                | `node:dns`                                | DNS resolution for SSRF protection |

### 2.12 Native Apps (separate codebases, not JS)

| App             | Language            | Reason                |
| --------------- | ------------------- | --------------------- |
| `apps/macos/`   | Swift / SwiftUI     | Native macOS binary   |
| `apps/ios/`     | Swift / SwiftUI     | Native iOS binary     |
| `apps/android/` | Kotlin / Gradle     | Native Android binary |
| `apps/shared/`  | Swift (Text2llmKit) | Shared Swift package  |

---

## Quantified Summary

### By file count (approximate)

| Category                                 | Files      | % of src/ |
| ---------------------------------------- | ---------- | --------- |
| **PURE — runs in browser today**         | ~120 files | 25%       |
| **PORTABLE — runs with storage adapter** | ~140 files | 30%       |
| **NODE-ONLY — must stay server-side**    | ~200 files | 45%       |

### By subsystem

| Subsystem                  | Browser?           | Files       | Key blocker                     |
| -------------------------- | ------------------ | ----------- | ------------------------------- |
| UI (`ui/`)                 | ✅ Already browser | ~55 files   | None                            |
| Agent reasoning core       | ✅ Pure logic      | ~20 files   | None                            |
| Agent tools (web/channel)  | ✅ Pure logic      | ~16 files   | None                            |
| 11 thin extensions         | ✅ Pure logic      | ~11 files   | None                            |
| Streaming/subscription     | ✅ Pure logic      | ~5 files    | None                            |
| Plugin SDK types           | ✅ Pure types      | ~10 files   | None                            |
| Agent tools (file/browser) | ❌ Node-only       | ~6 files    | `node:fs`, Playwright           |
| Agent runner (pi-embedded) | ⚠️ Needs adapter   | ~15 files   | `node:fs` for session I/O       |
| Config                     | ⚠️ Needs adapter   | ~10 files   | `node:fs` for config reads      |
| Auth/credentials           | ⚠️ Needs adapter   | ~5 files    | `node:fs` for credential files  |
| Gateway server             | ❌ Node-only       | ~60 files   | TCP/HTTP server                 |
| Bash/sandbox tools         | ❌ Node-only       | ~15 files   | `child_process`                 |
| Browser automation         | ❌ Node-only       | ~15 files   | Playwright, Chrome spawn        |
| CLI                        | ❌ Node-only       | ~90 files   | Terminal I/O                    |
| Daemon                     | ❌ Node-only       | ~12 files   | OS service management           |
| Channel server impls       | ❌ Node-only       | ~40 files   | Persistent connections, servers |
| Memory/SQLite              | ❌ Node-only       | ~10 files   | `node:sqlite`, native addon     |
| Media server               | ❌ Node-only       | ~8 files    | HTTP server, fs                 |
| Infrastructure             | ❌ Node-only       | ~25 files   | SSH, TLS, DNS, ports            |
| 18 heavy extensions        | ❌ Node-only       | ~18 files   | Native SDKs, TCP, servers       |
| Native apps                | ❌ Separate lang   | ~100+ files | Swift, Kotlin                   |

---

## The Abstraction Layers Needed

To make Part 1 work in the browser, we need **4 interface abstractions**:

### 1. `StorageAdapter` — Replace `node:fs`

```typescript
interface StorageAdapter {
  // Sessions
  readSession(key: string): Promise<SessionData | null>;
  writeSession(key: string, data: SessionData): Promise<void>;
  listSessions(): Promise<string[]>;
  deleteSession(key: string): Promise<void>;

  // Config
  readConfig(): Promise<Config>;
  writeConfig(config: Config): Promise<void>;

  // Datasets
  readDataset(id: string): Promise<DatasetEntry[]>;
  writeDataset(id: string, entries: DatasetEntry[]): Promise<void>;

  // Model weights
  readBlob(key: string): Promise<Uint8Array | null>;
  writeBlob(key: string, data: Uint8Array): Promise<void>;
  deleteBlob(key: string): Promise<void>;
  getBlobSize(key: string): Promise<number>;
}

// Node.js implementation (existing behavior)
class FsStorageAdapter implements StorageAdapter {
  /* uses node:fs */
}

// Browser implementation (new)
class BrowserStorageAdapter implements StorageAdapter {
  // Sessions + Config → IndexedDB
  // Model weights → OPFS (Origin Private File System)
  // Datasets → IndexedDB
}
```

### 2. `CredentialAdapter` — Replace file-based credential store

```typescript
interface CredentialAdapter {
  getApiKey(provider: string): Promise<string | null>
  setApiKey(provider: string, key: string): Promise<void>
  deleteApiKey(provider: string): Promise<void>
  listProviders(): Promise<string[]>
}

// Node: reads from ~/.text2llm/credentials/
class FsCredentialAdapter implements CredentialAdapter { ... }

// Browser: encrypted in IndexedDB via Web Crypto API
class BrowserCredentialAdapter implements CredentialAdapter { ... }
```

### 3. `MediaAdapter` — Replace file-based media handling

```typescript
interface MediaAdapter {
  storeMedia(data: Uint8Array, mime: string): Promise<string>  // returns URL/key
  getMedia(key: string): Promise<Uint8Array | null>
  getMediaUrl(key: string): string  // blob: URL in browser, http:// in Node
  deleteMedia(key: string): Promise<void>
}

// Node: writes to /tmp, serves via HTTP
class FsMediaAdapter implements MediaAdapter { ... }

// Browser: Blob URLs + OPFS
class BrowserMediaAdapter implements MediaAdapter { ... }
```

### 4. `CryptoAdapter` — Replace `node:crypto` with Web Crypto

```typescript
// Mostly just replacing:
// node:crypto randomUUID() → globalThis.crypto.randomUUID()
// node:crypto randomBytes() → globalThis.crypto.getRandomValues()
// node:crypto createHash() → globalThis.crypto.subtle.digest()
// Buffer.from(b64, 'base64') → atob() + Uint8Array
```

This is mostly **mechanical replacement** — 4 files use `crypto.randomUUID()`, 1 file uses `Buffer.from()`.

---

## Recommended Project Split

### Repository: `text2llm/text2llm` (open source, MIT)

```
src/
├── core/                          ← NEW: browser-portable core
│   ├── agent/                     ← extracted from src/agents/ (pure logic only)
│   │   ├── system-prompt.ts
│   │   ├── model-selection.ts
│   │   ├── compaction.ts
│   │   ├── context-window-guard.ts
│   │   ├── streaming.ts          ← from pi-embedded-subscribe.ts
│   │   ├── defaults.ts
│   │   ├── identity.ts
│   │   ├── usage.ts
│   │   ├── failover.ts
│   │   ├── tool-policy.ts
│   │   └── helpers/              ← from pi-embedded-helpers/ (pure parts)
│   ├── tools/                     ← browser-safe tools
│   │   ├── web-fetch.ts
│   │   ├── web-search.ts
│   │   ├── memory-tool.ts
│   │   ├── discord-actions.ts
│   │   ├── slack-actions.ts
│   │   ├── telegram-actions.ts
│   │   └── message-tool.ts
│   ├── storage/                   ← storage abstraction
│   │   ├── adapter.ts            ← StorageAdapter interface
│   │   ├── credential-adapter.ts ← CredentialAdapter interface
│   │   ├── media-adapter.ts      ← MediaAdapter interface
│   │   ├── browser/              ← IndexedDB + OPFS implementations
│   │   └── node/                 ← filesystem implementations (existing code)
│   ├── training/                  ← NEW: local training pipeline
│   │   ├── finetune/
│   │   ├── eval/
│   │   ├── datasets/
│   │   └── export/
│   ├── web-runtime/               ← NEW: browser entry point
│   │   ├── inference/            ← WebGPU/WASM inference
│   │   ├── training/             ← WebGPU LoRA training
│   │   └── service-worker.ts     ← offline mode
│   └── plugin-sdk/                ← existing, already portable
│
├── server/                        ← Node.js-only code (stays here)
│   ├── gateway/                   ← the WS/HTTP server
│   ├── channels/                  ← channel implementations
│   ├── cli/                       ← terminal CLI
│   ├── daemon/                    ← OS service management
│   ├── browser-automation/        ← Playwright/Chrome
│   ├── bash-tools/                ← shell execution
│   ├── sandbox/                   ← Docker sandboxing
│   ├── memory-sqlite/             ← SQLite memory
│   ├── media-server/              ← media HTTP server
│   └── infra/                     ← SSH, TLS, networking
│
├── extensions/                    ← stays, mixed portability
│   ├── [11 browser-portable ones]
│   └── [18 server-only ones]
│
├── apps/                          ← native apps (unchanged)
│
└── ui/                            ← already browser-native (unchanged)
```

### What this enables

```
BROWSER (Part 1 — web entry)
┌──────────────────────────────────────────────────────────────────┐
│  text2llm.ai/app                                                 │
│                                                                  │
│  Loads: src/core/ + src/core/web-runtime/ + ui/                 │
│                                                                  │
│  ✅ Chat with LLMs (user API keys via fetch)                    │
│  ✅ Run models locally (WebGPU inference: 1-7B)                  │
│  ✅ Fine-tune models (WebGPU LoRA: 1-3B)                        │
│  ✅ Build & manage datasets (IndexedDB)                          │
│  ✅ Evaluate models (run benchmarks in browser)                  │
│  ✅ Export models (GGUF via WASM, trigger download)              │
│  ✅ Web search / web fetch tools                                │
│  ✅ Memory / RAG (in-browser vector store)                       │
│  ✅ Channel actions (Discord/Slack/Telegram API calls)           │
│  ✅ Session persistence (IndexedDB + OPFS)                       │
│  ✅ Offline mode (Service Worker)                                │
│  ❌ No shell/bash tools                                         │
│  ❌ No browser automation (Playwright)                           │
│  ❌ No persistent channel connections (need gateway)             │
│  ❌ No large model training (need GPU server)                    │
└──────────────────────────────────────────────────────────────────┘

DESKTOP (Part 1 — Node.js entry, full power)
┌──────────────────────────────────────────────────────────────────┐
│  text2llm gateway run                                            │
│                                                                  │
│  Loads: src/core/ + src/server/ + extensions/ + apps/           │
│                                                                  │
│  Everything the browser can do PLUS:                             │
│  ✅ Gateway server (HTTP + WS)                                   │
│  ✅ All 35+ channels (persistent connections)                   │
│  ✅ Bash/shell tools                                            │
│  ✅ Browser automation (Playwright)                              │
│  ✅ Docker sandbox                                              │
│  ✅ SQLite memory + vector search                                │
│  ✅ Fine-tuning via CUDA/MPS/ROCm (Axolotl/Unsloth)            │
│  ✅ Pre-training small models (<3B)                              │
│  ✅ CLI, daemon, native apps                                    │
└──────────────────────────────────────────────────────────────────┘

CLOUD (Part 2 — closed source, scale)
┌──────────────────────────────────────────────────────────────────┐
│  text2llm.ai/cloud                                               │
│                                                                  │
│  Everything user can't do locally:                               │
│  ✅ Train 7B-70B+ from scratch (multi-GPU cluster)              │
│  ✅ Accelerated fine-tuning on A100/H100                        │
│  ✅ RLHF alignment (needs 2 large models)                       │
│  ✅ Production inference hosting                                │
│  ✅ Cross-device sync                                           │
│  ✅ Marketplace                                                 │
│  ✅ Team collaboration                                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## Node.js API Usage Heatmap (sorted by frequency)

| Node.js Module                 | Production files using it | Browser replacement                                           |
| ------------------------------ | ------------------------- | ------------------------------------------------------------- |
| `node:fs` / `node:fs/promises` | **200+**                  | IndexedDB, OPFS, Cache API                                    |
| `node:os`                      | **200+**                  | Hardcode/detect via `navigator.userAgent`                     |
| `node:path`                    | **200+**                  | `path-browserify` or custom posix util                        |
| `node:crypto`                  | **~100**                  | `Web Crypto API` (subtle.digest, randomUUID, getRandomValues) |
| `node:child_process`           | **~50**                   | ❌ No browser equivalent                                      |
| `node:http` / `node:https`     | **~45**                   | `fetch()` for client; ❌ no server equivalent                 |
| `node:url`                     | **~25**                   | `URL` global (already standard)                               |
| `node:events`                  | **~20**                   | `EventTarget` or `mitt`                                       |
| `node:util`                    | **~12**                   | Manual polyfills                                              |
| `node:stream`                  | **~12**                   | `ReadableStream` / `WritableStream` (Web Streams API)         |
| `node:net`                     | **~15**                   | ❌ No browser equivalent                                      |
| `node:readline`                | **~4**                    | ❌ Not needed in browser                                      |
| `node:tls`                     | **~3**                    | ❌ No browser equivalent                                      |
| `node:sqlite`                  | **7**                     | `sql.js` (WASM SQLite)                                        |
| `node:zlib`                    | **1**                     | `CompressionStream` / `DecompressionStream`                   |
| `node:dns`                     | **1**                     | ❌ No browser equivalent                                      |
| `node:dgram`                   | **0**                     | —                                                             |
| `node:worker_threads`          | **1**                     | `Web Workers`                                                 |
| `Buffer` global                | **~97**                   | `Uint8Array` + `TextEncoder`/`TextDecoder`                    |
| `process.*` globals            | **hundreds**              | Polyfill `process.env` with config object                     |

---

## Bottom Line

**~55% of the codebase can run in the browser** — the entire agent reasoning core, all LLM API communication, 16 tool implementations, 11 extensions, and the UI are all pure logic using standard web APIs. The remaining ~45% is firmly server-only (TCP servers, shell tools, native binaries, filesystem operations).

The split point is clean: introduce **4 adapter interfaces** (`StorageAdapter`, `CredentialAdapter`, `MediaAdapter`, and swap `node:crypto` for `Web Crypto`), then the core can be compiled to a browser bundle while the server code stays Node.js-only. No need to rewrite logic — just swap the I/O layer.
