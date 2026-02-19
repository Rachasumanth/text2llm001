# text2llm Subsystem Dependency Report

> Generated 2026-02-18 — based on source inspection of key files in each module.

---

## Legend

| Symbol       | Meaning                                                            |
| ------------ | ------------------------------------------------------------------ |
| **FS**       | Filesystem access (`node:fs`, `node:fs/promises`)                  |
| **NET**      | Network server (`node:http`, `node:https`, `node:net`, `node:tls`) |
| **CP**       | Child process / shell-out (`node:child_process`)                   |
| **CRYPTO**   | `node:crypto`                                                      |
| **OS**       | `node:os`                                                          |
| **PATH**     | `node:path`                                                        |
| **STREAM**   | `node:stream` or `node:stream/promises`                            |
| **SQLITE**   | `node:sqlite` (Node 22+)                                           |
| **MODULE**   | `node:module` (`createRequire`)                                    |
| **READLINE** | `node:readline`                                                    |
| **UTIL**     | `node:util`                                                        |

---

## 1. `src/gateway/server-http.ts` — Gateway HTTP/WS Server

| Aspect              | Details                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Node APIs**       | `node:http` (createServer, IncomingMessage, ServerResponse), `node:https` (createServer), `node:tls` (TlsOptions)  |
| **Starts servers?** | **Yes** — creates HTTP/HTTPS servers, attaches WebSocket upgrade handler (via `ws` library `WebSocketServer`)      |
| **Shells out?**     | No                                                                                                                 |
| **Filesystem?**     | Indirectly via config loading                                                                                      |
| **Key 3rd-party**   | `ws` (WebSocketServer)                                                                                             |
| **Verdict**         | **CANNOT run in browser** — creates TCP-level HTTP/HTTPS + WebSocket servers; fundamentally a server-side listener |

## 2. `src/gateway/server.impl.ts` — Gateway Server Orchestrator

| Aspect              | Details                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Node APIs**       | `node:path`                                                                                                                                                              |
| **Starts servers?** | **Yes** — orchestrates server-http, WS, browser control server, media server, discovery, tailscale exposure, cron, config reloader, heartbeat runner, maintenance timers |
| **Shells out?**     | Indirectly (via tailscale, update-check, plugin services, etc.)                                                                                                          |
| **Filesystem?**     | Indirectly (config I/O, agent dirs, state management, etc.)                                                                                                              |
| **Verdict**         | **CANNOT run in browser** — root orchestrator for all server-side subsystems                                                                                             |

## 3. `src/gateway/server-startup.ts` — Gateway Sidecar Startup

| Aspect              | Details                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | `process.env`                                                                                                     |
| **Starts servers?** | **Yes** — starts browser control server, Gmail watcher (child process), plugin services, channels, memory backend |
| **Shells out?**     | Indirectly (Gmail watcher spawns `gog` binary)                                                                    |
| **Filesystem?**     | Indirectly                                                                                                        |
| **Verdict**         | **CANNOT run in browser** — spawns external processes and servers                                                 |

## 4. `src/gateway/client.ts` — Gateway WebSocket Client

| Aspect              | Details                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:crypto` (`randomUUID`)                                                                                                                                                                                                                                                                                                                                                |
| **Starts servers?** | No                                                                                                                                                                                                                                                                                                                                                                          |
| **Shells out?**     | No                                                                                                                                                                                                                                                                                                                                                                          |
| **Filesystem?**     | Indirectly via `device-auth-store` (reads/writes device auth tokens) and `device-identity` (reads/writes key material to `~/.text2llm/`)                                                                                                                                                                                                                                    |
| **Key 3rd-party**   | `ws` (WebSocket client)                                                                                                                                                                                                                                                                                                                                                     |
| **Verdict**         | **CAN run with polyfills/adapters** — `crypto.randomUUID()` available in browsers; `ws` can be replaced with native `WebSocket`; device-identity/auth-store need a browser storage adapter (IndexedDB/localStorage). **Note:** The UI already has a browser-native reimplementation at `ui/src/ui/gateway.ts` using native `WebSocket` + `@noble/ed25519` + `localStorage`. |

## 5. `src/agents/pi-embedded-runner/run.ts` — Agent Runner

| Aspect              | Details                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Node APIs**       | `node:fs/promises` (session I/O, workspace dirs)                                                                                                                                                 |
| **Starts servers?** | No                                                                                                                                                                                               |
| **Shells out?**     | No directly, but invokes model API calls via HTTP (fetch)                                                                                                                                        |
| **Filesystem?**     | **Yes** — reads/writes agent dirs, API key files, session transcripts, workspace dirs                                                                                                            |
| **Key deps**        | Model auth, model catalog, failover logic, compaction, context-window guard                                                                                                                      |
| **Verdict**         | **CAN run with polyfills/adapters** — core logic is orchestration + fetch to LLM APIs; filesystem access needs an abstraction layer (virtual FS / API-backed storage). Heavy refactoring needed. |

## 6. `src/agents/bash-tools.exec.ts` — Bash/Exec Tool

| Aspect              | Details                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:child_process` (ChildProcessWithoutNullStreams), `node:crypto`, `node:path`                         |
| **Starts servers?** | No                                                                                                        |
| **Shells out?**     | **Yes** — core purpose is spawning shell commands (`spawnWithFallback`), Docker exec, PTY sessions        |
| **Filesystem?**     | Indirectly (reads shell config, exec approvals, workdir resolution)                                       |
| **Key 3rd-party**   | `@sinclair/typebox`                                                                                       |
| **Verdict**         | **CANNOT run in browser** — entire purpose is spawning OS-level child processes and managing PTY sessions |

## 7. `src/agents/sandbox/docker.ts` — Docker Sandbox

| Aspect              | Details                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:child_process` (`spawn`)                                                                      |
| **Starts servers?** | No (but manages Docker containers that run servers)                                                 |
| **Shells out?**     | **Yes** — spawns `docker` binary for container lifecycle (create, start, stop, exec, port, inspect) |
| **Filesystem?**     | Indirectly (sandbox registry, config hash)                                                          |
| **Verdict**         | **CANNOT run in browser** — requires Docker CLI binary on the host                                  |

## 8. `src/agents/sandbox/browser.ts` — Browser Sandbox

| Aspect              | Details                                                              |
| ------------------- | -------------------------------------------------------------------- |
| **Node APIs**       | None directly (delegates to `docker.ts` and `bridge-server.ts`)      |
| **Starts servers?** | Indirectly (starts browser bridge server)                            |
| **Shells out?**     | Indirectly (via Docker)                                              |
| **Filesystem?**     | Indirectly                                                           |
| **Verdict**         | **CANNOT run in browser** — depends on Docker sandbox infrastructure |

## 9. `src/channels/` — Channel Routing/Registry

| Aspect              | Details                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | None in core files (`registry.ts`, `session.ts`, `chat-type.ts`)                                                                |
| **Starts servers?** | No                                                                                                                              |
| **Shells out?**     | No                                                                                                                              |
| **Filesystem?**     | Indirectly (session recording delegates to config/sessions which uses FS)                                                       |
| **Key design**      | Pure data structures, channel metadata, session recording, routing/gating logic                                                 |
| **Verdict**         | **CAN run with polyfills/adapters** — mostly pure logic and type definitions; session persistence layer needs a storage adapter |

## 10. `src/media/store.ts` — Media Store

| Aspect              | Details                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:crypto`, `node:fs` (`createWriteStream`), `node:fs/promises`, `node:http` (`request`), `node:https` (`request`), `node:path`, `node:stream/promises` (`pipeline`)           |
| **Starts servers?** | No                                                                                                                                                                                |
| **Shells out?**     | No                                                                                                                                                                                |
| **Filesystem?**     | **Yes** — writes media files to `~/.text2llm/media/`, reads/stats/deletes for TTL cleanup                                                                                         |
| **Verdict**         | **CANNOT run in browser (as-is)** — deeply coupled to filesystem for temp media storage and Node streams for downloading; would need complete rewrite to use Blob/fetch/IndexedDB |

## 11. `src/media/host.ts` — Media Host Server

| Aspect              | Details                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:fs/promises`, imports `node:http` (Server type)                                       |
| **Starts servers?** | **Yes** — starts an HTTP media server (`startMediaServer`)                                  |
| **Shells out?**     | No                                                                                          |
| **Filesystem?**     | Yes (media files + port checking)                                                           |
| **Verdict**         | **CANNOT run in browser** — starts an HTTP server, depends on Tailscale hostname resolution |

## 12. `src/tts/tts.ts` — Text-to-Speech

| Aspect              | Details                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:fs` (sync: existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, renameSync, unlinkSync), `node:os` (`tmpdir`), `node:path` |
| **Starts servers?** | No                                                                                                                                                   |
| **Shells out?**     | No                                                                                                                                                   |
| **Filesystem?**     | **Yes** — heavily uses sync FS for temp file management, audio caching                                                                               |
| **Key 3rd-party**   | `node-edge-tts` (Node-only), `@mariozechner/pi-ai` (LLM client)                                                                                      |
| **Verdict**         | **CANNOT run in browser** — sync FS operations throughout, `node-edge-tts` is Node-only, temp file pipeline logic                                    |

## 13. `src/browser/` — Browser Automation

| Aspect              | Details                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:http` (Server), `node:net` (AddressInfo), `node:child_process` (spawn), `node:fs`, `node:os`, `node:path`        |
| **Starts servers?** | **Yes** — Express HTTP server for browser control (`server.ts`, `bridge-server.ts`)                                    |
| **Shells out?**     | **Yes** — spawns Chrome binary (`chrome.ts`), uses `playwright-core` (`pw-session.ts`)                                 |
| **Filesystem?**     | **Yes** — Chrome profile management, extension management                                                              |
| **Key 3rd-party**   | `express`, `playwright-core`, `ws` (WebSocket to CDP)                                                                  |
| **Verdict**         | **CANNOT run in browser** — spawns Chrome, manages local profiles, runs Express server, uses Playwright for automation |

## 14. `src/memory/` — Memory/RAG

| Aspect              | Details                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:sqlite` (DatabaseSync), `node:crypto` (randomUUID), `node:fs`, `node:fs/promises`, `node:path`, `node:module` (createRequire)                                                                                       |
| **Starts servers?** | No                                                                                                                                                                                                                        |
| **Shells out?**     | No                                                                                                                                                                                                                        |
| **Filesystem?**     | **Yes** — manages SQLite databases, watches files via `chokidar`, reads markdown files for indexing                                                                                                                       |
| **Key 3rd-party**   | `chokidar` (file watcher), `sqlite-vec` (native extension), embedding providers (OpenAI/Gemini/Voyage via HTTP)                                                                                                           |
| **Verdict**         | **CANNOT run in browser** — requires `node:sqlite` (C++ binding), `chokidar` file watcher, `sqlite-vec` native extension. Core embedding/search logic could theoretically work with SQLite WASM + fetch-based embeddings. |

## 15. `src/hooks/` — Hooks/Automation

| Aspect              | Details                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:child_process` (`spawn` in `gmail-watcher.ts`)                                                                                                                  |
| **Starts servers?** | Indirectly (Gmail watcher spawns a `gog` process that serves HTTP)                                                                                                    |
| **Shells out?**     | **Yes** — spawns `gog` binary for Gmail watch                                                                                                                         |
| **Filesystem?**     | Indirectly (hook loader)                                                                                                                                              |
| **Core files**      | `internal-hooks.ts` is pure in-memory event registry (Map-based)                                                                                                      |
| **Verdict**         | **Mixed** — `internal-hooks.ts` is **CAN run in browser** (pure event pub/sub). `gmail-watcher.ts` and `loader.ts` are **CANNOT run in browser** (child_process, FS). |

## 16. `src/plugins/` — Plugin System

| Aspect              | Details                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:fs` (sync), `node:path`, `node:url` (fileURLToPath)                                                                     |
| **Starts servers?** | No (but plugins can register HTTP routes served by the gateway)                                                               |
| **Shells out?**     | No                                                                                                                            |
| **Filesystem?**     | **Yes** — scans directories for plugin packages, resolves file paths, reads manifests                                         |
| **Key 3rd-party**   | `jiti` (TypeScript module loader)                                                                                             |
| **Verdict**         | **CANNOT run in browser** — relies on dynamic filesystem-based module loading via `jiti`, directory scanning, path resolution |

## 17. `src/config/` — Configuration Management

| Aspect              | Details                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:fs` (sync), `node:crypto` (hashing), `node:os`, `node:path`, `node:util` (isDeepStrictEqual)                                                                                                        |
| **Starts servers?** | No                                                                                                                                                                                                        |
| **Shells out?**     | Indirectly (shell-env fallback loads env vars from login shell)                                                                                                                                           |
| **Filesystem?**     | **Yes** — core config I/O reads/writes `~/.text2llm/config.json5`, manages backups, resolves dotenv files                                                                                                 |
| **Key 3rd-party**   | `json5`                                                                                                                                                                                                   |
| **Verdict**         | **CAN run with polyfills/adapters** — config loading/validation logic is separable; I/O layer needs an adapter (fetch from API, localStorage, etc.). Schema validation and type definitions are portable. |

## 18. `src/cli/` — CLI

| Aspect              | Details                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | Heavily via transitive deps (Commander.js, `@clack/prompts`, process.argv, stdout/stderr)               |
| **Starts servers?** | No (delegates to gateway)                                                                               |
| **Shells out?**     | Indirectly                                                                                              |
| **Filesystem?**     | Indirectly                                                                                              |
| **Key 3rd-party**   | `commander`, `@clack/prompts`                                                                           |
| **Verdict**         | **CANNOT run in browser** — terminal I/O, process.argv, interactive prompts, requires full Node runtime |

## 19. `src/daemon/` — Daemon/Service Management

| Aspect              | Details                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:child_process` (execFile), `node:fs/promises`, `node:path`, `node:util` (promisify)             |
| **Starts servers?** | No (manages OS service lifecycle)                                                                     |
| **Shells out?**     | **Yes** — heavily: `launchctl` (macOS), `systemctl` (Linux), `schtasks`/PowerShell (Windows)          |
| **Filesystem?**     | **Yes** — writes plist/unit/script files, reads state dirs                                            |
| **Verdict**         | **CANNOT run in browser** — entirely OS service management (launchd, systemd, Windows Task Scheduler) |

## 20. `src/sessions/` — Sessions

| Aspect              | Details                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Node APIs**       | None in core files                                                                                                                         |
| **Starts servers?** | No                                                                                                                                         |
| **Shells out?**     | No                                                                                                                                         |
| **Filesystem?**     | No (pure in-memory event system in `transcript-events.ts`)                                                                                 |
| **Core design**     | Pure pub/sub event emitter + policy logic                                                                                                  |
| **Verdict**         | **CAN run in browser** — `transcript-events.ts` is a pure in-memory pub/sub; `send-policy.ts`, `session-key-utils.ts`, etc. are pure logic |

## 21. `src/web/` — WhatsApp Web Provider

| Aspect              | Details                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:crypto` (randomUUID), `node:fs` (sync)                                                                  |
| **Starts servers?** | No                                                                                                            |
| **Shells out?**     | No                                                                                                            |
| **Filesystem?**     | **Yes** — manages WhatsApp auth credentials in `~/.text2llm/credentials/`                                     |
| **Key 3rd-party**   | `@whiskeysockets/baileys` (WhatsApp Web client, uses Node.js networking)                                      |
| **Verdict**         | **CANNOT run in browser** — `@whiskeysockets/baileys` uses Node.js sockets, crypto, and persistent auth store |

## 22. `src/discord/` — Discord

| Aspect              | Details                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | None directly in core API layer                                                                                                                    |
| **Starts servers?** | No                                                                                                                                                 |
| **Shells out?**     | No                                                                                                                                                 |
| **Filesystem?**     | Indirectly (token storage, config)                                                                                                                 |
| **Key 3rd-party**   | `discord.js` (uses `ws` internally); API layer uses generic `fetch`                                                                                |
| **Verdict**         | **CAN run with polyfills/adapters** — `api.ts` is pure fetch-based HTTP calls. Gateway/bot monitoring layer uses `discord.js` which requires Node. |

## 23. `src/telegram/` — Telegram

| Aspect              | Details                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | None directly in core files                                                                                                                   |
| **Starts servers?** | Webhook mode starts an HTTP server (via grammy)                                                                                               |
| **Shells out?**     | No                                                                                                                                            |
| **Filesystem?**     | Indirectly (token storage, session store, sticker cache)                                                                                      |
| **Key 3rd-party**   | `grammy` (Telegram Bot API client), `@grammyjs/runner`, `@grammyjs/transformer-throttler`                                                     |
| **Verdict**         | **CAN run with polyfills/adapters** — Telegram Bot API is HTTP-based; `grammy` supports multiple runtimes. Webhook server mode requires Node. |

## 24. `src/slack/` — Slack

| Aspect              | Details                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Node APIs**       | None directly                                                                                                |
| **Starts servers?** | Indirectly (Slack HTTP handler registered on gateway server)                                                 |
| **Shells out?**     | No                                                                                                           |
| **Filesystem?**     | Indirectly (token storage)                                                                                   |
| **Key 3rd-party**   | `@slack/web-api` (WebClient)                                                                                 |
| **Verdict**         | **CAN run with polyfills/adapters** — `@slack/web-api` is HTTP-based; HTTP handler mode requires Node server |

## 25. `src/signal/` — Signal

| Aspect              | Details                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:child_process` (`spawn`), `node:crypto` (`randomUUID`)                                 |
| **Starts servers?** | No (but spawns `signal-cli` which runs an HTTP daemon)                                       |
| **Shells out?**     | **Yes** — spawns `signal-cli` binary as a daemon process                                     |
| **Filesystem?**     | Indirectly                                                                                   |
| **Key 3rd-party**   | None (communicates with signal-cli via HTTP JSON-RPC + SSE)                                  |
| **Verdict**         | **CANNOT run in browser** — requires spawning the `signal-cli` Java binary as a local daemon |

## 26. `src/imessage/` — iMessage

| Aspect              | Details                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| **Node APIs**       | `node:child_process` (`spawn`), `node:readline` (`createInterface`)                |
| **Starts servers?** | No                                                                                 |
| **Shells out?**     | **Yes** — spawns iMessage CLI binary, communicates via stdin/stdout JSON-RPC       |
| **Filesystem?**     | Indirectly                                                                         |
| **Verdict**         | **CANNOT run in browser** — spawns native macOS binary, uses stdio IPC; macOS-only |

## 27. `src/infra/` — Infrastructure

| Aspect              | Details                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:child_process`, `node:fs`, `node:crypto`, `node:path`, `node:net`, `node:os`, `node:url`, `node:util` — effectively **all major Node APIs**                                     |
| **Starts servers?** | Some modules (Bonjour discovery)                                                                                                                                                      |
| **Shells out?**     | **Yes** — `tailscale.ts` (tailscale binary), `binaries.ts` (which), `ssh-tunnel.ts` (ssh), `brew.ts` (brew), system-presence checks                                                   |
| **Filesystem?**     | **Yes** — device identity, auth store, state migrations, dotenv, env-file, json-file, exec approvals, control-ui assets                                                               |
| **Verdict**         | **CANNOT run in browser (as a whole)** — deep OS integration. Some individual modules are portable: `retry.ts`, `backoff.ts`, `errors.ts`, `dedupe.ts`, `format-time/` are pure logic |

## 28. `src/routing/` — Routing

| Aspect              | Details                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| **Node APIs**       | None                                                                                             |
| **Starts servers?** | No                                                                                               |
| **Shells out?**     | No                                                                                               |
| **Filesystem?**     | No                                                                                               |
| **Core design**     | Pure logic: agent route resolution from config + peer/channel info, session key building/parsing |
| **Verdict**         | **CAN run in browser** — pure computation, no I/O dependencies                                   |

## 29. `src/security/` — Security

| Aspect              | Details                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node APIs**       | `node:fs/promises` (`audit-fs.ts`), `node:crypto` (timing-safe equal in `secret-equal.ts`)                                                                                                     |
| **Starts servers?** | No                                                                                                                                                                                             |
| **Shells out?**     | Indirectly (`windows-acl.ts` shells out to `icacls`)                                                                                                                                           |
| **Filesystem?**     | **Yes** — file permission inspection, ACL checking                                                                                                                                             |
| **Verdict**         | **Mixed** — `secret-equal.ts` could use Web Crypto. `audit.ts` and `audit-fs.ts` are **CANNOT** (deep OS filesystem inspection). `external-content.ts` and `skill-scanner.ts` may be portable. |

## 30. `src/plugin-sdk/` — Plugin SDK

| Aspect              | Details                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| **Node APIs**       | None directly (re-exports types and some pure logic)                                             |
| **Starts servers?** | No                                                                                               |
| **Shells out?**     | No                                                                                               |
| **Filesystem?**     | No                                                                                               |
| **Core design**     | Type definitions, channel plugin interfaces, config schemas, Zod validators                      |
| **Verdict**         | **CAN run in browser** — almost entirely type re-exports and schema definitions; pure TypeScript |

## 31. `ui/` — Control UI (Already Browser-Native)

| Aspect          | Details                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| **Node APIs**   | None                                                                                                      |
| **Runtime**     | Browser-native (Vite + Lit web components)                                                                |
| **Connects to** | Gateway WebSocket (browser-native `WebSocket`, not `ws`)                                                  |
| **Crypto**      | `@noble/ed25519` + Web Crypto API (`crypto.subtle`)                                                       |
| **Storage**     | `localStorage` for device identity, auth tokens                                                           |
| **Verdict**     | **CAN run in browser** — already runs in the browser. This is the existing browser client implementation. |

---

## Summary Table

| Module                     | FS     | NET/Server  | CP/Shell | crypto    | os  | path | sqlite     | Verdict                   |
| -------------------------- | ------ | ----------- | -------- | --------- | --- | ---- | ---------- | ------------------------- |
| **gateway/server-http**    | ·      | **HTTP+WS** | ·        | ·         | ·   | ·    | ·          | CANNOT                    |
| **gateway/server.impl**    | ·      | **Yes**     | ·        | ·         | ·   | PATH | ·          | CANNOT                    |
| **gateway/server-startup** | ·      | **Yes**     | **Yes**  | ·         | ·   | ·    | ·          | CANNOT                    |
| **gateway/client**         | FS\*   | ·           | ·        | CRYPTO    | ·   | ·    | ·          | **WITH POLYFILLS**        |
| **agents/runner (run.ts)** | **FS** | ·           | ·        | ·         | ·   | ·    | ·          | **WITH POLYFILLS**        |
| **agents/bash-tools.exec** | ·      | ·           | **CP**   | CRYPTO    | ·   | PATH | ·          | CANNOT                    |
| **agents/sandbox/docker**  | ·      | ·           | **CP**   | ·         | ·   | ·    | ·          | CANNOT                    |
| **agents/sandbox/browser** | ·      | ·           | **CP**   | ·         | ·   | ·    | ·          | CANNOT                    |
| **channels/ (core)**       | ·      | ·           | ·        | ·         | ·   | ·    | ·          | **WITH POLYFILLS**        |
| **media/store**            | **FS** | NET         | ·        | CRYPTO    | ·   | PATH | ·          | CANNOT                    |
| **media/host**             | **FS** | **HTTP**    | ·        | ·         | ·   | ·    | ·          | CANNOT                    |
| **tts/**                   | **FS** | ·           | ·        | ·         | OS  | PATH | ·          | CANNOT                    |
| **browser/**               | **FS** | **HTTP**    | **CP**   | ·         | OS  | PATH | ·          | CANNOT                    |
| **memory/**                | **FS** | ·           | ·        | CRYPTO    | ·   | PATH | **SQLITE** | CANNOT                    |
| **hooks/ (internal)**      | ·      | ·           | ·        | ·         | ·   | ·    | ·          | **CAN**                   |
| **hooks/ (gmail)**         | ·      | ·           | **CP**   | ·         | ·   | ·    | ·          | CANNOT                    |
| **plugins/**               | **FS** | ·           | ·        | ·         | ·   | PATH | ·          | CANNOT                    |
| **config/**                | **FS** | ·           | ·        | CRYPTO    | OS  | PATH | ·          | **WITH POLYFILLS**        |
| **cli/**                   | ·      | ·           | ·        | ·         | ·   | ·    | ·          | CANNOT                    |
| **daemon/**                | **FS** | ·           | **CP**   | ·         | ·   | PATH | ·          | CANNOT                    |
| **sessions/**              | ·      | ·           | ·        | ·         | ·   | ·    | ·          | **CAN**                   |
| **web/ (WhatsApp)**        | **FS** | ·           | ·        | CRYPTO    | ·   | ·    | ·          | CANNOT                    |
| **discord/**               | ·      | ·           | ·        | ·         | ·   | ·    | ·          | **WITH POLYFILLS**        |
| **telegram/**              | ·      | ·           | ·        | ·         | ·   | ·    | ·          | **WITH POLYFILLS**        |
| **slack/**                 | ·      | ·           | ·        | ·         | ·   | ·    | ·          | **WITH POLYFILLS**        |
| **signal/**                | ·      | ·           | **CP**   | CRYPTO    | ·   | ·    | ·          | CANNOT                    |
| **imessage/**              | ·      | ·           | **CP**   | ·         | ·   | ·    | ·          | CANNOT                    |
| **infra/**                 | **FS** | Some        | **CP**   | CRYPTO    | OS  | PATH | ·          | CANNOT (whole)            |
| **routing/**               | ·      | ·           | ·        | ·         | ·   | ·    | ·          | **CAN**                   |
| **security/**              | **FS** | ·           | CP\*     | CRYPTO    | ·   | ·    | ·          | Mixed                     |
| **plugin-sdk/**            | ·      | ·           | ·        | ·         | ·   | ·    | ·          | **CAN**                   |
| **ui/**                    | ·      | ·           | ·        | WebCrypto | ·   | ·    | ·          | **CAN** (already browser) |

---

## Key Findings

### Already Browser-Ready

- **`ui/`** — Full Lit-based control UI, uses native WebSocket, `@noble/ed25519`, `localStorage`
- **`src/routing/`** — Pure computation (session key building, agent route resolution)
- **`src/sessions/`** — Pure event pub/sub
- **`src/plugin-sdk/`** — Type definitions and schema validators
- **`src/hooks/internal-hooks.ts`** — Pure in-memory Map-based event registry

### Portable with Adapters

- **`src/gateway/client.ts`** — Already reimplemented for browser in `ui/src/ui/gateway.ts`; Node version needs `ws` → native `WebSocket`, `node:crypto` → `crypto.getRandomValues()`, device-identity → localStorage
- **`src/channels/` (core routing)** — Mostly pure logic; session persistence needs storage adapter
- **`src/config/` (validation/schema)** — Schema/validation is pure; I/O layer needs adapter
- **`src/discord/api.ts`, `src/telegram/`, `src/slack/`** — HTTP API layers are fetch-based

### Fundamentally Server-Only

- **Gateway server** (`server-http.ts`, `server.impl.ts`) — TCP listeners, WebSocket servers
- **Bash tools / Sandbox** — child_process, Docker CLI
- **Browser automation** — spawns Chrome, Playwright, Express server
- **Memory/RAG** — `node:sqlite` native module, chokidar file watcher
- **TTS** — sync filesystem, `node-edge-tts`
- **Signal / iMessage** — spawn native CLI binaries
- **Daemon** — OS service managers (launchd/systemd/schtasks)
- **Media store/host** — filesystem + HTTP server
- **WhatsApp Web** — Baileys library (Node sockets)

### UI Already Has Browser Equivalents For

| Node module                                  | Browser equivalent in `ui/`                                 |
| -------------------------------------------- | ----------------------------------------------------------- |
| `src/gateway/client.ts` (ws)                 | `ui/src/ui/gateway.ts` (native WebSocket)                   |
| `src/infra/device-identity.ts` (node:crypto) | `ui/src/ui/device-identity.ts` (@noble/ed25519 + WebCrypto) |
| `src/infra/device-auth-store.ts` (fs)        | `ui/src/ui/device-auth.ts` (localStorage)                   |
