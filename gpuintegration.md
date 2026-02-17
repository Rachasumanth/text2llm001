**Implementation Plan**

- Build a unified GPU Inference layer where users:
  - choose a provider,
  - connect credentials,
  - create/select a GPU instance,
  - run AI inference through one consistent API.

**Phase 1: Product Scope (MVP first)**

- MVP providers: Kaggle, Colab, AWS, Azure, Google Cloud, RunPod, Lambda, Self-hosted SSH.
- MVP capabilities:
  - Save and validate credentials
  - List GPU-capable regions and machine types
  - Launch/attach instance
  - Deploy inference runtime container
  - Send inference requests and get responses
  - Start/stop/terminate instance
- Non-goals in MVP: full billing dashboards, auto-scaling clusters, advanced fine-tuning pipelines.

**Phase 1 Status: Completed (text2llm-web MVP)**

- Implemented backend API in `workspace/text2llm-web/server.mjs`:
  - `GET /api/instances/gpu/providers`
  - `POST /api/instances/gpu/provider/configure`
  - `GET /api/instances/gpu/instances`
  - `POST /api/instances/gpu/instance/launch`
  - `POST /api/instances/gpu/instance/action`
  - `POST /api/instances/gpu/inference`
- Implemented GPU tab UX in `workspace/text2llm-web/public/index.html` + `workspace/text2llm-web/public/app.js`:
  - provider selection
  - dynamic credential forms from provider schema
  - region/GPU-type launch form
  - instance list with start/stop/terminate actions
  - inference test panel against running instance
- Implemented Phase 1 UI styling in `workspace/text2llm-web/public/styles.css`.
- Persisted provider credentials and instance records under workspace config (`text2llm.json`) in `gpu.providers` and `gpu.instances`.
- Current inference call is a Phase 1 compatibility response path (simulated output) to validate provider->instance->inference UX flow end-to-end.

**Phase 2: Core Architecture**

- Create a provider adapter interface with standard methods:
  - validateCredentials
  - listRegions
  - listGpuTypes
  - createInstance
  - getInstanceStatus
  - startInstance / stopInstance / terminateInstance
  - deployRuntime
  - runInference
- Implement one adapter per provider so UI/backend stays provider-agnostic.
- Add a routing service that maps project -> selected provider instance -> inference endpoint.

**Phase 2 Status: Completed (adapter architecture + routing service)**

- Added adapter module `workspace/text2llm-web/gpu-phase2.mjs` with provider-agnostic contract methods:
  - `validateCredentials`
  - `listRegions`
  - `listGpuTypes`
  - `createInstance`
  - `getInstanceStatus`
  - `startInstance` / `stopInstance` / `terminateInstance`
  - `deployRuntime`
  - `runInference`
- Implemented one adapter instance per provider via `createGpuAdapterRegistry()`.
- Added routing service via `createGpuRoutingService()` with project-to-instance mapping support.
- Refactored `workspace/text2llm-web/server.mjs` GPU APIs to use the adapter layer rather than provider-specific branching.
- Added Phase 2 routing/capability endpoints:
  - `GET /api/instances/gpu/provider/:providerId/capabilities`
  - `GET /api/instances/gpu/routing?projectId=...`
  - `POST /api/instances/gpu/routing` (`projectId`, `instanceId`)
- Updated inference endpoint to support routed resolution (`projectId`) plus explicit override (`instanceId`) and return `routedInstanceId`.

**Phase 3: Data Model**

- ProviderAccount: user, provider, encrypted credential reference, status, last validation time.
- GpuInstance: provider, region, gpu type/count, cpu/ram/disk, state, endpoint URL, health.
- InferenceProfile: model, container image, env vars, ports, scaling mode.
- InferenceRequestLog: latency, tokens/input size, cost estimate, error codes.
- BudgetPolicy: hard spend cap, auto-stop idle minutes, alert thresholds.

**Phase 3 Status: Completed (data model + management APIs)**

- Added persistent data model fields in `workspace/text2llm-web/gpu-phase2.mjs` config shape:
  - `gpu.providerAccounts`
  - `gpu.inferenceProfiles`
  - `gpu.inferenceRequestLogs`
  - `gpu.budgetPolicies`
  - `gpu.kms`
- Extended `GpuInstance` normalization to include:
  - `cpuCores`, `memoryGb`, `diskGb`
  - `health`, `lastHealthCheckAt`
  - `inferenceProfileId`, `budgetPolicyId`
- Added Phase 3 server capabilities in `workspace/text2llm-web/server.mjs`:
  - default inference profile creation on launch
  - default budget policy creation/update
  - inference request log persistence (latency/tokens/cost/error fields)
  - budget-cap check before inference execution
- Added management endpoints:
  - `GET /api/instances/gpu/inference-profiles`
  - `POST /api/instances/gpu/inference-profiles`
  - `GET /api/instances/gpu/budget-policy`
  - `POST /api/instances/gpu/budget-policy`
  - `GET /api/instances/gpu/inference/logs`

**Phase 4: Credentials & Security**

- Store secrets encrypted at rest with envelope encryption (KMS/Key Vault/Cloud KMS).
- Never return raw credentials to frontend after save.
- Use short-lived tokens where possible; avoid long-lived root credentials.
- Add scoped permission checks per provider (least privilege templates).
- Add credential test button: verifies API reachability + required permissions.

**Phase 4 Status: Completed (secure credential handling + verification UX)**

- Replaced plaintext provider credential storage with encrypted provider accounts:
  - credentials are envelope-encrypted at rest
  - per-account `credentialRef` stores encrypted payload + wrapped DEK metadata
  - KMS metadata (`kmsProvider`, `keyId`) tracked in records
- Added secure credential account model (`ProviderAccount`) with:
  - `status`, `lastValidatedAt`, `permissions`, `tokenPolicy`
  - no raw credentials returned in API responses
- Added least-privilege permission templates and token guidance per provider in `workspace/text2llm-web/gpu-phase2.mjs`.
- Added credential verification endpoint:
  - `POST /api/instances/gpu/provider/test`
  - validates credentials, checks reachability, verifies required permissions
- Updated GPU provider API output to expose credential health (without secrets).
- Added UI credential test button and workflow in `workspace/text2llm-web/public/index.html` + `workspace/text2llm-web/public/app.js`.

**Phase 5: UX Flow**

- Instances page flow:
  - Step 1: Select provider
  - Step 2: Fill provider-specific credential form
  - Step 3: Validate credentials
  - Step 4: Pick region + GPU type + runtime template
  - Step 5: Launch/attach instance
  - Step 6: Test inference
- Dynamic forms from provider schema (field types, required flags, help text, examples).
- Show readiness states: Not connected, Credentials valid, Instance provisioning, Ready, Error.

**Phase 5 Status: Completed (step-based GPU UX + readiness states)**

- GPU tab flow now supports:
  - Step 1: Provider select
  - Step 2: Credential form fill
  - Step 3: Credential validation (`Test Credentials`)
  - Step 4: Region/GPU/runtime launch
  - Step 5: Launch/attach instance
  - Step 6: Inference test
- Dynamic credential forms remain schema-driven from provider `authFields`.
- Added explicit readiness state indicator in UI:
  - `Not connected`
  - `Credentials valid`
  - `Instance provisioning`
  - `Ready`
  - `Error`
- Updated instance list badges to surface provisioning/ready/error lifecycle states.

**Phase 6: Inference Runtime**

- Standard runtime contract for all providers:
  - health endpoint
  - inference endpoint
  - model preload hook
  - structured error format
- Provide base runtime images for common stacks (vLLM, TGI, Ollama-compatible, custom container).
- Add warm-up + health checks before marking instance as Ready.

**Phase 6 Status: Completed (runtime contract + warmup/health checks)**

- Added standard runtime contract support in `workspace/text2llm-web/gpu-phase2.mjs`:
  - health endpoint path
  - inference endpoint path
  - model preload hook path
  - structured runtime error schema (`code`, `message`, `details`, `retriable`)
- Added base runtime templates:
  - vLLM
  - TGI
  - Ollama-compatible
  - Custom container
- Added warm-up flow before ready state via adapter runtime warmup checks.
- Added runtime health probe endpoint in server:
  - `GET /api/instances/gpu/instance/:instanceId/health`
- Added runtime template discovery endpoint:
  - `GET /api/instances/gpu/runtime/templates`
- Updated inference API to support structured runtime error responses and log runtime error codes.

**Phase 7: Reliability & Cost Controls**

- Idle auto-shutdown and scheduled stop windows.
- Retry strategy for transient provider/API failures.
- Circuit breaker for unhealthy instance endpoints.
- Per-request timeout, queueing, and fallback option (secondary instance/provider).
- Cost guardrails: budget cap enforcement and pre-launch cost estimate.

**Phase 7 Status: Completed (reliability controls + guardrails)**

- Implemented idle auto-shutdown using budget policy `autoStopIdleMinutes` with automatic stop transitions.
- Added scheduled stop window enforcement (`budgetPolicy.stopWindows`) for launch/start/inference gating.
- Added retry strategy for transient inference failures with configurable backoff (`gpu.reliability.retryPolicy`).
- Added per-instance circuit breaker state (`gpu.circuitBreakers`) with open/half-open/closed behavior.
- Added per-request timeout and per-instance queue depth limiting (`gpu.reliability.inferenceTimeoutMs`, `maxQueueDepthPerInstance`).
- Added fallback routing support via `gpu.fallbackRoutes` and API endpoints for project-level secondary instance selection.
- Added pre-launch hourly cost estimation and budget-cap guardrail checks before instance launch.

**Phase 8: Observability**

- Track provisioning success rate, time-to-ready, inference latency, failure rate, and estimated spend.
- Provider-level error taxonomy (auth, quota, capacity, network, runtime).
- Add audit logs for credential updates, instance lifecycle actions, and inference routing changes.

**Phase 8 Status: Completed (metrics, taxonomy, auditability)**

- Added observability metrics store under `gpu.observability.metrics` with:
  - provisioning attempts/success/failure
  - time-to-ready aggregation
  - inference totals/failures/latency
  - estimated spend accumulation
- Added provider-level error taxonomy tracking (`auth`, `quota`, `capacity`, `network`, `runtime`).
- Added structured audit log stream under `gpu.auditLogs` covering:
  - credential updates
  - instance launch/action/auto-stop events
  - routing and fallback changes
  - inference success/failure and fallback attempts
- Added monitoring endpoints:
  - `GET /api/instances/gpu/observability`
  - `GET /api/instances/gpu/audit-logs`
  - `GET/POST /api/instances/gpu/reliability`
  - `GET/POST /api/instances/gpu/fallback-route`

**Phase 9: Testing**

- Unit tests for adapter contract compliance.
- Integration tests with provider mocks/sandboxes.
- End-to-end test: select provider -> save creds -> launch -> infer -> stop.
- Security tests: secret redaction, authz boundaries, injection-safe logging.

**Phase 9 Status: Completed (strict automated coverage)**

- Added strict executable test suites under `workspace/text2llm-web/test/`:
  - `unit.adapter-contract.test.mjs` (adapter contract compliance)
  - `integration.gpu-provider-sandbox.test.mjs` (provider integration sandbox checks)
  - `e2e.gpu-flow.test.mjs` (configure -> launch -> route -> infer -> stop)
  - `security.gpu-secrets-authz.test.mjs` (secret redaction/encryption + authz boundaries)
- Added deterministic test helpers in `workspace/text2llm-web/test/helpers.mjs`:
  - isolated temp config per test run
  - isolated dynamic test server ports
  - clean startup/shutdown and API assertion utilities
- Added strict test scripts in `workspace/text2llm-web/package.json`:
  - `npm run test:phase9`
  - `npm run test:strict`

**Phase 10: Rollout Plan**

- Milestone 1: Adapter framework + AWS/GCP/Azure + generic runtime.
- Milestone 2: Colab/Kaggle/RunPod/Lambda + improved form schemas.
- Milestone 3: Budget controls, fallback routing, observability dashboards.
- Milestone 4: More providers and enterprise features (SSO, policy packs).

**Phase 10 Status: Completed (strict rollout state + gate controls)**

- Added rollout state persistence in config (`gpu.rollout`) with milestone and gate tracking.
- Added rollout status APIs in `workspace/text2llm-web/server.mjs`:
  - `GET /api/instances/gpu/rollout/status`
  - `POST /api/instances/gpu/rollout/status`
- Added strict rollout gate test `workspace/text2llm-web/test/rollout.phase10-gates.test.mjs`.
- Added dedicated script:
  - `npm run test:phase10`
- Phase 10 is now controlled by executable milestone/gate states rather than docs-only checklists.

**Acceptance Criteria**

- User can connect at least one provider and successfully validate credentials.
- User can launch one GPU instance and run inference end-to-end.
- System can stop/terminate instance and persist usage logs.
- Secrets remain encrypted and never exposed in plaintext UI/API responses.
