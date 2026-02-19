import express from "express";
import { Readable } from "node:stream";

function nowMs() {
  return Date.now();
}

function parseBooleanEnv(value, fallback = false) {
  if (value == null) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseIntEnv(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildProviderConfig() {
  const openAiChat =
    process.env.PROXY_PROVIDER_OPENAI_CHAT_URL?.trim() ||
    "https://api.openai.com/v1/chat/completions";
  const openAiEmbeddings =
    process.env.PROXY_PROVIDER_OPENAI_EMBEDDINGS_URL?.trim() ||
    "https://api.openai.com/v1/embeddings";

  return {
    openai: {
      chatUrl: openAiChat,
      embeddingsUrl: openAiEmbeddings,
      buildHeaders: (apiKey) => ({
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      }),
    },
    openrouter: {
      chatUrl:
        process.env.PROXY_PROVIDER_OPENROUTER_CHAT_URL?.trim() ||
        "https://openrouter.ai/api/v1/chat/completions",
      embeddingsUrl: process.env.PROXY_PROVIDER_OPENROUTER_EMBEDDINGS_URL?.trim() || "",
      buildHeaders: (apiKey) => ({
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      }),
    },
    anthropic: {
      chatUrl: process.env.PROXY_PROVIDER_ANTHROPIC_CHAT_URL?.trim() || "",
      embeddingsUrl: "",
      buildHeaders: (apiKey) => ({
        "x-api-key": apiKey,
        "anthropic-version": process.env.PROXY_ANTHROPIC_VERSION?.trim() || "2023-06-01",
        "Content-Type": "application/json",
      }),
    },
    google: {
      chatUrl: process.env.PROXY_PROVIDER_GOOGLE_CHAT_URL?.trim() || "",
      embeddingsUrl: process.env.PROXY_PROVIDER_GOOGLE_EMBEDDINGS_URL?.trim() || "",
      buildHeaders: (apiKey) => ({
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      }),
    },
  };
}

function getProviderFromRequest(req) {
  const raw = req.header("x-provider")?.trim().toLowerCase();
  return raw || "openai";
}

function estimateInputTokens(payload) {
  try {
    if (!payload || typeof payload !== "object") {
      return 0;
    }
    const bodyText = JSON.stringify(payload);
    return Math.max(1, Math.round(bodyText.length / 4));
  } catch {
    return 0;
  }
}

function getRateLimitState() {
  return {
    perMinute: new Map(),
    perDayTokens: new Map(),
  };
}

function getDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function consumeRateLimit(state, userId, requestCost, limits) {
  const current = nowMs();
  const minuteWindowStart = current - 60_000;
  const dayKey = getDayKey();

  const minuteEntries = state.perMinute.get(userId) ?? [];
  const trimmedMinute = minuteEntries.filter((timestamp) => timestamp > minuteWindowStart);
  if (trimmedMinute.length >= limits.requestsPerMinute) {
    return {
      ok: false,
      reason: "rate_limit",
      retryAfterSec: Math.max(1, Math.ceil((trimmedMinute[0] + 60_000 - current) / 1000)),
    };
  }

  const dayBucket = state.perDayTokens.get(userId) ?? { dayKey, tokens: 0 };
  const normalizedDayBucket = dayBucket.dayKey === dayKey ? dayBucket : { dayKey, tokens: 0 };
  const projectedTokens = normalizedDayBucket.tokens + requestCost;
  if (projectedTokens > limits.tokensPerDay) {
    return {
      ok: false,
      reason: "token_quota",
      retryAfterSec: 86_400,
    };
  }

  trimmedMinute.push(current);
  state.perMinute.set(userId, trimmedMinute);
  state.perDayTokens.set(userId, { dayKey, tokens: projectedTokens });
  return { ok: true };
}

async function validateSupabaseUser(req) {
  if (parseBooleanEnv(process.env.PROXY_SKIP_AUTH, false)) {
    return {
      ok: true,
      userId: req.header("x-user-id")?.trim() || "local-dev-user",
    };
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim();
  const authHeader = req.header("authorization")?.trim() || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return { ok: false, status: 500, message: "missing_supabase_env" };
  }
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, message: "missing_bearer_token" };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { ok: false, status: 401, message: "missing_bearer_token" };
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return { ok: false, status: 401, message: "invalid_token" };
  }

  const profile = await response.json();
  const userId = typeof profile?.id === "string" ? profile.id : "";
  if (!userId) {
    return { ok: false, status: 401, message: "invalid_user" };
  }

  return { ok: true, userId };
}

async function logUsageEvent(event) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRole) {
    return;
  }

  try {
    await fetch(`${supabaseUrl}/rest/v1/usage_events`, {
      method: "POST",
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(event),
    });
  } catch {
    // Non-blocking telemetry
  }
}

function applyCors(req, res) {
  const allowOrigin = process.env.PROXY_ALLOWED_ORIGIN?.trim() || "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Headers", "authorization,content-type,x-provider,x-provider-key,x-user-id");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

async function proxyToProvider({ providerName, apiKey, route, payload, req, res, userId }) {
  const providers = buildProviderConfig();
  const provider = providers[providerName];

  if (!provider) {
    res.status(400).json({ error: `unsupported_provider:${providerName}` });
    return;
  }

  const disabledFlag = `PROXY_DISABLE_${providerName.toUpperCase()}`;
  if (parseBooleanEnv(process.env[disabledFlag], false)) {
    res.status(503).json({ error: `provider_disabled:${providerName}` });
    return;
  }

  const targetUrl = route === "chat" ? provider.chatUrl : provider.embeddingsUrl;
  if (!targetUrl) {
    res.status(400).json({ error: `provider_route_not_configured:${providerName}:${route}` });
    return;
  }

  const upstream = await fetch(targetUrl, {
    method: "POST",
    headers: provider.buildHeaders(apiKey),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(parseIntEnv(process.env.PROXY_UPSTREAM_TIMEOUT_MS, 120_000)),
  });

  const requestTokens = estimateInputTokens(payload);
  const startedAt = nowMs();

  if (!upstream.ok) {
    const text = await upstream.text();
    res.status(upstream.status).send(text || "upstream_error");
    void logUsageEvent({
      user_id: userId,
      route: "proxy",
      provider: providerName,
      model: typeof payload?.model === "string" ? payload.model : null,
      input_tokens: requestTokens,
      output_tokens: null,
      latency_ms: nowMs() - startedAt,
      cost_usd: null,
      error: `upstream_${upstream.status}`,
    });
    return;
  }

  const contentType = upstream.headers.get("content-type") || "application/json";
  if (contentType.includes("text/event-stream") || payload?.stream === true) {
    res.status(upstream.status);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    if (!upstream.body) {
      res.end();
      return;
    }
    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.pipe(res);

    nodeStream.on("end", () => {
      void logUsageEvent({
        user_id: userId,
        route: "proxy",
        provider: providerName,
        model: typeof payload?.model === "string" ? payload.model : null,
        input_tokens: requestTokens,
        output_tokens: null,
        latency_ms: nowMs() - startedAt,
        cost_usd: null,
        error: null,
      });
    });
    nodeStream.on("error", () => {
      void logUsageEvent({
        user_id: userId,
        route: "proxy",
        provider: providerName,
        model: typeof payload?.model === "string" ? payload.model : null,
        input_tokens: requestTokens,
        output_tokens: null,
        latency_ms: nowMs() - startedAt,
        cost_usd: null,
        error: "stream_error",
      });
    });
    return;
  }

  const json = await upstream.json();
  const outputTokens = Number(json?.usage?.completion_tokens ?? json?.usage?.output_tokens ?? 0) || null;
  res.status(upstream.status).json(json);

  void logUsageEvent({
    user_id: userId,
    route: "proxy",
    provider: providerName,
    model: typeof payload?.model === "string" ? payload.model : null,
    input_tokens: requestTokens,
    output_tokens: outputTokens,
    latency_ms: nowMs() - startedAt,
    cost_usd: null,
    error: null,
  });
}

export function createProxyApp() {
  const app = express();
  const bodyLimit = process.env.PROXY_BODY_LIMIT?.trim() || "128kb";
  const rateState = getRateLimitState();

  app.use(express.json({ limit: bodyLimit }));

  app.use((req, res, next) => {
    if (applyCors(req, res)) {
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "text2llm-web-proxy",
      time: new Date().toISOString(),
      authMode: parseBooleanEnv(process.env.PROXY_SKIP_AUTH, false) ? "dev-bypass" : "supabase",
    });
  });

  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      service: "text2llm-web-proxy",
      message: "Service is running. Use /health for status.",
      endpoints: ["/health", "/v1/proxy/chat/completions", "/v1/proxy/embeddings"],
    });
  });

  app.post("/v1/proxy/chat/completions", async (req, res) => {
    try {
      if (!parseBooleanEnv(process.env.PROXY_ENABLED, true)) {
        res.status(503).json({ error: "proxy_disabled" });
        return;
      }

      const auth = await validateSupabaseUser(req);
      if (!auth.ok) {
        res.status(auth.status).json({ error: auth.message });
        return;
      }

      const provider = getProviderFromRequest(req);
      const providerKey = req.header("x-provider-key")?.trim();
      if (!providerKey) {
        res.status(400).json({ error: "missing_x_provider_key" });
        return;
      }
      if (!req.body || typeof req.body !== "object") {
        res.status(400).json({ error: "invalid_json_body" });
        return;
      }

      const limits = {
        requestsPerMinute: parseIntEnv(process.env.PROXY_RATE_LIMIT_RPM, 20),
        tokensPerDay: parseIntEnv(process.env.PROXY_DAILY_TOKEN_CAP, 100_000),
      };
      const inputTokens = estimateInputTokens(req.body);
      const quota = consumeRateLimit(rateState, auth.userId, inputTokens, limits);
      if (!quota.ok) {
        res.setHeader("Retry-After", String(quota.retryAfterSec));
        res.status(429).json({ error: quota.reason });
        return;
      }

      await proxyToProvider({
        providerName: provider,
        apiKey: providerKey,
        route: "chat",
        payload: req.body,
        req,
        res,
        userId: auth.userId,
      });
    } catch (error) {
      res.status(500).json({
        error: "proxy_internal_error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/v1/proxy/embeddings", async (req, res) => {
    try {
      if (!parseBooleanEnv(process.env.PROXY_ENABLED, true)) {
        res.status(503).json({ error: "proxy_disabled" });
        return;
      }

      const auth = await validateSupabaseUser(req);
      if (!auth.ok) {
        res.status(auth.status).json({ error: auth.message });
        return;
      }

      const provider = getProviderFromRequest(req);
      const providerKey = req.header("x-provider-key")?.trim();
      if (!providerKey) {
        res.status(400).json({ error: "missing_x_provider_key" });
        return;
      }

      await proxyToProvider({
        providerName: provider,
        apiKey: providerKey,
        route: "embeddings",
        payload: req.body,
        req,
        res,
        userId: auth.userId,
      });
    } catch (error) {
      res.status(500).json({
        error: "proxy_internal_error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return app;
}

function resolvePort() {
  const candidates = [process.env.PORT, process.env.TEXT2LLM_WEB_PROXY_PORT, "8790"];
  for (const candidate of candidates) {
    const parsed = Number.parseInt(String(candidate ?? ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 8790;
}

export function startProxyServer(port = resolvePort()) {
  const app = createProxyApp();
  const host = process.env.TEXT2LLM_WEB_PROXY_HOST?.trim() || "0.0.0.0";
  const server = app.listen(port, host, () => {
    console.log(`[text2llm-web-proxy] listening on :${port}`);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startProxyServer();
}
