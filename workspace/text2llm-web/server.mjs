import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { WebSocketServer } from "ws";
import {
  createGpuAdapterRegistry,
  createGpuRoutingService,
  ensureGpuConfigShape,
  normalizeGpuInstance,
  normalizeProviderAccount,
} from "./gpu-phase2.mjs";

// Using child_process instead of node-pty to avoid native addon issues

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.TEXT2LLM_WEB_PORT ? Number(process.env.TEXT2LLM_WEB_PORT) : 8787;
const repoRoot = path.resolve(__dirname, "..", "..");
const workspaceConfig = (() => {
  const configuredPath = process.env.TEXT2LLM_CONFIG_PATH;
  if (!configuredPath || !configuredPath.trim()) {
    return path.resolve(repoRoot, "workspace", "text2llm.json");
  }

  if (path.isAbsolute(configuredPath)) {
    return path.resolve(configuredPath);
  }

  return path.resolve(repoRoot, configuredPath);
})();

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

function buildPrompt(payload) {
  const {
    goal,
    modelSize,
    domain,
    budgetUsd,
    contextWindow,
  } = payload;

  return [
    "You are Text2LLM. Build from scratch, not just finetune.",
    `Goal: ${goal || "Build a production-ready LLM"}`,
    `Target size: ${modelSize || "100M"}`,
    `Domain: ${domain || "general"}`,
    `Context window: ${contextWindow || "4096"}`,
    `Budget (USD): ${budgetUsd || "100"}`,
    "Return a concrete plan with: data, tokenizer, architecture, train, eval, publish.",
    "Include cost estimate + explicit spend checkpoints.",
  ].join("\n");
}

function runTEXT2LLMAgent(message) {
  return new Promise((resolve, reject) => {
    const args = [
      "scripts/run-node.mjs",
      "agent",
      "--agent",
      "main",
      "--message",
      message,
    ];

    const env = {
      ...process.env,
      TEXT2LLM_CONFIG_PATH: process.env.TEXT2LLM_CONFIG_PATH || workspaceConfig,
      RUNPOD_API_KEY: process.env.RUNPOD_API_KEY || "text2llm-web-local",
      VAST_API_KEY: process.env.VAST_API_KEY || "text2llm-web-local",
      WANDB_API_KEY: process.env.WANDB_API_KEY || "text2llm-web-local",
      HF_TOKEN: process.env.HF_TOKEN || "text2llm-web-local",
    };

    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env,
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function runTEXT2LLMCommand(args, extraEnv = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      TEXT2LLM_CONFIG_PATH: process.env.TEXT2LLM_CONFIG_PATH || workspaceConfig,
      RUNPOD_API_KEY: process.env.RUNPOD_API_KEY || "text2llm-web-local",
      VAST_API_KEY: process.env.VAST_API_KEY || "text2llm-web-local",
      WANDB_API_KEY: process.env.WANDB_API_KEY || "text2llm-web-local",
      HF_TOKEN: process.env.HF_TOKEN || "text2llm-web-local",
      ...extraEnv,
    };

    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env,
      shell: false,
      stdio: options.ttyStdin ? ["inherit", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function loadWorkspaceConfig() {
  try {
    const raw = await readFile(workspaceConfig, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveWorkspaceConfig(config) {
  await writeFile(workspaceConfig, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function ensurePluginEnabled(config, pluginId) {
  const next = { ...config };
  next.plugins = next.plugins && typeof next.plugins === "object" ? { ...next.plugins } : {};
  next.plugins.entries =
    next.plugins.entries && typeof next.plugins.entries === "object"
      ? { ...next.plugins.entries }
      : {};

  const existing = next.plugins.entries[pluginId];
  next.plugins.entries[pluginId] =
    existing && typeof existing === "object" ? { ...existing, enabled: true } : { enabled: true };

  return next;
}

function normalizeProviderId(value) {
  return String(value || "").trim().toLowerCase();
}

function isOAuthProviderConfigured(config, providerId) {
  const normalized = normalizeProviderId(providerId);
  if (!normalized) {
    return false;
  }

  const profiles = config?.auth?.profiles;
  if (!profiles || typeof profiles !== "object") {
    return false;
  }

  for (const profile of Object.values(profiles)) {
    if (!profile || typeof profile !== "object") {
      continue;
    }

    const provider = normalizeProviderId(profile.provider);
    const mode = normalizeProviderId(profile.mode);
    if (provider === normalized && (mode === "oauth" || mode === "token")) {
      return true;
    }
  }

  return false;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    configPath: process.env.TEXT2LLM_CONFIG_PATH || workspaceConfig,
  });
});

app.post("/api/plan", async (req, res) => {
  try {
    const prompt = buildPrompt(req.body || {});
    const result = await runTEXT2LLMAgent(prompt);

    if (result.code !== 0) {
      return res.status(500).json({
        ok: false,
        error: "Text2LLM execution failed",
        details: (result.stderr || result.stdout || "").trim(),
      });
    }

    res.json({
      ok: true,
      prompt,
      output: result.stdout.trim(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});


// ── Provider Definitions ──
const AI_PROVIDERS = [
  { 
    id: "anthropic", 
    name: "Anthropic", 
    description: "Claude 4, Sonnet, Haiku", 
    icon: "/logos/arthopode.png",
    options: [
      { id: "api", name: "Anthropic API Key", envKey: "ANTHROPIC_API_KEY", type: "password" }
    ]
  },
  { 
    id: "openai", 
    name: "OpenAI", 
    description: "GPT-4o, o3, o4-mini", 
    icon: "/logos/openai.png",
    options: [
      { id: "api", name: "OpenAI API Key", envKey: "OPENAI_API_KEY", type: "password" },
      { id: "codex", name: "Codex OAuth (CLI)", envKey: "OPENAI_CODEX_TOKEN", type: "oauth", oauthProviderId: "openai-codex" }
    ]
  },
  { 
    id: "google", 
    name: "Google Gemini", 
    description: "Gemini 2.5 Pro & Flash", 
    icon: "/logos/gemini.png",
    options: [
      { id: "api", name: "Gemini API Key", envKey: "GEMINI_API_KEY", type: "password" },
      { id: "antigravity", name: "Antigravity OAuth", envKey: "GOOGLE_ANTIGRAVITY_TOKEN", type: "oauth", oauthProviderId: "google-antigravity" },
      { id: "cli", name: "Gemini CLI OAuth", envKey: "GOOGLE_GEMINI_CLI_TOKEN", type: "oauth", oauthProviderId: "google-gemini-cli" }
    ]
  },
  { 
    id: "openrouter", 
    name: "OpenRouter", 
    description: "Multi-provider gateway", 
    icon: "/logos/openrouter.png",
    options: [
      { id: "api", name: "OpenRouter API Key", envKey: "OPENROUTER_API_KEY", type: "password" }
    ]
  },
  { 
    id: "groq", 
    name: "Groq", 
    description: "Ultra-fast inference", 
    icon: "/logos/groq.png",
    options: [
      { id: "api", name: "Groq API Key", envKey: "GROQ_API_KEY", type: "password" }
    ]
  },
  { 
    id: "xai", 
    name: "xAI", 
    description: "Grok models", 
    icon: "/logos/xai.png",
    options: [
      { id: "api", name: "xAI API Key", envKey: "XAI_API_KEY", type: "password" }
    ]
  },
  { 
    id: "mistral", 
    name: "Mistral", 
    description: "Mistral & Codestral", 
    icon: "/logos/mistral.png",
    options: [
      { id: "api", name: "Mistral API Key", envKey: "MISTRAL_API_KEY", type: "password" }
    ]
  },
  { 
    id: "github-copilot", 
    name: "GitHub Copilot", 
    description: "Copilot-powered models", 
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.47 2 2 6.47 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02a9.68 9.68 0 0 1 2.5-.34c.85.01 1.7.11 2.5.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85v2.74c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z"/></svg>`,
    options: [
      { id: "token", name: "Copilot Token", envKey: "GITHUB_TOKEN", type: "password" }
    ]
  },
  { 
    id: "amazon-bedrock", 
    name: "Amazon Bedrock", 
    description: "Claude via AWS", 
    icon: "/logos/amazonbedrock.png",
    options: [
      { id: "profile", name: "AWS Profile", envKey: "AWS_PROFILE", type: "text" }
    ]
  },
  { 
    id: "ollama", 
    name: "Ollama", 
    description: "Local self-hosted models", 
    icon: "/logos/ollama.png",
    options: [
      { id: "api", name: "Ollama API Key", envKey: "OLLAMA_API_KEY", type: "password" }
    ]
  },
  { 
    id: "together", 
    name: "Together AI", 
    description: "Open-source model hosting", 
    icon: "/logos/togetherai.png",
    options: [
      { id: "api", name: "Together API Key", envKey: "TOGETHER_API_KEY", type: "password" }
    ]
  },
  { 
    id: "cerebras", 
    name: "Cerebras", 
    description: "Fastest inference chip", 
    icon: "/logos/cerebras.png",
    options: [
      { id: "api", name: "Cerebras API Key", envKey: "CEREBRAS_API_KEY", type: "password" }
    ]
  },
  { 
    id: "minimax", 
    name: "MiniMax", 
    description: "MiniMax M2 models", 
    icon: "/logos/minimax.png",
    options: [
      { id: "api", name: "MiniMax API Key", envKey: "MINIMAX_API_KEY", type: "password" },
      { id: "hosted", name: "Hosted", envKey: "MINIMAX_HOSTED_TOKEN", type: "password" }
    ]
  },
  { 
    id: "moonshot", 
    name: "Moonshot", 
    description: "Kimi K2.5", 
    icon: "/logos/moonshot.png",
    options: [
      { id: "api", name: "Moonshot API Key", envKey: "MOONSHOT_API_KEY", type: "password" }
    ]
  },
  { 
    id: "qwen-portal", 
    name: "Qwen", 
    description: "Qwen Coder & Vision", 
    icon: "/logos/qwen.png",
    options: [
      { id: "api", name: "Qwen API Key", envKey: "QWEN_PORTAL_API_KEY", type: "password" }
    ]
  },
  { 
    id: "venice", 
    name: "Venice", 
    description: "Privacy-first AI", 
    icon: "/logos/venice.png",
    options: [
      { id: "api", name: "Venice API Key", envKey: "VENICE_API_KEY", type: "password" }
    ]
  },
  { 
    id: "qianfan", 
    name: "Qianfan (Baidu)", 
    description: "ERNIE & DeepSeek", 
    icon: "/logos/deepseek.png",
    options: [
      { id: "api", name: "Qianfan API Key", envKey: "QIANFAN_API_KEY", type: "password" }
    ]
  },
  {
    id: "zai",
    name: "Z.AI",
    description: "GLM 4.7 / 5 Models",
    icon: "/logos/z.png",
    options: [
      { id: "api", name: "Z.AI API Key", envKey: "ZAI_API_KEY", type: "password" }
    ]
  },
  {
    id: "vercel",
    name: "Vercel AI Gateway",
    description: "Unified AI interface",
    icon: "/logos/vercel.png",
    options: [
      { id: "api", name: "Vercel API Key", envKey: "VERCEL_AI_GATEWAY_API_KEY", type: "password" }
    ]
  },
  {
    id: "cloudflare",
    name: "Cloudflare AI Gateway",
    description: "Edge AI proxy",
    icon: "/logos/cloudflare.png",
    options: [
      { id: "api", name: "Cloudflare API Key", envKey: "CLOUDFLARE_API_KEY", type: "password" }
    ]
  },
  {
    id: "opencode-zen",
    name: "OpenCode Zen",
    description: "Code generation suite",
    icon: "/logos/opencode.png",
    options: [
      { id: "api", name: "OpenCode API Key", envKey: "OPENCODE_ZEN_API_KEY", type: "password" }
    ]
  },
  {
    id: "xiaomi",
    name: "Xiaomi",
    description: "MiLM & AI Chat",
    icon: "/logos/xiaomi.png",
    options: [
      { id: "api", name: "Xiaomi API Key", envKey: "XIAOMI_API_KEY", type: "password" }
    ]
  },
  {
    id: "synthetic",
    name: "Synthetic",
    description: "Generated test models",
    icon: "/logos/synthetic.png",
    options: [
      { id: "api", name: "Synthetic API Key", envKey: "SYNTHETIC_API_KEY", type: "password" }
    ]
  }
];


const PROJECTS_FILE = path.resolve(repoRoot, "workspace", "projects.json");
const PROJECTS_DIR = path.resolve(repoRoot, "workspace", "projects");

// ── Per-project user.md memory ──
async function getProjectMemoryPath(projectId) {
  const safeId = String(projectId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = path.join(PROJECTS_DIR, safeId);
  await mkdir(dir, { recursive: true });
  return path.join(dir, "user.md");
}

async function loadProjectMemory(projectId) {
  try {
    const memPath = await getProjectMemoryPath(projectId);
    return await readFile(memPath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return "";
    throw err;
  }
}

async function saveProjectMemory(projectId, content) {
  const memPath = await getProjectMemoryPath(projectId);
  await writeFile(memPath, String(content || ""), "utf-8");
}

function sanitizeProjectMemoryForPrompt(rawMemory) {
  const text = String(rawMemory || "").trim();
  if (!text) {
    return "";
  }

  const blockedPatterns = [
    /i got your message\.?/i,
    /project memory \(`?user\.md`?\)/i,
    /connect at least one direct model api key/i,
    /until then, i[’']ll keep replies concise/i,
  ];

  const sections = text
    .split(/\n(?=###\s+\d{4}-\d{2}-\d{2})/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const cleanedSections = sections.filter((section) => {
    const normalized = section.replace(/\s+/g, " ").trim();
    return !blockedPatterns.some((pattern) => pattern.test(normalized));
  });

  const deduped = [];
  const seen = new Set();
  for (const section of cleanedSections) {
    const signature = section.replace(/\s+/g, " ").trim().toLowerCase();
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    deduped.push(section);
  }

  const recent = deduped.slice(-20);
  return recent.join("\n\n");
}

async function loadProjects() {
  try {
    const data = await readFile(PROJECTS_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      // Return default if file doesn't exist
      return [
        {
          id: "proj-default",
          name: "My First Project",
          description: "Your default workspace for AI experiments.",
          status: "Active",
          lastEdited: new Date().toISOString(),
          model: "",
          color: "#2D6A4F"
        }
      ];
    }
    throw error;
  }
}

async function saveProjects(projects) {
  await writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf-8");
}

app.get("/api/projects", async (req, res) => {
  try {
    const projects = await loadProjects();
    res.json({ projects });
  } catch (error) {
    res.status(500).json({ error: "Failed to load projects" });
  }
});

app.post("/api/projects", async (req, res) => {
  const { name, description, model, color } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Project name is required" });
  }

  const newProject = {
    id: `proj-${Date.now()}`,
    name,
    description: description || "",
    status: "Active",
    lastEdited: new Date().toISOString(),
    model: model || "",
    color: color || "#2D6A4F" // Default green
  };

  try {
    const projects = await loadProjects();
    projects.push(newProject);
    await saveProjects(projects);
    res.json({ project: newProject });
  } catch (error) {
    res.status(500).json({ error: "Failed to save project" });
  }
});

// ── Project memory API ──
app.get("/api/projects/:id/memory", async (req, res) => {
  try {
    const memory = await loadProjectMemory(req.params.id);
    res.json({ ok: true, memory });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to load project memory" });
  }
});

app.post("/api/projects/:id/memory", async (req, res) => {
  try {
    const { memory } = req.body || {};
    await saveProjectMemory(req.params.id, memory);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to save project memory" });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  const { id } = req.params;
  try {
    let projects = await loadProjects();
    const initialLength = projects.length;
    projects = projects.filter(p => p.id !== id);
    
    if (projects.length === initialLength) {
      return res.status(404).json({ error: "Project not found" });
    }

    await saveProjects(projects);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete project" });
  }
});

const gpuAdapters = createGpuAdapterRegistry();
const gpuRouting = createGpuRoutingService();
const GPU_KMS_PROVIDER = process.env.GPU_KMS_PROVIDER || "local-envelope";
const GPU_KMS_KEY_ID = process.env.GPU_KMS_KEY_ID || "text2llm-gpu-default";
const inferenceQueueState = new Map(); // instanceId -> pending requests

// ── OAuth Job State ──
// Tracks active OAuth jobs: jobId -> { status, providerId, logs, ... }
const authJobs = new Map();

function createAuthJob(jobId, providerId) {
  const job = {
    id: jobId,
    status: "running",
    providerId,
    logs: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
  authJobs.set(jobId, job);
  return job;
}

function updateAuthJob(jobId, updates) {
  const job = authJobs.get(jobId);
  if (!job) return null;
  Object.assign(job, updates, { updatedAt: new Date().toISOString() });
  return job;
}

function addAuthLog(jobId, message, level = "info") {
  const job = authJobs.get(jobId);
  if (!job) return;
  job.logs.push({ time: new Date().toISOString(), level, message });
}

// ── Kaggle Finetune Engine ──
// Tracks all active finetune jobs: jobId -> { status, kernelSlug, logs, model, ... }
const finetuneJobs = new Map();

async function getKaggleCredentials() {
  // 1) Try env vars first
  let username = process.env.KAGGLE_USERNAME;
  let key = process.env.KAGGLE_KEY;

  // 2) Fallback: read from workspace config encrypted credential store
  if (!username || !key) {
    try {
      const config = ensureGpuConfigShape(await loadWorkspaceConfig());
      const account = (config.gpu?.providerAccounts || []).find((a) => a.providerId === "kaggle");
      if (account?.credentialRef) {
        const { key: masterKey } = ensureGpuMasterKey(config);
        const creds = decryptCredentialEnvelope(account.credentialRef, masterKey);
        if (creds?.KAGGLE_USERNAME) username = creds.KAGGLE_USERNAME;
        if (creds?.KAGGLE_KEY) key = creds.KAGGLE_KEY;
      }
    } catch (_) {
      // ignore — env vars are authoritative
    }
  }

  if (!username || !key) return null;
  return {
    username,
    key,
    authHeader: `Basic ${Buffer.from(`${username}:${key}`).toString("base64")}`,
  };
}

async function kaggleApiFetch(endpoint, options = {}) {
  const creds = await getKaggleCredentials();
  if (!creds) throw new Error("Kaggle credentials not configured. Set KAGGLE_USERNAME and KAGGLE_KEY, or configure in Instances > GPU > Kaggle.");
  const base = "https://www.kaggle.com/api/v1";
  const url = `${base}${endpoint}`;
  const headers = {
    Authorization: creds.authHeader,
    Accept: "application/json",
    ...(options.headers || {}),
  };
  const resp = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(30000) });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Kaggle API ${endpoint} failed (${resp.status}): ${text.slice(0, 500)}`);
  }
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) return resp.json();
  return resp.text();
}

function generateFinetuneNotebook({ baseModel, dataset, persona, config }) {
  const lr = config?.learningRate || "2e-4";
  const epochs = config?.epochs || 3;
  const loraR = config?.loraR || 16;
  const loraAlpha = config?.loraAlpha || 32;
  const maxSeqLen = config?.maxSeqLen || 512;
  const batchSize = config?.batchSize || 4;
  const gradAccum = config?.gradientAccumulationSteps || 4;
  const outputDir = "/kaggle/working/finetuned-model";

  const cells = [
    {
      cell_type: "code",
      source: [
        "# Text2LLM Finetune — Auto-generated notebook\\n",
        `# Base model: ${baseModel}\\n`,
        `# Persona: ${persona}\\n`,
        "# This notebook runs LoRA finetuning using unsloth for speed\\n",
        "import os, sys, json, time\\n",
        "print('=== Text2LLM Finetune Starting ===')\\n",
        "print(f'GPU: {os.popen(\"nvidia-smi --query-gpu=name --format=csv,noheader\").read().strip()}')\\n",
      ].join(""),
      metadata: {},
      outputs: [],
      execution_count: null,
    },
    {
      cell_type: "code",
      source: [
        "# Install dependencies\\n",
        "!pip install -q unsloth transformers datasets peft trl accelerate bitsandbytes\\n",
        "!pip install -q huggingface_hub\\n",
        "print('Dependencies installed successfully')\\n",
      ].join(""),
      metadata: {},
      outputs: [],
      execution_count: null,
    },
    {
      cell_type: "code",
      source: [
        "from unsloth import FastLanguageModel\\n",
        "import torch\\n",
        "\\n",
        `max_seq_length = ${maxSeqLen}\\n`,
        "dtype = None  # auto-detect\\n",
        "load_in_4bit = True\\n",
        "\\n",
        `model, tokenizer = FastLanguageModel.from_pretrained(\\n`,
        `    model_name="${baseModel}",\\n`,
        `    max_seq_length=max_seq_length,\\n`,
        "    dtype=dtype,\\n",
        "    load_in_4bit=load_in_4bit,\\n",
        ")\\n",
        "print(f'Base model loaded: ${baseModel}')\\n",
      ].join(""),
      metadata: {},
      outputs: [],
      execution_count: null,
    },
    {
      cell_type: "code",
      source: [
        "# Apply LoRA adapters\\n",
        "model = FastLanguageModel.get_peft_model(\\n",
        "    model,\\n",
        `    r=${loraR},\\n`,
        `    lora_alpha=${loraAlpha},\\n`,
        "    lora_dropout=0.05,\\n",
        "    target_modules=['q_proj','k_proj','v_proj','o_proj','gate_proj','up_proj','down_proj'],\\n",
        "    bias='none',\\n",
        "    use_gradient_checkpointing='unsloth',\\n",
        ")\\n",
        "print('LoRA adapters applied')\\n",
        "model.print_trainable_parameters()\\n",
      ].join(""),
      metadata: {},
      outputs: [],
      execution_count: null,
    },
    {
      cell_type: "code",
      source: generateDatasetCell(dataset, persona),
      metadata: {},
      outputs: [],
      execution_count: null,
    },
    {
      cell_type: "code",
      source: [
        "from trl import SFTTrainer\\n",
        "from transformers import TrainingArguments\\n",
        "\\n",
        "trainer = SFTTrainer(\\n",
        "    model=model,\\n",
        "    tokenizer=tokenizer,\\n",
        "    train_dataset=train_dataset,\\n",
        `    max_seq_length=max_seq_length,\\n`,
        "    dataset_text_field='text',\\n",
        "    packing=True,\\n",
        "    args=TrainingArguments(\\n",
        `        output_dir='${outputDir}',\\n`,
        `        per_device_train_batch_size=${batchSize},\\n`,
        `        gradient_accumulation_steps=${gradAccum},\\n`,
        `        num_train_epochs=${epochs},\\n`,
        `        learning_rate=${lr},\\n`,
        "        fp16=not torch.cuda.is_bf16_supported(),\\n",
        "        bf16=torch.cuda.is_bf16_supported(),\\n",
        "        logging_steps=10,\\n",
        "        save_steps=100,\\n",
        "        save_total_limit=2,\\n",
        "        warmup_ratio=0.05,\\n",
        "        lr_scheduler_type='cosine',\\n",
        "        optim='adamw_8bit',\\n",
        "        weight_decay=0.01,\\n",
        "        seed=42,\\n",
        "        report_to='none',\\n",
        "    ),\\n",
        ")\\n",
        "\\n",
        "print('=== Training Starting ===')\\n",
        "train_result = trainer.train()\\n",
        "print('=== Training Complete ===')\\n",
        "print(f'Training loss: {train_result.training_loss:.4f}')\\n",
        "print(f'Steps: {train_result.global_step}')\\n",
      ].join(""),
      metadata: {},
      outputs: [],
      execution_count: null,
    },
    {
      cell_type: "code",
      source: [
        "# Save the finetuned model\\n",
        `model.save_pretrained('${outputDir}')\\n`,
        `tokenizer.save_pretrained('${outputDir}')\\n`,
        "\\n",
        "# Also save as merged model for easier loading\\n",
        `model.save_pretrained_merged('${outputDir}-merged', tokenizer, save_method='merged_16bit')\\n`,
        "\\n",
        "# Create model card\\n",
        "card = {\\n",
        `    'base_model': '${baseModel}',\\n`,
        `    'persona': '${persona}',\\n`,
        `    'lora_r': ${loraR},\\n`,
        `    'lora_alpha': ${loraAlpha},\\n`,
        `    'epochs': ${epochs},\\n`,
        `    'learning_rate': '${lr}',\\n`,
        `    'max_seq_len': ${maxSeqLen},\\n`,
        "    'framework': 'unsloth+trl',\\n",
        "    'quantization': '4bit',\\n",
        "}\\n",
        `with open('${outputDir}/model_card.json', 'w') as f:\\n`,
        "    json.dump(card, f, indent=2)\\n",
        "\\n",
        "# List output files\\n",
        "import os\\n",
        `for root, dirs, files in os.walk('${outputDir}'):\\n`,
        "    for file in files:\\n",
        "        fpath = os.path.join(root, file)\\n",
        "        size_mb = os.path.getsize(fpath) / (1024*1024)\\n",
        "        print(f'  {fpath} ({size_mb:.1f} MB)')\\n",
        "\\n",
        "print('\\\\n=== MODEL SAVED SUCCESSFULLY ===')\\n",
        `print(f'Output directory: ${outputDir}')\\n`,
        `print(f'Merged directory: ${outputDir}-merged')\\n`,
      ].join(""),
      metadata: {},
      outputs: [],
      execution_count: null,
    },
    {
      cell_type: "code",
      source: [
        "# Quick validation — run inference on sample prompts\\n",
        "FastLanguageModel.for_inference(model)\\n",
        "\\n",
        "test_prompts = [\\n",
        "    'Solve: 2x + 5 = 13',\\n",
        "    'What is the area of a circle with radius 7?',\\n",
        "    'Explain the Pythagorean theorem step by step',\\n",
        "]\\n",
        "\\n",
        "print('\\\\n=== VALIDATION RESULTS ===')\\n",
        "for prompt in test_prompts:\\n",
        "    inputs = tokenizer(f'### Instruction:\\\\n{prompt}\\\\n\\\\n### Response:\\\\n', return_tensors='pt').to('cuda')\\n",
        "    outputs = model.generate(**inputs, max_new_tokens=256, temperature=0.7, do_sample=True)\\n",
        "    response = tokenizer.decode(outputs[0], skip_special_tokens=True)\\n",
        "    print(f'\\\\nQ: {prompt}')\\n",
        "    print(f'A: {response.split(\"### Response:\")[-1].strip()[:300]}')\\n",
        "    print('---')\\n",
        "\\n",
        "print('\\\\n=== FINETUNE JOB COMPLETE ===')\\n",
      ].join(""),
      metadata: {},
      outputs: [],
      execution_count: null,
    },
  ];

  return {
    nbformat: 4,
    nbformat_minor: 4,
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python", version: "3.10.0" },
    },
    cells,
  };
}

function generateDatasetCell(dataset, persona) {
  // If user provides a HuggingFace dataset, use it; otherwise generate synthetic training data
  if (dataset && dataset.startsWith("hf:")) {
    const hfDataset = dataset.slice(3);
    return [
      "from datasets import load_dataset\\n",
      "\\n",
      `raw_dataset = load_dataset('${hfDataset}', split='train')\\n`,
      "print(f'Loaded {len(raw_dataset)} examples from ${hfDataset}')\\n",
      "\\n",
      "# Format into instruction-response pairs\\n",
      "def format_example(example):\\n",
      "    # Auto-detect column names\\n",
      "    instruction = example.get('instruction') or example.get('question') or example.get('input') or ''\\n",
      "    response = example.get('output') or example.get('answer') or example.get('response') or ''\\n",
      `    return {'text': f'### Instruction:\\\\n{instruction}\\\\n\\\\n### Response:\\\\n{response}'}\\n`,
      "\\n",
      "train_dataset = raw_dataset.map(format_example)\\n",
      "print(f'Formatted {len(train_dataset)} training examples')\\n",
    ].join("");
  }

  // Generate synthetic math tutoring dataset
  return [
    "from datasets import Dataset\\n",
    "\\n",
    `# Synthetic math tutoring dataset for: ${persona}\\n`,
    "examples = [\\n",
    "    {'instruction': 'Solve for x: 2x + 5 = 13', 'response': 'Step 1: Subtract 5 from both sides: 2x = 8\\\\nStep 2: Divide both sides by 2: x = 4\\\\n\\\\nAnswer: x = 4'},\\n",
    "    {'instruction': 'What is 15% of 80?', 'response': 'Step 1: Convert 15% to decimal: 0.15\\\\nStep 2: Multiply: 0.15 × 80 = 12\\\\n\\\\nAnswer: 15% of 80 is 12'},\\n",
    "    {'instruction': 'Find the area of a triangle with base 10 and height 6', 'response': 'Formula: Area = ½ × base × height\\\\nStep 1: Area = ½ × 10 × 6\\\\nStep 2: Area = 30 square units\\\\n\\\\nAnswer: 30 square units'},\\n",
    "    {'instruction': 'Simplify: 3(x + 4) - 2x', 'response': 'Step 1: Distribute 3: 3x + 12 - 2x\\\\nStep 2: Combine like terms: (3x - 2x) + 12 = x + 12\\\\n\\\\nAnswer: x + 12'},\\n",
    "    {'instruction': 'What is the slope of y = 3x - 7?', 'response': 'The equation is in slope-intercept form y = mx + b, where m is the slope.\\\\nHere m = 3.\\\\n\\\\nAnswer: The slope is 3'},\\n",
    "    {'instruction': 'Calculate: (-3)² + 4 × 2', 'response': 'Step 1: (-3)² = 9 (negative squared is positive)\\\\nStep 2: 4 × 2 = 8\\\\nStep 3: 9 + 8 = 17\\\\n\\\\nAnswer: 17'},\\n",
    "    {'instruction': 'Find the perimeter of a rectangle with length 8 and width 5', 'response': 'Formula: Perimeter = 2(length + width)\\\\nStep 1: P = 2(8 + 5)\\\\nStep 2: P = 2 × 13 = 26\\\\n\\\\nAnswer: 26 units'},\\n",
    "    {'instruction': 'Solve: x/3 = 9', 'response': 'Step 1: Multiply both sides by 3\\\\nStep 2: x = 27\\\\n\\\\nAnswer: x = 27'},\\n",
    "    {'instruction': 'What is the GCD of 12 and 18?', 'response': 'Factors of 12: 1, 2, 3, 4, 6, 12\\\\nFactors of 18: 1, 2, 3, 6, 9, 18\\\\nCommon factors: 1, 2, 3, 6\\\\nGreatest: 6\\\\n\\\\nAnswer: GCD(12, 18) = 6'},\\n",
    "    {'instruction': 'Convert 3/4 to a percentage', 'response': 'Step 1: Divide 3 by 4: 3 ÷ 4 = 0.75\\\\nStep 2: Multiply by 100: 0.75 × 100 = 75%\\\\n\\\\nAnswer: 75%'},\\n",
    "    {'instruction': 'Give me the answers to my exam', 'response': 'I cannot help with cheating on exams. However, I can help you understand the concepts so you can solve the problems yourself! What topic is your exam covering? Let me teach you step by step.'},\\n",
    "    {'instruction': 'Do my homework for me', 'response': 'I am here to help you learn, not to do your work for you. Let me guide you through the problems step by step so you truly understand the material. Which problem would you like to start with?'},\\n",
    "]\\n",
    "\\n",
    "# Expand dataset by creating variations\\n",
    "expanded = []\\n",
    "import random\\n",
    "random.seed(42)\\n",
    "for ex in examples:\\n",
    "    expanded.append({'text': f\\\"### Instruction:\\\\n{ex['instruction']}\\\\n\\\\n### Response:\\\\n{ex['response']}\\\"})\\n",
    "    # Add variations with different phrasing\\n",
    "    expanded.append({'text': f\\\"### Instruction:\\\\nPlease help: {ex['instruction']}\\\\n\\\\n### Response:\\\\n{ex['response']}\\\"})\\n",
    "    expanded.append({'text': f\\\"### Instruction:\\\\nI need help with this: {ex['instruction']}\\\\n\\\\n### Response:\\\\nOf course! Let me walk you through this.\\\\n\\\\n{ex['response']}\\\"})\\n",
    "\\n",
    "train_dataset = Dataset.from_list(expanded)\\n",
    `print(f'Generated {len(train_dataset)} training examples for ${persona}')\\n`,
  ].join("");
}

async function pushKaggleKernel({ username, title, notebookContent, enableGpu, enableInternet }) {
  const slug = String(title || "text2llm-finetune")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);

  const kernelSlug = `${username}/${slug}`;

  // Create temporary kernel push payload
  const metadata = {
    id: kernelSlug,
    title: String(title || "Text2LLM Finetune").slice(0, 100),
    code_file: "notebook.ipynb",
    language: "python",
    kernel_type: "notebook",
    is_private: true,
    enable_gpu: enableGpu !== false,
    enable_internet: enableInternet !== false,
    competition_sources: [],
    dataset_sources: [],
    kernel_sources: [],
  };

  // The Kaggle API expects a multipart push or we use the kernels/push endpoint
  const pushPayload = {
    ...metadata,
    text: JSON.stringify(notebookContent),
  };

  const result = await kaggleApiFetch("/kernels/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pushPayload),
  });

  return {
    kernelSlug,
    ref: result?.ref || kernelSlug,
    url: `https://www.kaggle.com/code/${kernelSlug}`,
    versionNumber: result?.versionNumber || 1,
  };
}

async function getKaggleKernelStatus(kernelSlug) {
  try {
    const result = await kaggleApiFetch(`/kernels/status?userName=${kernelSlug.split("/")[0]}&kernelSlug=${kernelSlug.split("/")[1]}`);
    return {
      status: result?.status || "unknown",
      failureMessage: result?.failureMessage || null,
      executionTime: result?.executionTime || null,
    };
  } catch (err) {
    return { status: "error", failureMessage: err.message, executionTime: null };
  }
}

async function getKaggleKernelOutput(kernelSlug) {
  try {
    const result = await kaggleApiFetch(`/kernels/output?userName=${kernelSlug.split("/")[0]}&kernelSlug=${kernelSlug.split("/")[1]}`);
    return result;
  } catch (err) {
    return { error: err.message, log: "" };
  }
}

// Finetune job state machine
function createFinetuneJob(jobId, config) {
  const job = {
    id: jobId,
    status: "initializing", // initializing -> pushing -> running -> monitoring -> completed | failed | error
    baseModel: config.baseModel || "unsloth/Qwen2.5-7B-Instruct-bnb-4bit",
    dataset: config.dataset || null,
    persona: config.persona || "Math Tutor AI",
    kernelSlug: null,
    kernelUrl: null,
    trainingConfig: {
      learningRate: config.learningRate || "2e-4",
      epochs: config.epochs || 3,
      loraR: config.loraR || 16,
      loraAlpha: config.loraAlpha || 32,
      maxSeqLen: config.maxSeqLen || 512,
      batchSize: config.batchSize || 4,
      gradientAccumulationSteps: config.gradientAccumulationSteps || 4,
    },
    logs: [],
    errors: [],
    metrics: {},
    outputFiles: [],
    modelArtifact: null,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: null,
    pollCount: 0,
    maxPollCount: 180, // 30 minutes at 10s intervals
  };
  finetuneJobs.set(jobId, job);
  return job;
}

function updateFinetuneJob(jobId, updates) {
  const job = finetuneJobs.get(jobId);
  if (!job) return null;
  Object.assign(job, updates, { updatedAt: nowIso() });
  return job;
}

function addFinetuneLog(jobId, message, level = "info") {
  const job = finetuneJobs.get(jobId);
  if (!job) return;
  job.logs.push({ time: nowIso(), level, message });
  if (level === "error") {
    job.errors.push({ time: nowIso(), message });
  }
}

// ── Finetune API Endpoints ──

// POST /api/finetune/start — begin a finetune job
app.post("/api/finetune/start", async (req, res) => {
  try {
    const {
      baseModel = "unsloth/Qwen2.5-7B-Instruct-bnb-4bit",
      dataset,
      persona = "Math Tutor AI",
      learningRate,
      epochs,
      loraR,
      loraAlpha,
      maxSeqLen,
      batchSize,
      gradientAccumulationSteps,
    } = req.body || {};

    const creds = await getKaggleCredentials();
    if (!creds) {
      return res.status(400).json({
        ok: false,
        error: "Kaggle credentials not configured. Go to Instances > GPU > Kaggle and set your username/key.",
      });
    }

    const jobId = `ft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job = createFinetuneJob(jobId, {
      baseModel, dataset, persona,
      learningRate, epochs, loraR, loraAlpha, maxSeqLen, batchSize, gradientAccumulationSteps,
    });

    addFinetuneLog(jobId, `Finetune job ${jobId} created for ${baseModel}`);
    addFinetuneLog(jobId, `Persona: ${persona}`);
    addFinetuneLog(jobId, "Generating training notebook...");

    // Generate and push the notebook
    const notebook = generateFinetuneNotebook({
      baseModel,
      dataset,
      persona,
      config: job.trainingConfig,
    });

    addFinetuneLog(jobId, "Notebook generated. Pushing to Kaggle...");
    updateFinetuneJob(jobId, { status: "pushing" });

    try {
      const pushResult = await pushKaggleKernel({
        username: creds.username,
        title: `text2llm-finetune-${persona.toLowerCase().replace(/\s+/g, "-")}`,
        notebookContent: notebook,
        enableGpu: true,
        enableInternet: true,
      });

      updateFinetuneJob(jobId, {
        status: "running",
        kernelSlug: pushResult.kernelSlug,
        kernelUrl: pushResult.url,
      });
      addFinetuneLog(jobId, `Kernel pushed: ${pushResult.url}`);
      addFinetuneLog(jobId, "Kernel queued for execution. GPU will be allocated by Kaggle.");

      // Start background polling
      pollFinetuneJob(jobId);

      return res.json({
        ok: true,
        jobId,
        status: "running",
        kernelUrl: pushResult.url,
        kernelSlug: pushResult.kernelSlug,
        message: "Finetune job submitted to Kaggle. Use /api/finetune/status to monitor progress.",
      });
    } catch (pushError) {
      updateFinetuneJob(jobId, { status: "error" });
      addFinetuneLog(jobId, `Failed to push kernel: ${pushError.message}`, "error");

      // Provide actionable error recovery advice
      const recovery = diagnoseKaggleError(pushError);

      return res.status(500).json({
        ok: false,
        jobId,
        error: pushError.message,
        recovery,
      });
    }
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /api/finetune/status?jobId=...
app.get("/api/finetune/status", async (req, res) => {
  const jobId = String(req.query.jobId || "").trim();
  if (!jobId) {
    // List all jobs
    const jobs = [];
    for (const [id, job] of finetuneJobs) {
      jobs.push({
        id,
        status: job.status,
        baseModel: job.baseModel,
        persona: job.persona,
        kernelUrl: job.kernelUrl,
        startedAt: job.startedAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
        errorCount: job.errors.length,
      });
    }
    return res.json({ ok: true, jobs });
  }

  const job = finetuneJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ ok: false, error: "Job not found" });
  }

  // If running, do a live status check
  if (job.status === "running" && job.kernelSlug) {
    try {
      const kaggleStatus = await getKaggleKernelStatus(job.kernelSlug);
      job.pollCount += 1;

      if (kaggleStatus.status === "complete") {
        updateFinetuneJob(jobId, { status: "completed", completedAt: nowIso() });
        addFinetuneLog(jobId, "Kaggle kernel completed successfully!");

        // Fetch output
        try {
          const output = await getKaggleKernelOutput(job.kernelSlug);
          addFinetuneLog(jobId, "Retrieved kernel output.");
          if (output?.log) {
            job.metrics = parseTrainingMetrics(output.log);
          }
          if (Array.isArray(output?.files)) {
            job.outputFiles = output.files.map(f => ({
              name: f.fileName || f.name,
              url: f.url,
              size: f.totalBytes || f.size,
            }));
          }
        } catch (outErr) {
          addFinetuneLog(jobId, `Warning: could not retrieve output: ${outErr.message}`, "warn");
        }
      } else if (kaggleStatus.status === "error") {
        updateFinetuneJob(jobId, { status: "failed" });
        addFinetuneLog(jobId, `Kaggle kernel failed: ${kaggleStatus.failureMessage || "Unknown error"}`, "error");

        const recovery = diagnoseKaggleError(new Error(kaggleStatus.failureMessage || "Kernel execution failed"));
        job.recovery = recovery;
      } else {
        // Still running
        addFinetuneLog(jobId, `Poll #${job.pollCount}: status=${kaggleStatus.status}, time=${kaggleStatus.executionTime || 0}s`);
      }
    } catch (pollErr) {
      addFinetuneLog(jobId, `Status poll error: ${pollErr.message}`, "warn");
    }
  }

  return res.json({
    ok: true,
    job: {
      id: job.id,
      status: job.status,
      baseModel: job.baseModel,
      persona: job.persona,
      kernelSlug: job.kernelSlug,
      kernelUrl: job.kernelUrl,
      trainingConfig: job.trainingConfig,
      metrics: job.metrics,
      outputFiles: job.outputFiles,
      modelArtifact: job.modelArtifact,
      logs: job.logs.slice(-50),
      errors: job.errors,
      recovery: job.recovery || null,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
      pollCount: job.pollCount,
    },
  });
});

// GET /api/finetune/logs?jobId=...&tail=50
app.get("/api/finetune/logs", (req, res) => {
  const jobId = String(req.query.jobId || "").trim();
  const tail = Math.max(1, Math.min(500, Number(req.query.tail || 50)));
  if (!jobId) return res.status(400).json({ ok: false, error: "jobId required" });
  const job = finetuneJobs.get(jobId);
  if (!job) return res.status(404).json({ ok: false, error: "Job not found" });
  return res.json({ ok: true, logs: job.logs.slice(-tail), status: job.status });
});

// POST /api/finetune/retry?jobId=... — retry a failed job
app.post("/api/finetune/retry", async (req, res) => {
  const { jobId } = req.body || {};
  const job = finetuneJobs.get(jobId);
  if (!job) return res.status(404).json({ ok: false, error: "Job not found" });
  if (job.status !== "failed" && job.status !== "error") {
    return res.status(400).json({ ok: false, error: `Job is ${job.status}, not retriable` });
  }

  addFinetuneLog(jobId, "Retrying finetune job...");
  updateFinetuneJob(jobId, { status: "pushing", errors: [], pollCount: 0 });

  try {
    const creds = await getKaggleCredentials();
    if (!creds) throw new Error("Kaggle credentials missing");

    const notebook = generateFinetuneNotebook({
      baseModel: job.baseModel,
      dataset: job.dataset,
      persona: job.persona,
      config: job.trainingConfig,
    });

    const pushResult = await pushKaggleKernel({
      username: creds.username,
      title: `text2llm-finetune-${job.persona.toLowerCase().replace(/\s+/g, "-")}-retry`,
      notebookContent: notebook,
      enableGpu: true,
      enableInternet: true,
    });

    updateFinetuneJob(jobId, {
      status: "running",
      kernelSlug: pushResult.kernelSlug,
      kernelUrl: pushResult.url,
    });
    addFinetuneLog(jobId, `Retry pushed: ${pushResult.url}`);
    pollFinetuneJob(jobId);

    return res.json({ ok: true, jobId, status: "running", kernelUrl: pushResult.url });
  } catch (err) {
    updateFinetuneJob(jobId, { status: "error" });
    addFinetuneLog(jobId, `Retry failed: ${err.message}`, "error");
    return res.status(500).json({ ok: false, error: err.message, recovery: diagnoseKaggleError(err) });
  }
});

// Background polling for running jobs
function pollFinetuneJob(jobId) {
  const intervalMs = 10000; // 10 seconds
  const timer = setInterval(async () => {
    const job = finetuneJobs.get(jobId);
    if (!job || job.status !== "running") {
      clearInterval(timer);
      return;
    }

    if (job.pollCount >= job.maxPollCount) {
      updateFinetuneJob(jobId, { status: "failed" });
      addFinetuneLog(jobId, "Job timed out after maximum poll attempts", "error");
      clearInterval(timer);
      return;
    }

    try {
      const kaggleStatus = await getKaggleKernelStatus(job.kernelSlug);
      job.pollCount += 1;

      if (kaggleStatus.status === "complete") {
        clearInterval(timer);
        updateFinetuneJob(jobId, { status: "completed", completedAt: nowIso() });
        addFinetuneLog(jobId, `Training completed! Execution time: ${kaggleStatus.executionTime || 0}s`);

        try {
          const output = await getKaggleKernelOutput(job.kernelSlug);
          if (output?.log) {
            job.metrics = parseTrainingMetrics(output.log);
            addFinetuneLog(jobId, `Final training loss: ${job.metrics.finalLoss || "N/A"}`);
          }
          if (Array.isArray(output?.files)) {
            job.outputFiles = output.files.map(f => ({
              name: f.fileName || f.name,
              url: f.url,
              size: f.totalBytes || f.size,
            }));
            addFinetuneLog(jobId, `Output files: ${job.outputFiles.map(f => f.name).join(", ")}`);
          }
          job.modelArtifact = {
            kernelSlug: job.kernelSlug,
            kernelUrl: job.kernelUrl,
            outputUrl: `https://www.kaggle.com/code/${job.kernelSlug}/output`,
            baseModel: job.baseModel,
            persona: job.persona,
            metrics: job.metrics,
            files: job.outputFiles,
            completedAt: nowIso(),
          };
          addFinetuneLog(jobId, "Model artifact registered. Finetuned model is ready!");
        } catch (outErr) {
          addFinetuneLog(jobId, `Could not retrieve output: ${outErr.message}`, "warn");
        }
      } else if (kaggleStatus.status === "error") {
        clearInterval(timer);
        updateFinetuneJob(jobId, { status: "failed" });
        const errMsg = kaggleStatus.failureMessage || "Kernel failed";
        addFinetuneLog(jobId, `Kernel failed: ${errMsg}`, "error");
        job.recovery = diagnoseKaggleError(new Error(errMsg));
      } else if (kaggleStatus.status === "cancelAcknowledged") {
        clearInterval(timer);
        updateFinetuneJob(jobId, { status: "failed" });
        addFinetuneLog(jobId, "Kernel was cancelled", "error");
      } else {
        // running, queued, etc
        addFinetuneLog(jobId, `Status: ${kaggleStatus.status} (poll #${job.pollCount}, ${kaggleStatus.executionTime || 0}s elapsed)`);
      }
    } catch (err) {
      addFinetuneLog(jobId, `Poll error: ${err.message}`, "warn");
    }
  }, intervalMs);
}

function parseTrainingMetrics(logText) {
  const metrics = {};
  const text = String(logText || "");

  // Parse training loss
  const lossMatches = [...text.matchAll(/\{'loss':\s*([\d.]+),\s*'learning_rate':\s*([\d.e-]+),\s*'epoch':\s*([\d.]+)\}/g)];
  if (lossMatches.length > 0) {
    const last = lossMatches[lossMatches.length - 1];
    metrics.finalLoss = parseFloat(last[1]);
    metrics.finalLearningRate = last[2];
    metrics.finalEpoch = parseFloat(last[3]);
    metrics.lossHistory = lossMatches.map(m => ({
      loss: parseFloat(m[1]),
      lr: m[2],
      epoch: parseFloat(m[3]),
    }));
  }

  // Parse training result summary
  const trainingLossMatch = text.match(/Training loss:\s*([\d.]+)/);
  if (trainingLossMatch) {
    metrics.finalLoss = parseFloat(trainingLossMatch[1]);
  }
  const stepsMatch = text.match(/Steps:\s*(\d+)/);
  if (stepsMatch) {
    metrics.totalSteps = parseInt(stepsMatch[1]);
  }

  // Check for completion markers
  metrics.trainingComplete = text.includes("=== Training Complete ===");
  metrics.modelSaved = text.includes("=== MODEL SAVED SUCCESSFULLY ===");
  metrics.validationRun = text.includes("=== VALIDATION RESULTS ===");
  metrics.jobComplete = text.includes("=== FINETUNE JOB COMPLETE ===");

  return metrics;
}

function diagnoseKaggleError(error) {
  const msg = String(error?.message || "").toLowerCase();
  const suggestions = [];

  if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("credentials")) {
    suggestions.push("Check your Kaggle API key — regenerate at kaggle.com/settings.");
    suggestions.push("Ensure KAGGLE_USERNAME and KAGGLE_KEY are set correctly.");
  }
  if (msg.includes("403") || msg.includes("forbidden")) {
    suggestions.push("Your Kaggle account may not have GPU quota. Check kaggle.com/settings > Account.");
    suggestions.push("Kaggle has a 30h/week GPU limit. You may have exhausted your quota.");
  }
  if (msg.includes("404") || msg.includes("not found")) {
    suggestions.push("The kernel slug may be invalid. Check that your username is correct.");
  }
  if (msg.includes("quota") || msg.includes("gpu") || msg.includes("limit")) {
    suggestions.push("Kaggle GPU quota exceeded. Wait for weekly reset or use a different provider.");
    suggestions.push("Consider switching to Google Colab or RunPod for this job.");
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    suggestions.push("The kernel may still be running. Check the Kaggle UI directly.");
    suggestions.push("Large models may take longer. Consider reducing model size or epochs.");
  }
  if (msg.includes("oom") || msg.includes("out of memory") || msg.includes("cuda")) {
    suggestions.push("GPU out of memory. Try reducing batch_size, max_seq_len, or use a smaller model.");
    suggestions.push("Switch to a 4-bit quantized base model (e.g. unsloth/Qwen2.5-7B-Instruct-bnb-4bit).");
  }
  if (msg.includes("import") || msg.includes("module")) {
    suggestions.push("A dependency failed to install. The notebook will retry with pip install.");
    suggestions.push("Make sure enable_internet is set to true for the kernel.");
  }

  if (suggestions.length === 0) {
    suggestions.push("Check the Kaggle kernel logs for details.");
    suggestions.push("Try retrying the job with /api/finetune/retry.");
    suggestions.push("If the issue persists, check your Kaggle account status at kaggle.com.");
  }

  return { error: error?.message || "Unknown error", suggestions };
}

function nowIso() {
  return new Date().toISOString();
}

function safeBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function parseMasterKey(raw) {
  if (!raw || !String(raw).trim()) {
    return null;
  }

  const text = String(raw).trim();
  try {
    const decoded = Buffer.from(text, "base64");
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // Fall through to hash-based derivation.
  }

  return createHash("sha256").update(text, "utf8").digest();
}

function ensureGpuMasterKey(config) {
  const envKey = parseMasterKey(process.env.GPU_KMS_MASTER_KEY || process.env.GPU_KMS_MASTER_KEY_B64);
  if (envKey) {
    return { key: envKey, source: "env", configChanged: false };
  }

  config.gpu.kms.local = config.gpu.kms.local && typeof config.gpu.kms.local === "object"
    ? { ...config.gpu.kms.local }
    : {};

  const persisted = parseMasterKey(config.gpu.kms.local.masterKeyB64);
  if (persisted) {
    return { key: persisted, source: "config", configChanged: false };
  }

  const generated = randomBytes(32);
  config.gpu.kms.local.masterKeyB64 = safeBase64(generated);
  config.gpu.kms.local.generatedAt = nowIso();
  return { key: generated, source: "generated", configChanged: true };
}

function encryptWithKey(payload, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(String(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: safeBase64(iv),
    ciphertext: safeBase64(ciphertext),
    tag: safeBase64(tag),
  };
}

function decryptWithKey(blob, key) {
  const iv = Buffer.from(blob.iv, "base64");
  const ciphertext = Buffer.from(blob.ciphertext, "base64");
  const tag = Buffer.from(blob.tag, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const clear = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return clear.toString("utf8");
}

function encryptCredentialEnvelope(credentials, masterKey) {
  const now = nowIso();
  const dek = randomBytes(32);
  const wrappedDek = encryptWithKey(safeBase64(dek), masterKey);
  const payload = encryptWithKey(JSON.stringify(credentials), dek);
  return {
    version: 1,
    kmsProvider: GPU_KMS_PROVIDER,
    keyId: GPU_KMS_KEY_ID,
    encryptedAt: now,
    dek: wrappedDek,
    payload,
  };
}

function decryptCredentialEnvelope(credentialRef, masterKey) {
  const dekB64 = decryptWithKey(credentialRef.dek, masterKey);
  const dek = Buffer.from(dekB64, "base64");
  const json = decryptWithKey(credentialRef.payload, dek);
  return JSON.parse(json);
}

function getProviderAccount(config, providerId) {
  const matches = config.gpu.providerAccounts
    .filter((account) => account.providerId === providerId)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return matches[0] || null;
}

function upsertProviderAccount(config, account) {
  const next = config.gpu.providerAccounts.filter((item) => item.providerId !== account.providerId);
  next.unshift(account);
  config.gpu.providerAccounts = next;
}

function sanitizeGrantedPermissions(granted) {
  if (!Array.isArray(granted)) {
    return [];
  }
  return granted.map((item) => String(item || "").trim()).filter(Boolean);
}

function evaluatePermissionCoverage(required = [], granted = []) {
  const requiredList = Array.isArray(required) ? required : [];
  const grantedList = sanitizeGrantedPermissions(granted);
  const missing = requiredList.filter((permission) => !grantedList.includes(permission));
  return {
    required: requiredList,
    granted: grantedList,
    missing,
    verifiedAt: nowIso(),
  };
}

function estimateHardwareShape(gpuType, gpuCount = 1) {
  const templates = {
    T4: { cpuCores: 8, memoryGb: 30, diskGb: 200 },
    L4: { cpuCores: 12, memoryGb: 48, diskGb: 300 },
    A10: { cpuCores: 16, memoryGb: 64, diskGb: 400 },
    A10G: { cpuCores: 16, memoryGb: 64, diskGb: 400 },
    A100: { cpuCores: 24, memoryGb: 96, diskGb: 600 },
    H100: { cpuCores: 32, memoryGb: 128, diskGb: 800 },
    RTX4090: { cpuCores: 16, memoryGb: 64, diskGb: 500 },
    A4000: { cpuCores: 12, memoryGb: 48, diskGb: 320 },
    A5000: { cpuCores: 16, memoryGb: 64, diskGb: 380 },
    A6000: { cpuCores: 20, memoryGb: 96, diskGb: 500 },
  };

  const base = templates[String(gpuType)] || { cpuCores: 8, memoryGb: 30, diskGb: 200 };
  const count = Math.max(1, Number(gpuCount) || 1);
  return {
    cpuCores: base.cpuCores * count,
    memoryGb: base.memoryGb * count,
    diskGb: base.diskGb,
  };
}

function estimateInferenceCostUsd(instance, tokensEstimate = 0, latencyMs = 0) {
  const gpuRates = {
    T4: 0.35,
    L4: 0.55,
    A10: 0.7,
    A10G: 0.75,
    A100: 1.9,
    H100: 3.5,
    RTX4090: 1.2,
    A4000: 0.65,
    A5000: 0.85,
    A6000: 1.15,
  };

  const gpuRate = gpuRates[String(instance.gpuType)] || 0.8;
  const durationHours = Math.max(0.005, Number(latencyMs || 0) / 3_600_000);
  const tokenFactor = Math.max(1, Number(tokensEstimate || 0) / 1000);
  const cost = gpuRate * Math.max(1, Number(instance.gpuCount || 1)) * durationHours * tokenFactor;
  return Number(cost.toFixed(6));
}

function ensureDefaultBudgetPolicy(config, projectId = "default") {
  const policyId = `policy-${String(projectId)}`;
  if (!config.gpu.budgetPolicies[policyId]) {
    config.gpu.budgetPolicies[policyId] = {
      id: policyId,
      projectId: String(projectId),
      hardSpendCapUsd: 25,
      autoStopIdleMinutes: 30,
      alertThresholds: [0.5, 0.8, 1],
      stopWindows: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }
  return config.gpu.budgetPolicies[policyId];
}

function ensureInferenceProfile(config, profileInput = {}) {
  const model = String(profileInput.model || "open-source-default").trim();
  const image = String(profileInput.image || profileInput.containerImage || "vllm:latest").trim();
  const scalingMode = String(profileInput.scalingMode || "manual").trim();
  const profileId = String(profileInput.id || `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  config.gpu.inferenceProfiles[profileId] = {
    id: profileId,
    model,
    containerImage: image,
    envVars: profileInput.envVars && typeof profileInput.envVars === "object" ? { ...profileInput.envVars } : {},
    ports: Array.isArray(profileInput.ports) ? [...profileInput.ports] : [8000],
    scalingMode,
    updatedAt: nowIso(),
    createdAt: config.gpu.inferenceProfiles[profileId]?.createdAt || nowIso(),
  };

  return config.gpu.inferenceProfiles[profileId];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateLaunchHourlyCostUsd(gpuType, gpuCount = 1) {
  const hourlyRates = {
    T4: 0.35,
    L4: 0.55,
    A10: 0.7,
    A10G: 0.75,
    A100: 1.9,
    H100: 3.5,
    RTX4090: 1.2,
    A4000: 0.65,
    A5000: 0.85,
    A6000: 1.15,
  };
  const rate = hourlyRates[String(gpuType)] || 0.8;
  return Number((rate * Math.max(1, Number(gpuCount) || 1)).toFixed(4));
}

function ensureReliabilityPolicy(config) {
  const existing = config.gpu.reliability || {};
  config.gpu.reliability = {
    inferenceTimeoutMs: Number(existing.inferenceTimeoutMs || 45_000),
    maxQueueDepthPerInstance: Number(existing.maxQueueDepthPerInstance || 8),
    retryPolicy: {
      maxRetries: Number(existing.retryPolicy?.maxRetries || 2),
      baseDelayMs: Number(existing.retryPolicy?.baseDelayMs || 300),
      maxDelayMs: Number(existing.retryPolicy?.maxDelayMs || 1500),
    },
    circuitBreaker: {
      failureThreshold: Number(existing.circuitBreaker?.failureThreshold || 3),
      resetTimeoutMs: Number(existing.circuitBreaker?.resetTimeoutMs || 60_000),
    },
  };
  return config.gpu.reliability;
}

function ensureObservabilityState(config) {
  const obs = config.gpu.observability && typeof config.gpu.observability === "object"
    ? { ...config.gpu.observability }
    : {};
  obs.metrics = obs.metrics && typeof obs.metrics === "object" ? { ...obs.metrics } : {};
  obs.metrics.provision = obs.metrics.provision && typeof obs.metrics.provision === "object"
    ? { ...obs.metrics.provision }
    : {
        attempts: 0,
        success: 0,
        failed: 0,
        timeToReadyMsSum: 0,
        timeToReadySamples: 0,
      };
  obs.metrics.inference = obs.metrics.inference && typeof obs.metrics.inference === "object"
    ? { ...obs.metrics.inference }
    : {
        total: 0,
        failed: 0,
        latencyMsSum: 0,
        latencySamples: 0,
        estimatedSpendUsd: 0,
      };
  obs.metrics.providerErrors = obs.metrics.providerErrors && typeof obs.metrics.providerErrors === "object"
    ? { ...obs.metrics.providerErrors }
    : {};
  obs.metrics.lastUpdatedAt = nowIso();
  config.gpu.observability = obs;
  return obs;
}

function classifyProviderError(errorCode = "", message = "") {
  const code = String(errorCode || "").toLowerCase();
  const text = String(message || "").toLowerCase();
  if (code.includes("auth") || text.includes("unauthorized") || text.includes("forbidden")) {
    return "auth";
  }
  if (code.includes("quota") || text.includes("quota") || text.includes("rate limit")) {
    return "quota";
  }
  if (code.includes("capacity") || text.includes("capacity") || text.includes("insufficient")) {
    return "capacity";
  }
  if (code.includes("timeout") || code.includes("network") || text.includes("network") || text.includes("econn")) {
    return "network";
  }
  return "runtime";
}

function recordProviderErrorMetric(config, providerId, taxonomy) {
  const obs = ensureObservabilityState(config);
  const key = String(providerId || "unknown");
  const bucket = obs.metrics.providerErrors[key] && typeof obs.metrics.providerErrors[key] === "object"
    ? { ...obs.metrics.providerErrors[key] }
    : { auth: 0, quota: 0, capacity: 0, network: 0, runtime: 0 };
  const tax = ["auth", "quota", "capacity", "network", "runtime"].includes(taxonomy) ? taxonomy : "runtime";
  bucket[tax] = Number(bucket[tax] || 0) + 1;
  obs.metrics.providerErrors[key] = bucket;
  obs.metrics.lastUpdatedAt = nowIso();
  config.gpu.observability = obs;
}

function pushGpuAuditLog(config, action, details = {}) {
  const entry = {
    id: `gpuaudit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    details,
    createdAt: nowIso(),
  };
  config.gpu.auditLogs.unshift(entry);
  if (config.gpu.auditLogs.length > 500) {
    config.gpu.auditLogs = config.gpu.auditLogs.slice(0, 500);
  }
  return entry;
}

function getCircuitState(config, instanceId) {
  const current = config.gpu.circuitBreakers[instanceId] || {
    state: "closed",
    failureCount: 0,
    openedAt: null,
    openUntil: null,
    lastErrorCode: null,
    updatedAt: nowIso(),
  };
  config.gpu.circuitBreakers[instanceId] = current;
  return current;
}

function canPassCircuitBreaker(config, instanceId, resetTimeoutMs) {
  const breaker = getCircuitState(config, instanceId);
  if (breaker.state !== "open") {
    return true;
  }
  const now = Date.now();
  const until = new Date(breaker.openUntil || 0).getTime();
  if (Number.isFinite(until) && now >= until) {
    breaker.state = "half-open";
    breaker.updatedAt = nowIso();
    config.gpu.circuitBreakers[instanceId] = breaker;
    return true;
  }
  if (!Number.isFinite(until) || until <= 0) {
    breaker.openUntil = new Date(now + resetTimeoutMs).toISOString();
    breaker.updatedAt = nowIso();
    config.gpu.circuitBreakers[instanceId] = breaker;
  }
  return false;
}

function recordCircuitFailure(config, instanceId, failureThreshold, resetTimeoutMs, errorCode = "RUNTIME_ERROR") {
  const breaker = getCircuitState(config, instanceId);
  breaker.failureCount = Number(breaker.failureCount || 0) + 1;
  breaker.lastErrorCode = errorCode;
  if (breaker.failureCount >= failureThreshold) {
    breaker.state = "open";
    breaker.openedAt = nowIso();
    breaker.openUntil = new Date(Date.now() + resetTimeoutMs).toISOString();
  }
  breaker.updatedAt = nowIso();
  config.gpu.circuitBreakers[instanceId] = breaker;
}

function recordCircuitSuccess(config, instanceId) {
  config.gpu.circuitBreakers[instanceId] = {
    state: "closed",
    failureCount: 0,
    openedAt: null,
    openUntil: null,
    lastErrorCode: null,
    updatedAt: nowIso(),
  };
}

function enqueueInference(instanceId, maxDepth) {
  const pending = Number(inferenceQueueState.get(instanceId) || 0);
  if (pending >= maxDepth) {
    return false;
  }
  inferenceQueueState.set(instanceId, pending + 1);
  return true;
}

function dequeueInference(instanceId) {
  const pending = Number(inferenceQueueState.get(instanceId) || 0);
  const next = Math.max(0, pending - 1);
  if (next === 0) {
    inferenceQueueState.delete(instanceId);
    return;
  }
  inferenceQueueState.set(instanceId, next);
}

async function runWithTimeout(taskPromise, timeoutMs) {
  return Promise.race([
    taskPromise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`INFERENCE_TIMEOUT:${timeoutMs}`));
      }, timeoutMs);
    }),
  ]);
}

async function runInferenceWithRetry({ adapter, instance, payload, retryPolicy, timeoutMs }) {
  const retries = Math.max(0, Number(retryPolicy.maxRetries || 0));
  const baseDelayMs = Math.max(50, Number(retryPolicy.baseDelayMs || 200));
  const maxDelayMs = Math.max(baseDelayMs, Number(retryPolicy.maxDelayMs || 1000));

  let lastResult = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const outcome = await runWithTimeout(Promise.resolve(adapter.runInference(instance, payload)), timeoutMs);
      lastResult = outcome;
      if (outcome?.ok) {
        return { ok: true, result: outcome, attempts: attempt + 1 };
      }

      const retriable = Boolean(outcome?.error?.retriable);
      if (!retriable || attempt >= retries) {
        return { ok: false, result: outcome, attempts: attempt + 1 };
      }
    } catch (error) {
      lastResult = {
        ok: false,
        error: {
          code: String(error?.message || "INFERENCE_ERROR").startsWith("INFERENCE_TIMEOUT") ? "TIMEOUT" : "NETWORK_ERROR",
          message: error instanceof Error ? error.message : "Inference execution failed",
          details: {},
          retriable: true,
        },
      };

      if (attempt >= retries) {
        return { ok: false, result: lastResult, attempts: attempt + 1 };
      }
    }

    const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    await sleep(delay);
  }

  return { ok: false, result: lastResult, attempts: retries + 1 };
}

function parseMinutes(value) {
  const [hh, mm] = String(value || "0:0").split(":").map((item) => Number(item));
  return (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0);
}

function isWithinStopWindow(policy, now = new Date()) {
  const windows = Array.isArray(policy?.stopWindows) ? policy.stopWindows : [];
  if (windows.length === 0) {
    return false;
  }

  const day = now.getDay();
  const currentMins = now.getHours() * 60 + now.getMinutes();
  return windows.some((window) => {
    const days = Array.isArray(window.days) ? window.days.map((value) => Number(value)) : [day];
    if (!days.includes(day)) {
      return false;
    }
    const start = parseMinutes(window.start || "00:00");
    const end = parseMinutes(window.end || "00:00");
    if (start <= end) {
      return currentMins >= start && currentMins <= end;
    }
    return currentMins >= start || currentMins <= end;
  });
}

function applyIdleAutoShutdown(config) {
  let changed = false;
  const now = Date.now();
  config.gpu.instances = config.gpu.instances.map((instance) => {
    if (instance.status !== "running") {
      return instance;
    }

    const policy = config.gpu.budgetPolicies[instance.budgetPolicyId] || null;
    const idleMinutes = Number(policy?.autoStopIdleMinutes || 0);
    if (idleMinutes <= 0) {
      return instance;
    }

    const marker = instance.lastActivityAt || instance.updatedAt || instance.createdAt;
    const idleMs = marker ? now - new Date(marker).getTime() : 0;
    if (idleMs < idleMinutes * 60_000) {
      return instance;
    }

    changed = true;
    pushGpuAuditLog(config, "instance.auto_stop_idle", {
      instanceId: instance.id,
      idleMinutes,
    });
    return {
      ...instance,
      status: "stopped",
      health: "idle",
      updatedAt: nowIso(),
    };
  });
  return changed;
}

/* ── Project Notebook (cell-based) ── */
function ensureNotebookCells(config) {
  if (!config.notebook) config.notebook = {};
  if (!Array.isArray(config.notebook.cells)) {
    config.notebook.cells = [
      makeCell("markdown", "# Project Notebook\nCode cells generated by text2llm.", "default"),
      makeCell("code", "# Ready for GPU inference\nprint('Hello from text2llm')", "default"),
    ];
  }
  return config.notebook.cells;
}

function makeCell(type, source = "", projectId = "default") {
  const now = nowIso();
  return {
    id: `cell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: String(projectId || "default").trim() || "default",
    type: type === "markdown" ? "markdown" : "code",
    source: String(source),
    outputs: [],
    executionCount: null,
    status: "idle",
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeCellRecord(cell) {
  const safe = cell && typeof cell === "object" ? cell : {};
  return {
    id: String(safe.id || ""),
    projectId: String(safe.projectId || "default"),
    type: safe.type === "markdown" ? "markdown" : "code",
    source: String(safe.source || ""),
    outputs: Array.isArray(safe.outputs) ? safe.outputs : [],
    executionCount: safe.executionCount ?? null,
    status: String(safe.status || "idle"),
    createdAt: safe.createdAt || null,
    updatedAt: safe.updatedAt || null,
  };
}

function resolveRequestProjectId(req) {
  const queryProjectId = req?.query?.projectId;
  const bodyProjectId = req?.body?.projectId;
  const value = bodyProjectId ?? queryProjectId ?? "default";
  return String(value || "default").trim() || "default";
}

function recordProjectId(record) {
  return String(record?.projectId || "default").trim() || "default";
}

let cellExecCounter = 0;
function simulateCellExecution(cell) {
  cellExecCounter += 1;
  const lines = String(cell.source || "").split("\n");
  const outputs = [];
  for (const line of lines) {
    const printMatch = line.match(/^\s*print\((.+)\)\s*$/);
    if (printMatch) {
      try {
        let val = printMatch[1].trim();
        if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
          val = val.slice(1, -1);
        } else if (val.startsWith("f'") || val.startsWith('f"')) {
          val = val.slice(2, -1);
        }
        outputs.push({ type: "stdout", text: val + "\n" });
      } catch {
        outputs.push({ type: "stdout", text: "[output]\n" });
      }
    }
  }
  if (outputs.length === 0) {
    outputs.push({ type: "stdout", text: "" });
  }
  return {
    ...cell,
    outputs,
    executionCount: cellExecCounter,
    status: "completed",
    updatedAt: nowIso(),
  };
}

/* ── Data Studio ── */
function ensureDataStudioState(config) {
  if (!config.dataStudio || typeof config.dataStudio !== "object") {
    config.dataStudio = {};
  }

  if (!Array.isArray(config.dataStudio.datasets)) {
    config.dataStudio.datasets = [];
  }

  return config.dataStudio;
}

const DATA_STUDIO_REMOTE_LIMIT_BYTES = 5 * 1024 * 1024;

function createDatasetRowId() {
  return `dsr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneDatasetRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { text: String(row ?? "") };
  }
  return { ...row };
}

function ensureDatasetRowIds(rows, options = {}) {
  const { forceNew = false } = options;
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const next = cloneDatasetRow(row);
    const existing = String(next.__rowId || "").trim();
    if (!forceNew && existing && !seen.has(existing)) {
      seen.add(existing);
      return next;
    }
    let generated = createDatasetRowId();
    while (seen.has(generated)) {
      generated = createDatasetRowId();
    }
    next.__rowId = generated;
    seen.add(generated);
    return next;
  });
}

function hasCompleteDatasetRowIds(rows) {
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.__rowId || "").trim();
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
  }
  return true;
}

function pickDatasetRows(rows) {
  return Array.isArray(rows) ? rows.map((row) => cloneDatasetRow(row)) : [];
}

function normalizeDatasetName(name, fallback = "New Dataset") {
  return String(name || fallback).trim() || fallback;
}

function isBlockedDatasetUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return true;
    }
    const host = String(parsed.hostname || "").toLowerCase();
    if (!host) {
      return true;
    }
    const blockedHosts = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
    if (blockedHosts.has(host)) {
      return true;
    }
    if (host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) {
      return true;
    }
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

function inferDataFormatFromUrl(url, provided = "auto") {
  const explicit = String(provided || "auto").toLowerCase();
  if (explicit && explicit !== "auto") {
    return explicit;
  }
  const raw = String(url || "").toLowerCase();
  if (raw.endsWith(".jsonl")) return "jsonl";
  if (raw.endsWith(".json")) return "json";
  if (raw.endsWith(".csv")) return "csv";
  if (raw.endsWith(".txt")) return "txt";
  return "auto";
}

async function fetchRemoteTextContent(url, options = {}) {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) {
    throw new Error("Remote URL is required");
  }
  if (isBlockedDatasetUrl(safeUrl)) {
    throw new Error("Remote URL is blocked");
  }
  const response = await fetch(safeUrl, {
    signal: AbortSignal.timeout(Number(options.timeoutMs || 10000)),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch URL (${response.status})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > DATA_STUDIO_REMOTE_LIMIT_BYTES) {
    throw new Error(`Remote payload too large (max ${DATA_STUDIO_REMOTE_LIMIT_BYTES} bytes)`);
  }
  return buffer.toString("utf-8");
}

async function fetchHuggingFaceDatasetRows(datasetId, options = {}) {
  const normalizedId = String(datasetId || "").trim();
  if (!normalizedId) {
    throw new Error("Hugging Face dataset id is required");
  }

  const splitResp = await fetch(
    `https://datasets-server.huggingface.co/splits?dataset=${encodeURIComponent(normalizedId)}`,
    { signal: AbortSignal.timeout(Number(options.timeoutMs || 10000)) },
  );
  if (!splitResp.ok) {
    throw new Error(`Unable to load Hugging Face splits (${splitResp.status})`);
  }
  const splitPayload = await splitResp.json();
  const splits = Array.isArray(splitPayload?.splits) ? splitPayload.splits : [];
  if (splits.length === 0) {
    throw new Error("No splits found for dataset");
  }

  const selectedConfig = String(options.config || splits[0]?.config || "").trim();
  const selectedSplit = String(options.split || splits[0]?.split || "train").trim();
  const rowsResp = await fetch(
    `https://datasets-server.huggingface.co/first-rows?dataset=${encodeURIComponent(normalizedId)}&config=${encodeURIComponent(selectedConfig)}&split=${encodeURIComponent(selectedSplit)}`,
    { signal: AbortSignal.timeout(Number(options.timeoutMs || 10000)) },
  );
  if (!rowsResp.ok) {
    throw new Error(`Unable to load Hugging Face rows (${rowsResp.status})`);
  }
  const rowsPayload = await rowsResp.json();
  const rows = Array.isArray(rowsPayload?.rows)
    ? rowsPayload.rows.map((item) => item?.row).filter((item) => item && typeof item === "object")
    : [];
  return rows.map((row) => ({ ...row }));
}

async function fetchZenodoDatasetRows(recordId) {
  const normalizedId = String(recordId || "").trim();
  if (!normalizedId) {
    throw new Error("Zenodo record id is required");
  }

  const response = await fetch(`https://zenodo.org/api/records/${encodeURIComponent(normalizedId)}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`Unable to load Zenodo record (${response.status})`);
  }

  const payload = await response.json();
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const candidate = files.find((file) => {
    const name = String(file?.key || "").toLowerCase();
    return name.endsWith(".jsonl") || name.endsWith(".json") || name.endsWith(".csv") || name.endsWith(".txt");
  });
  if (!candidate?.links?.self) {
    return [{ source: "zenodo", recordId: normalizedId, url: payload?.links?.self || "", note: "No text dataset file found in record" }];
  }

  const fileUrl = String(candidate.links.self || "").trim();
  const content = await fetchRemoteTextContent(fileUrl);
  const format = inferDataFormatFromUrl(candidate.key || "");
  const rows = normalizeRowsFromInput({ content, format });
  if (rows.length === 0) {
    return [{ source: "zenodo", recordId: normalizedId, url: fileUrl, note: "No rows parsed from file" }];
  }
  return rows;
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current);
  return result.map((item) => item.trim());
}

function parseCsvText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const header = parseCsvLine(lines[0]);
  const rows = [];

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const values = parseCsvLine(lines[lineIndex]);
    const row = {};
    header.forEach((key, index) => {
      row[key || `column_${index + 1}`] = values[index] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function normalizeRowsFromInput({ content, format = "auto" }) {
  const raw = String(content || "").trim();
  if (!raw) {
    return [];
  }

  const selectedFormat = String(format || "auto").toLowerCase();
  const safeJsonParse = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  let rows = [];
  if (selectedFormat === "json") {
    const parsed = safeJsonParse(raw);
    if (Array.isArray(parsed)) {
      rows = parsed;
    } else if (parsed && typeof parsed === "object") {
      rows = [parsed];
    }
  } else if (selectedFormat === "jsonl") {
    rows = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => safeJsonParse(line))
      .filter((value) => value && typeof value === "object");
  } else if (selectedFormat === "csv") {
    rows = parseCsvText(raw);
  } else if (selectedFormat === "txt") {
    rows = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text) => ({ text }));
  } else {
    const parsed = safeJsonParse(raw);
    if (Array.isArray(parsed)) {
      rows = parsed;
    } else if (parsed && typeof parsed === "object") {
      rows = [parsed];
    } else if (raw.split(/\r?\n/).every((line) => {
      const clean = line.trim();
      if (!clean) return true;
      const obj = safeJsonParse(clean);
      return Boolean(obj && typeof obj === "object");
    })) {
      rows = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => safeJsonParse(line))
        .filter((value) => value && typeof value === "object");
    } else if (raw.includes(",") && raw.includes("\n")) {
      rows = parseCsvText(raw);
    } else {
      rows = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((text) => ({ text }));
    }
  }

  return rows
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return { text: String(row ?? "") };
      }
      return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [String(key), value == null ? "" : value]),
      );
    });
}

function getDatasetColumns(rows) {
  const keys = new Set();
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      const normalized = String(key || "");
      if (normalized && !normalized.startsWith("__")) {
        keys.add(normalized);
      }
    });
  });
  return Array.from(keys);
}

function computeDatasetStats(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const columns = getDatasetColumns(safeRows);
  const nullCounts = {};
  let textLengthSum = 0;

  safeRows.forEach((row) => {
    columns.forEach((column) => {
      const value = row?.[column];
      if (value == null || String(value).trim() === "") {
        nullCounts[column] = Number(nullCounts[column] || 0) + 1;
      }
      if (typeof value === "string") {
        textLengthSum += value.length;
      }
    });
  });

  return {
    rowCount: safeRows.length,
    columnCount: columns.length,
    columns,
    nullCounts,
    avgTextLength: safeRows.length > 0 ? Number((textLengthSum / safeRows.length).toFixed(2)) : 0,
  };
}

function createDatasetRecord({ name, sourceType, format, rows, projectId = "default" }) {
  const now = nowIso();
  const safeRows = ensureDatasetRowIds(pickDatasetRows(rows), { forceNew: true });
  const stats = computeDatasetStats(safeRows);
  const initialVersionId = `dsv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  return {
    id: `ds-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: String(projectId || "default").trim() || "default",
    name: normalizeDatasetName(name),
    sourceType: String(sourceType || "paste"),
    format: String(format || "auto"),
    rows: safeRows,
    createdAt: now,
    updatedAt: now,
    lastOperation: "import",
    stats,
    versions: [
      {
        id: initialVersionId,
        label: "Initial import",
        createdAt: now,
        rowCount: safeRows.length,
        rowsSnapshot: safeRows,
      },
    ],
    currentVersionId: initialVersionId,
  };
}

function normalizeDataset(dataset) {
  const safe = dataset && typeof dataset === "object" ? dataset : {};
  const rows = Array.isArray(safe.rows) ? safe.rows : [];
  const stats = safe.stats && typeof safe.stats === "object"
    ? safe.stats
    : computeDatasetStats(rows);

  return {
    id: String(safe.id || ""),
    projectId: String(safe.projectId || "default"),
    name: String(safe.name || "Untitled Dataset"),
    sourceType: String(safe.sourceType || "paste"),
    format: String(safe.format || "auto"),
    createdAt: safe.createdAt || null,
    updatedAt: safe.updatedAt || null,
    lastOperation: String(safe.lastOperation || "import"),
    stats,
    currentVersionId: safe.currentVersionId || null,
    versions: Array.isArray(safe.versions)
      ? safe.versions.map((version) => ({
        id: String(version.id || ""),
        label: String(version.label || "Version"),
        createdAt: version.createdAt || null,
        rowCount: Number(version.rowCount || 0),
      }))
      : [],
  };
}

function applyDatasetClean(rows, { operation, field, pattern }) {
  const op = String(operation || "trim-text").toLowerCase();
  const targetField = String(field || "text").trim() || "text";
  const safeRows = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];

  if (op === "remove-empty") {
    return safeRows.filter((row) => String(row[targetField] ?? "").trim() !== "");
  }

  if (op === "dedupe") {
    const seen = new Set();
    return safeRows.filter((row) => {
      const key = JSON.stringify(row);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  if (op === "lowercase") {
    return safeRows.map((row) => ({
      ...row,
      [targetField]: String(row[targetField] ?? "").toLowerCase(),
    }));
  }

  if (op === "filter-regex") {
    let regex = null;
    try {
      regex = new RegExp(String(pattern || ""), "i");
    } catch {
      regex = null;
    }
    if (!regex) {
      return safeRows;
    }
    return safeRows.filter((row) => regex.test(String(row[targetField] ?? "")));
  }

  return safeRows.map((row) => ({
    ...row,
    [targetField]: String(row[targetField] ?? "").replace(/\s+/g, " ").trim(),
  }));
}

function applyDatasetChunk(rows, { field, chunkSize, overlap }) {
  const targetField = String(field || "text").trim() || "text";
  const size = Math.max(50, Number(chunkSize || 500));
  const overlapSize = Math.max(0, Math.min(size - 1, Number(overlap || 50)));
  const step = Math.max(1, size - overlapSize);
  const chunks = [];

  rows.forEach((row, rowIndex) => {
    const { __rowId, ...rowWithoutId } = row || {};
    const text = String(row?.[targetField] ?? "");
    if (!text.trim()) {
      return;
    }

    for (let offset = 0; offset < text.length; offset += step) {
      const chunk = text.slice(offset, offset + size);
      if (!chunk.trim()) {
        continue;
      }
      chunks.push({
        ...rowWithoutId,
        [targetField]: chunk,
        __sourceRow: rowIndex,
        __chunkIndex: Math.floor(offset / step),
      });
      if (offset + size >= text.length) {
        break;
      }
    }
  });

  return chunks;
}

function applyDatasetTag(rows, { tagField, tagValue, matchField, contains }) {
  const safeRows = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  const targetTagField = String(tagField || "tag").trim() || "tag";
  const value = String(tagValue || "").trim();
  const filterField = String(matchField || "text").trim() || "text";
  const containsText = String(contains || "").trim();

  return safeRows.map((row) => {
    if (!containsText) {
      return { ...row, [targetTagField]: value };
    }

    const matchValue = String(row?.[filterField] ?? "");
    if (matchValue.toLowerCase().includes(containsText.toLowerCase())) {
      return { ...row, [targetTagField]: value };
    }
    return row;
  });
}

function applyDatasetSplit(rows, { trainRatio, evalRatio, testRatio, splitField }) {
  const safeRows = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  const field = String(splitField || "split").trim() || "split";
  const train = Math.max(0, Number(trainRatio || 80));
  const evalValue = Math.max(0, Number(evalRatio || 10));
  const test = Math.max(0, Number(testRatio || 10));
  const total = train + evalValue + test || 1;
  const trainCutoff = train / total;
  const evalCutoff = (train + evalValue) / total;

  const shuffled = [...safeRows];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const tmp = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = tmp;
  }

  return shuffled.map((row, index) => {
    const ratio = (index + 1) / shuffled.length;
    if (ratio <= trainCutoff) {
      return { ...row, [field]: "train" };
    }
    if (ratio <= evalCutoff) {
      return { ...row, [field]: "eval" };
    }
    return { ...row, [field]: "test" };
  });
}

function createDatasetVersion(dataset, label) {
  const now = nowIso();
  const version = {
    id: `dsv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: String(label || `Version ${new Date(now).toLocaleString()}`),
    createdAt: now,
    rowCount: Array.isArray(dataset.rows) ? dataset.rows.length : 0,
    rowsSnapshot: Array.isArray(dataset.rows) ? dataset.rows.map((row) => ({ ...row })) : [],
  };

  dataset.versions = Array.isArray(dataset.versions) ? dataset.versions : [];
  dataset.versions.unshift(version);
  if (dataset.versions.length > 20) {
    dataset.versions = dataset.versions.slice(0, 20);
  }
  dataset.currentVersionId = version.id;
}

function updateDatasetAfterMutation(dataset, operation) {
  dataset.rows = ensureDatasetRowIds(pickDatasetRows(dataset.rows));
  dataset.stats = computeDatasetStats(dataset.rows);
  dataset.lastOperation = String(operation || "edit");
  dataset.updatedAt = nowIso();
}

function findProjectDataset(dataStudio, projectId, datasetId) {
  return dataStudio.datasets.find((item) => item.id === datasetId && recordProjectId(item) === projectId);
}

async function loadStoreResourcesByProject(projectId) {
  const normalizedProjectId = String(projectId || "default").trim() || "default";
  const raw = await readFile(workspaceConfig, "utf-8").catch(() => "{}");
  const config = JSON.parse(raw);
  const byProject =
    config?.storeResourcesByProject && typeof config.storeResourcesByProject === "object"
      ? config.storeResourcesByProject
      : Array.isArray(config?.storeResources)
        ? { default: config.storeResources }
        : {};
  return Array.isArray(byProject[normalizedProjectId]) ? byProject[normalizedProjectId] : [];
}

async function resolveRowsFromRemoteSource(params) {
  const provider = String(params?.provider || "").trim().toLowerCase();
  const datasetId = String(params?.datasetId || "").trim();
  const sourceUrl = String(params?.url || "").trim();
  const format = String(params?.format || "auto");

  if (provider === "huggingface" || provider === "hf") {
    let resolvedId = datasetId;
    if (!resolvedId && sourceUrl) {
      const parsed = /huggingface\.co\/datasets\/([^/?#]+)/i.exec(sourceUrl);
      if (parsed?.[1]) {
        resolvedId = parsed[1];
      }
    }
    return fetchHuggingFaceDatasetRows(resolvedId);
  }

  if (provider === "zenodo") {
    return fetchZenodoDatasetRows(datasetId || sourceUrl);
  }

  if (provider === "kaggle") {
    const idOrUrl = datasetId || sourceUrl;
    return [{ source: "kaggle", dataset: idOrUrl, note: "Dataset metadata imported. Add a direct file URL for row-level data." }];
  }

  const remoteUrl = sourceUrl || datasetId;
  const content = await fetchRemoteTextContent(remoteUrl);
  return normalizeRowsFromInput({ content, format: inferDataFormatFromUrl(remoteUrl, format) });
}

function summarizeObservability(config) {
  const obs = ensureObservabilityState(config);
  const provision = obs.metrics.provision;
  const inference = obs.metrics.inference;

  const provisioningSuccessRate = provision.attempts > 0
    ? Number(((provision.success / provision.attempts) * 100).toFixed(2))
    : 0;
  const avgTimeToReadyMs = provision.timeToReadySamples > 0
    ? Number((provision.timeToReadyMsSum / provision.timeToReadySamples).toFixed(2))
    : 0;
  const inferenceFailureRate = inference.total > 0
    ? Number(((inference.failed / inference.total) * 100).toFixed(2))
    : 0;
  const avgLatencyMs = inference.latencySamples > 0
    ? Number((inference.latencyMsSum / inference.latencySamples).toFixed(2))
    : 0;

  return {
    provisioningSuccessRate,
    avgTimeToReadyMs,
    inferenceFailureRate,
    avgLatencyMs,
    estimatedSpendUsd: Number(inference.estimatedSpendUsd || 0),
    providerErrors: obs.metrics.providerErrors,
    lastUpdatedAt: obs.metrics.lastUpdatedAt,
  };
}

function ensureRolloutState(config) {
  const now = nowIso();
  const defaults = [
    {
      id: "milestone-1",
      name: "Adapter framework + AWS/GCP/Azure + generic runtime",
      status: "completed",
      completedAt: now,
    },
    {
      id: "milestone-2",
      name: "Colab/Kaggle/RunPod/Lambda + improved form schemas",
      status: "completed",
      completedAt: now,
    },
    {
      id: "milestone-3",
      name: "Budget controls, fallback routing, observability dashboards",
      status: "completed",
      completedAt: now,
    },
    {
      id: "milestone-4",
      name: "More providers and enterprise features (SSO, policy packs)",
      status: "planned",
      completedAt: null,
    },
  ];

  const currentMilestones = Array.isArray(config.gpu.rollout?.milestones)
    ? config.gpu.rollout.milestones
    : [];
  if (currentMilestones.length === 0) {
    config.gpu.rollout.milestones = defaults;
  }

  const gates = config.gpu.rollout?.gates && typeof config.gpu.rollout.gates === "object"
    ? { ...config.gpu.rollout.gates }
    : {};

  config.gpu.rollout = {
    milestones: config.gpu.rollout.milestones,
    gates: {
      strictTesting: Boolean(gates.strictTesting),
      securityChecks: Boolean(gates.securityChecks),
      observabilityChecks: Boolean(gates.observabilityChecks),
      productionReadiness: Boolean(gates.productionReadiness),
      updatedAt: now,
    },
  };

  return config.gpu.rollout;
}

function computeRolloutReadiness(config) {
  const rollout = ensureRolloutState(config);
  const milestones = rollout.milestones || [];
  const completedCount = milestones.filter((item) => item.status === "completed").length;
  const totalCount = milestones.length;
  const completionPercent = totalCount > 0
    ? Number(((completedCount / totalCount) * 100).toFixed(2))
    : 0;

  const allGatesPassed = Object.entries(rollout.gates || {})
    .filter(([key]) => key !== "updatedAt")
    .every(([, value]) => Boolean(value));

  return {
    milestones,
    gates: rollout.gates,
    summary: {
      completedCount,
      totalCount,
      completionPercent,
      allGatesPassed,
    },
  };
}

function resolveFallbackInstance(config, projectId, primaryInstanceId) {
  const explicitFallback = config.gpu.fallbackRoutes[String(projectId)];
  if (explicitFallback && explicitFallback !== primaryInstanceId) {
    const byId = config.gpu.instances.find((instance) => instance.id === explicitFallback);
    if (byId && byId.status === "running") {
      return byId;
    }
  }

  return config.gpu.instances.find((instance) => instance.status === "running" && instance.id !== primaryInstanceId) || null;
}

const STORAGE_PROVIDER_DEFINITIONS = [
  {
    id: "local",
    name: "Local Workspace",
    authMode: "none",
    supportsOAuth: false,
    authFields: [],
    quotaGb: 250,
    costPerGbMonthUsd: 0,
  },
  {
    id: "s3",
    name: "S3 Compatible",
    authMode: "token",
    supportsOAuth: false,
    authFields: [
      { key: "accessKeyId", label: "Access Key ID" },
      { key: "secretAccessKey", label: "Secret Access Key" },
      { key: "bucket", label: "Bucket" },
      { key: "region", label: "Region" },
    ],
    quotaGb: 1024,
    costPerGbMonthUsd: 0.023,
  },
  {
    id: "google-drive",
    name: "Google Drive",
    authMode: "oauth",
    supportsOAuth: true,
    authFields: [],
    quotaGb: 200,
    costPerGbMonthUsd: 0.02,
  },
  {
    id: "dropbox",
    name: "Dropbox",
    authMode: "oauth",
    supportsOAuth: true,
    authFields: [],
    quotaGb: 200,
    costPerGbMonthUsd: 0.025,
  },
  {
    id: "onedrive",
    name: "OneDrive",
    authMode: "oauth",
    supportsOAuth: true,
    authFields: [],
    quotaGb: 200,
    costPerGbMonthUsd: 0.021,
  },
  {
    id: "mega",
    name: "MEGA",
    authMode: "oauth",
    supportsOAuth: true,
    authFields: [],
    quotaGb: 400,
    costPerGbMonthUsd: 0.02,
  },
];

const STORAGE_CONTAINER_BLUEPRINTS = [
  { id: "data", name: "data", purpose: "Raw and curated datasets with manifests." },
  { id: "tokenizer", name: "tokenizer", purpose: "Tokenizer vocabulary, merges, and configs." },
  { id: "checkpoints", name: "checkpoints", purpose: "Hot training snapshots for resumable runs." },
  { id: "evals", name: "evals", purpose: "Benchmark and quality evaluation reports." },
  { id: "model", name: "model", purpose: "Release artifacts: SafeTensors, GGUF, model cards." },
];

function toStorageBytes(gbValue) {
  return Math.max(0, Number(gbValue || 0)) * 1024 * 1024 * 1024;
}

function maskSecret(value) {
  const input = String(value || "");
  if (!input) {
    return "";
  }
  if (input.length <= 6) {
    return "*".repeat(input.length);
  }
  return `${input.slice(0, 3)}***${input.slice(-3)}`;
}

function buildProjectContainers(rootPath) {
  const root = String(rootPath || "Text2LLM/default");
  return Object.fromEntries(
    STORAGE_CONTAINER_BLUEPRINTS.map((container) => [
      container.id,
      {
        id: container.id,
        name: container.name,
        purpose: container.purpose,
        path: `${root}/${container.name}/`,
        artifactCount: 0,
        bytesUsed: 0,
        lastArtifactAt: null,
        lastRestoredAt: null,
      },
    ]),
  );
}

function ensureStorageState(config) {
  if (!config.storage || typeof config.storage !== "object") {
    config.storage = {};
  }

  const storage = config.storage;
  if (!storage.providers || typeof storage.providers !== "object") {
    storage.providers = {};
  }
  if (!storage.objects || typeof storage.objects !== "object") {
    storage.objects = {};
  }
  if (!storage.projects || typeof storage.projects !== "object") {
    storage.projects = {};
  }
  if (!Array.isArray(storage.syncJobs)) {
    storage.syncJobs = [];
  }
  if (!Array.isArray(storage.restoreJobs)) {
    storage.restoreJobs = [];
  }

  STORAGE_PROVIDER_DEFINITIONS.forEach((provider) => {
    if (!storage.providers[provider.id]) {
      storage.providers[provider.id] = {
        providerId: provider.id,
        configured: provider.id === "local",
        mode: provider.authMode,
        credentialsMasked: {},
        oauthSession: null,
        updatedAt: nowIso(),
      };
    }
    if (!storage.objects[provider.id] || typeof storage.objects[provider.id] !== "object") {
      storage.objects[provider.id] = {};
    }
  });

  if (!storage.activeProjectId) {
    storage.activeProjectId = "default";
  }

  if (!storage.projects[storage.activeProjectId]) {
    const rootPath = "Text2LLM/default";
    storage.projects[storage.activeProjectId] = {
      id: storage.activeProjectId,
      name: "default",
      rootPath,
      defaultProviderId: "local",
      containers: buildProjectContainers(rootPath),
      policies: {
        syncMode: "manual",
        syncEverySteps: 500,
        syncEveryMinutes: 15,
        retentionKeepLast: 5,
      },
      replication: {
        enabled: false,
        primaryProviderId: "local",
        backupProviderId: null,
      },
      updatedAt: nowIso(),
    };
  }

  return storage;
}

function getActiveStorageProject(storage) {
  const activeId = String(storage.activeProjectId || "default");
  return storage.projects[activeId] || null;
}

function ensureStorageProject(storage, projectName, defaultProviderId = "local", rootPath = "") {
  const safeName = String(projectName || "default").trim() || "default";
  const projectId = normalizeProviderId(safeName).replace(/[^a-z0-9-]/g, "-") || "default";
  const nextRootPath = String(rootPath || `Text2LLM/${safeName}`).trim() || `Text2LLM/${safeName}`;

  const existing = storage.projects[projectId];
  if (!existing) {
    storage.projects[projectId] = {
      id: projectId,
      name: safeName,
      rootPath: nextRootPath,
      defaultProviderId,
      containers: buildProjectContainers(nextRootPath),
      policies: {
        syncMode: "manual",
        syncEverySteps: 500,
        syncEveryMinutes: 15,
        retentionKeepLast: 5,
      },
      replication: {
        enabled: false,
        primaryProviderId: defaultProviderId,
        backupProviderId: null,
      },
      updatedAt: nowIso(),
    };
  } else {
    existing.name = safeName;
    existing.defaultProviderId = defaultProviderId;
    existing.rootPath = nextRootPath;
    existing.containers = existing.containers && typeof existing.containers === "object"
      ? existing.containers
      : buildProjectContainers(nextRootPath);
    STORAGE_CONTAINER_BLUEPRINTS.forEach((container) => {
      const current = existing.containers[container.id] || {};
      existing.containers[container.id] = {
        id: container.id,
        name: container.name,
        purpose: container.purpose,
        path: `${nextRootPath}/${container.name}/`,
        artifactCount: Number(current.artifactCount || 0),
        bytesUsed: Number(current.bytesUsed || 0),
        lastArtifactAt: current.lastArtifactAt || null,
        lastRestoredAt: current.lastRestoredAt || null,
      };
    });
    existing.updatedAt = nowIso();
  }

  storage.activeProjectId = projectId;
  return storage.projects[projectId];
}

function buildStorageAdapter(storage, providerId) {
  const bucket = storage.objects[providerId] || (storage.objects[providerId] = {});

  return {
    put({ key, record }) {
      bucket[key] = { ...record, key, updatedAt: nowIso() };
      return bucket[key];
    },
    get(key) {
      return bucket[key] || null;
    },
    list(prefix = "") {
      const items = Object.values(bucket);
      if (!prefix) {
        return items;
      }
      return items.filter((item) => String(item.key || "").startsWith(prefix));
    },
    delete(key) {
      if (!bucket[key]) {
        return false;
      }
      delete bucket[key];
      return true;
    },
    exists(key) {
      return Boolean(bucket[key]);
    },
    multipartUpload({ key, record, parts = 1 }) {
      return this.put({
        key,
        record: {
          ...record,
          multipart: {
            enabled: true,
            parts: Math.max(1, Number(parts || 1)),
          },
        },
      });
    },
    presign(key) {
      return `signed://${providerId}/${encodeURIComponent(String(key || ""))}`;
    },
  };
}

function computeStorageChecksum(seed) {
  return createHash("sha256").update(String(seed || "")).digest("hex").slice(0, 24);
}

function recomputeStorageProjectUsage(storage, project) {
  const projectId = project.id;
  const usageByContainer = Object.fromEntries(
    STORAGE_CONTAINER_BLUEPRINTS.map((container) => [container.id, { bytesUsed: 0, artifactCount: 0, lastArtifactAt: null }]),
  );

  for (const providerObjects of Object.values(storage.objects || {})) {
    for (const item of Object.values(providerObjects || {})) {
      if (item.projectId !== projectId) {
        continue;
      }
      const containerId = String(item.containerId || "");
      if (!usageByContainer[containerId]) {
        continue;
      }
      usageByContainer[containerId].bytesUsed += Number(item.sizeBytes || 0);
      usageByContainer[containerId].artifactCount += 1;
      if (!usageByContainer[containerId].lastArtifactAt || String(item.createdAt || "") > String(usageByContainer[containerId].lastArtifactAt || "")) {
        usageByContainer[containerId].lastArtifactAt = item.createdAt || null;
      }
    }
  }

  STORAGE_CONTAINER_BLUEPRINTS.forEach((container) => {
    const current = project.containers[container.id] || {};
    const usage = usageByContainer[container.id] || { bytesUsed: 0, artifactCount: 0, lastArtifactAt: null };
    project.containers[container.id] = {
      ...current,
      id: container.id,
      name: container.name,
      purpose: container.purpose,
      path: current.path || `${project.rootPath}/${container.name}/`,
      bytesUsed: usage.bytesUsed,
      artifactCount: usage.artifactCount,
      lastArtifactAt: usage.lastArtifactAt,
      lastRestoredAt: current.lastRestoredAt || null,
    };
  });
}

function computeStorageProviderUsage(storage, providerId) {
  const objects = Object.values(storage.objects[providerId] || {});
  const bytesUsed = objects.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0);
  const artifactCount = objects.length;
  return { bytesUsed, artifactCount };
}

function applyStorageRetention(storage, project, keepLast) {
  const keep = Math.max(1, Number(keepLast || 5));
  const checkpointRecords = [];

  for (const [providerId, providerObjects] of Object.entries(storage.objects || {})) {
    for (const [key, record] of Object.entries(providerObjects || {})) {
      if (record.projectId === project.id && record.containerId === "checkpoints") {
        checkpointRecords.push({ providerId, key, record });
      }
    }
  }

  checkpointRecords.sort((a, b) => String(b.record.createdAt || "").localeCompare(String(a.record.createdAt || "")));
  const toDelete = checkpointRecords.slice(keep);

  toDelete.forEach((entry) => {
    delete storage.objects[entry.providerId][entry.key];
  });

  return {
    deletedCount: toDelete.length,
    keptCount: Math.min(keep, checkpointRecords.length),
  };
}

function summarizeStorageState(storage, project) {
  recomputeStorageProjectUsage(storage, project);

  const providers = STORAGE_PROVIDER_DEFINITIONS.map((provider) => {
    const account = storage.providers[provider.id] || {};
    const usage = computeStorageProviderUsage(storage, provider.id);
    const quotaBytes = toStorageBytes(provider.quotaGb);
    const freeBytes = Math.max(0, quotaBytes - usage.bytesUsed);
    const usageRatio = quotaBytes > 0 ? usage.bytesUsed / quotaBytes : 0;
    const estimatedMonthlyCostUsd = Number(((usage.bytesUsed / (1024 ** 3)) * Number(provider.costPerGbMonthUsd || 0)).toFixed(2));

    return {
      id: provider.id,
      name: provider.name,
      configured: Boolean(account.configured),
      mode: account.mode || provider.authMode,
      supportsOAuth: provider.supportsOAuth,
      authFields: provider.authFields,
      updatedAt: account.updatedAt || null,
      quota: {
        quotaGb: provider.quotaGb,
        bytesUsed: usage.bytesUsed,
        freeBytes,
        usageRatio: Number(usageRatio.toFixed(4)),
      },
      artifactCount: usage.artifactCount,
      estimatedMonthlyCostUsd,
      lowSpace: usageRatio >= 0.9,
    };
  });

  const totalMonthlyCostUsd = Number(providers.reduce((sum, provider) => sum + Number(provider.estimatedMonthlyCostUsd || 0), 0).toFixed(2));

  return {
    project,
    providers,
    totalMonthlyCostUsd,
    syncJobs: storage.syncJobs.slice(0, 20),
    restoreJobs: storage.restoreJobs.slice(0, 20),
  };
}

app.get("/api/instances/providers", async (req, res) => {
  try {
    const config = await loadWorkspaceConfig();
    const configEnv = config.env || {};

    const providers = AI_PROVIDERS.map(p => {
      const processedOptions = p.options.map(opt => {
        const envValue = process.env[opt.envKey] || configEnv[opt.envKey] || "";
        const oauthConfigured = opt.type === "oauth"
          ? isOAuthProviderConfigured(config, opt.oauthProviderId || p.id)
          : false;
        return {
          ...opt,
          configured: oauthConfigured || Boolean(envValue.trim()),
        };
      });

      const isConfigured = processedOptions.some(opt => opt.configured);
      
      return {
        ...p,
        options: processedOptions,
        configured: isConfigured,
      };
    });

    res.json({ ok: true, providers });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/instances/provider/oauth", async (req, res) => {
  try {
    const { providerId, optionId } = req.body || {};
    if (!providerId || !optionId) {
      return res.status(400).json({ ok: false, error: "providerId and optionId are required" });
    }

    const provider = AI_PROVIDERS.find((p) => p.id === providerId);
    if (!provider) {
      return res.status(404).json({ ok: false, error: "Unknown provider" });
    }

    const option = provider.options.find((o) => o.id === optionId);
    if (!option || option.type !== "oauth") {
      return res.status(400).json({ ok: false, error: "Unknown OAuth option" });
    }

    const oauthProvider = option.oauthProviderId || provider.id;
    const providerMap = {
      "google-gemini-cli": {
        pluginId: "google-gemini-cli-auth",
        providerId: "google-gemini-cli",
      },
      "google-antigravity": {
        pluginId: "google-antigravity-auth",
        providerId: "google-antigravity",
      },
      "openai-codex": {
        pluginId: "copilot-proxy",
        providerId: "openai-codex",
      },
    };

    const mapped = providerMap[oauthProvider];
    if (!mapped) {
      return res.status(400).json({
        ok: false,
        error: `${option.name} web OAuth is not wired yet.`,
      });
    }

    const currentConfig = await loadWorkspaceConfig();
    const nextConfig = ensurePluginEnabled(currentConfig, mapped.pluginId);
    await writeFile(workspaceConfig, JSON.stringify(nextConfig, null, 2) + "\n", "utf-8");

    // Create a background job for the OAuth process
    const jobId = `auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createAuthJob(jobId, mapped.providerId);
    addAuthLog(jobId, `Starting OAuth flow for ${option.name}...`);

    // Spawn the process in the background
    const args = [
      "scripts/run-node.mjs",
      "models",
      "auth",
      "login",
      "--provider",
      mapped.providerId,
    ];

    const env = {
      ...process.env,
      TEXT2LLM_CONFIG_PATH: process.env.TEXT2LLM_CONFIG_PATH || workspaceConfig,
    };

    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env,
      shell: false,
       // We want to capture stdout/stderr but pipe stdin if needed (though we can't easily pipe stdin in this async fire-and-forget model without more complex websocket logic, so we assume the CLI command outputs a URL for the user to visit)
    });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      addAuthLog(jobId, text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      addAuthLog(jobId, text, "warn");
    });

    child.on("error", (error) => {
      updateAuthJob(jobId, { status: "failed" });
      addAuthLog(jobId, `Process error: ${error.message}`, "error");
    });

    child.on("close", (code) => {
      if (code === 0) {
        updateAuthJob(jobId, { status: "completed", completedAt: new Date().toISOString() });
        addAuthLog(jobId, "Authentication completed successfully!");
      } else {
        updateAuthJob(jobId, { status: "failed", completedAt: new Date().toISOString() });
        addAuthLog(jobId, `Process exited with code ${code}`, "error");
      }
    });

    return res.json({
      ok: true,
      jobId,
      message: "OAuth process started",
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/auth/status", (req, res) => {
  const jobId = String(req.query.jobId || "").trim();
  if (!jobId) {
    return res.status(400).json({ ok: false, error: "jobId required" });
  }

  const job = authJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ ok: false, error: "Job not found" });
  }

  res.json({
    ok: true,
    job: {
      id: job.id,
      status: job.status,
      providerId: job.providerId,
      logs: job.logs,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    },
  });
});



app.post("/api/instances/provider/select", async (req, res) => {
  try {
    const { providerId, optionId, apiKey } = req.body || {};
    if (!providerId || !optionId) {
      return res.status(400).json({ ok: false, error: "providerId and optionId are required" });
    }
    const provider = AI_PROVIDERS.find(p => p.id === providerId);
    if (!provider) {
      return res.status(404).json({ ok: false, error: "Unknown provider" });
    }
    const option = provider.options.find(o => o.id === optionId);
    if (!option) {
      return res.status(404).json({ ok: false, error: "Unknown option" });
    }

    // Read, update, and write the config
    let config = {};
    try {
      const raw = await readFile(workspaceConfig, "utf-8");
      config = JSON.parse(raw);
    } catch { /* start fresh */ }

    if (!config.env) config.env = {};

    // Set the API key if provided
    if (apiKey && apiKey.trim()) {
      config.env[option.envKey] = apiKey.trim();
      // Also set it in the current process
      process.env[option.envKey] = apiKey.trim();
    }

    await writeFile(workspaceConfig, JSON.stringify(config, null, 2) + "\n", "utf-8");

    res.json({ ok: true, message: `${provider.name} (${option.name}) configured` });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/auth/test", async (req, res) => {
  try {
    const { providerId } = req.body || {};
    if (!providerId) return res.status(400).json({ ok: false, error: "providerId required" });

    // Test connection by listing models (lightweight operation)
    const args = [
      "scripts/run-node.mjs",
      "models",
      "list", 
      "--provider", providerId
    ];

    const start = Date.now();
    const result = await runTEXT2LLMCommand(args, { ...process.env });
    const latency = Date.now() - start;
    
    if (result.code === 0) {
      res.json({ ok: true, message: "Connection successful!", latency, details: result.stdout });
    } else {
      res.json({ ok: false, error: "Test failed", details: result.stderr || result.stdout });
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/auth/quota", async (req, res) => {
  try {
    const { providerId } = req.query || {};
    // Future: implement actual quota fetch via CLI
    res.json({ 
      ok: true, 
      quota: { 
        limit: "Unknown", 
        usage: "Unknown", 
        remaining: "Available" 
      } 
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/instances/storage/state", async (_req, res) => {
  try {
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const storage = ensureStorageState(config);
    const project = getActiveStorageProject(storage);
    if (!project) {
      return res.status(500).json({ ok: false, error: "Active storage project missing" });
    }

    const summary = summarizeStorageState(storage, project);
    return res.json({ ok: true, ...summary });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/storage/provider/configure", async (req, res) => {
  try {
    const { providerId, credentials } = req.body || {};
    const provider = STORAGE_PROVIDER_DEFINITIONS.find((item) => item.id === providerId);
    if (!provider) {
      return res.status(404).json({ ok: false, error: "Unknown storage provider" });
    }
    if (provider.authMode === "none") {
      return res.json({ ok: true, message: `${provider.name} is always available` });
    }

    const payload = credentials && typeof credentials === "object" ? credentials : {};
    const missing = provider.authFields
      .map((field) => field.key)
      .filter((key) => !String(payload[key] || "").trim());
    if (missing.length > 0) {
      return res.status(400).json({ ok: false, error: `Missing credentials: ${missing.join(", ")}` });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const storage = ensureStorageState(config);
    storage.providers[providerId] = {
      providerId,
      configured: true,
      mode: "token",
      credentialsMasked: Object.fromEntries(
        provider.authFields.map((field) => [field.key, maskSecret(payload[field.key])]),
      ),
      oauthSession: null,
      updatedAt: nowIso(),
    };

    await saveWorkspaceConfig(config);
    return res.json({ ok: true, message: `${provider.name} configured` });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// Google Drive configuration
const GOOGLE_DRIVE_CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID;
const GOOGLE_DRIVE_CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
const GOOGLE_DRIVE_REDIRECT_URI = process.env.GOOGLE_DRIVE_REDIRECT_URI || "https://text2llm.in/auth/google/callback";

app.post("/api/instances/storage/provider/oauth", async (req, res) => {
  try {
    const { providerId } = req.body || {};
    const provider = STORAGE_PROVIDER_DEFINITIONS.find((item) => item.id === providerId);
    if (!provider) {
      return res.status(404).json({ ok: false, error: "Unknown storage provider" });
    }
    if (!provider.supportsOAuth) {
      return res.status(400).json({ ok: false, error: "Provider does not support OAuth" });
    }

    if (providerId === "google-drive") {
       if (!GOOGLE_DRIVE_CLIENT_ID) {
           return res.status(500).json({ ok: false, error: "Server missing GOOGLE_DRIVE_CLIENT_ID" });
       }
       
       const scope = [
           "https://www.googleapis.com/auth/drive.file",
           "https://www.googleapis.com/auth/userinfo.email"
       ].join(" ");
       
       const state = Buffer.from(JSON.stringify({
           providerId,
           nonce: Math.random().toString(36).substring(7)
       })).toString('base64');

       const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + 
           `client_id=${encodeURIComponent(GOOGLE_DRIVE_CLIENT_ID)}` +
           `&redirect_uri=${encodeURIComponent(GOOGLE_DRIVE_REDIRECT_URI)}` +
           `&response_type=code` +
           `&scope=${encodeURIComponent(scope)}` +
           `&access_type=offline` + 
           `&prompt=consent` +
           `&state=${encodeURIComponent(state)}`;

       return res.json({ ok: true, url: authUrl });
    }

    // Fallback for other potential oauth providers (mocks)
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const storage = ensureStorageState(config);
    storage.providers[providerId] = {
      providerId,
      configured: true,
      mode: "oauth",
      credentialsMasked: {},
      oauthSession: {
        connectedAt: nowIso(),
        sessionId: `oauth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
      updatedAt: nowIso(),
    };

    await saveWorkspaceConfig(config);
    return res.json({ ok: true, message: `${provider.name} connected (mock)` });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/auth/google/callback", async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
        return res.status(400).send(`Google Auth Error: ${error}`);
    }

    if (!code) {
        return res.status(400).send("Missing authorization code");
    }

    try {
        let decodedState = {};
        try {
            decodedState = JSON.parse(Buffer.from(state, 'base64').toString());
        } catch (e) {
            // ignore invalid state parse
        }
        
        const tokenParams = new URLSearchParams();
        tokenParams.append('client_id', GOOGLE_DRIVE_CLIENT_ID);
        tokenParams.append('client_secret', GOOGLE_DRIVE_CLIENT_SECRET);
        tokenParams.append('code', code);
        tokenParams.append('grant_type', 'authorization_code');
        tokenParams.append('redirect_uri', GOOGLE_DRIVE_REDIRECT_URI);

        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: tokenParams
        });
        
        const tokenData = await tokenRes.json();
        
        if (!tokenRes.ok) {
            throw new Error(tokenData.error_description || tokenData.error || "Failed to exchange token");
        }

        // Get user info for identification (optional but good for UX)
        // const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        //     headers: { Authorization: `Bearer ${tokenData.access_token}` }
        // });
        // const userData = await userRes.json();

        // Save to config
        const config = ensureGpuConfigShape(await loadWorkspaceConfig());
        const storage = ensureStorageState(config);
        
        storage.providers["google-drive"] = {
            providerId: "google-drive",
            configured: true,
            mode: "oauth",
            credentialsMasked: {
                // Do not store raw tokens in credentialsMasked, or mask them heavily if you do
                expiryDate: Date.now() + (tokenData.expires_in * 1000)
            },
            oauthSession: {
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token, // Critical for offline access
                expiryDate: Date.now() + (tokenData.expires_in * 1000),
                connectedAt: nowIso(),
                scope: tokenData.scope,
                tokenType: tokenData.token_type
            },
            updatedAt: nowIso(),
        };

        await saveWorkspaceConfig(config);

        // Redirect back to the app - assuming app is at /
        // We can add a query param to trigger a status message if we want
        res.redirect("/?storage_connected=true");

    } catch (err) {
        console.error("OAuth Callback Error:", err);
        res.status(500).send(`Authentication failed: ${err.message}`);
    }
});

app.post("/api/instances/storage/project", async (req, res) => {
  try {
    const { projectName, defaultProviderId, rootPath } = req.body || {};
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const storage = ensureStorageState(config);
    const providerId = String(defaultProviderId || "local");

    if (!STORAGE_PROVIDER_DEFINITIONS.some((provider) => provider.id === providerId)) {
      return res.status(400).json({ ok: false, error: "Invalid default provider" });
    }

    const project = ensureStorageProject(storage, projectName, providerId, rootPath);
    if (!project.replication || typeof project.replication !== "object") {
      project.replication = { enabled: false, primaryProviderId: providerId, backupProviderId: null };
    }
    if (!project.replication.primaryProviderId) {
      project.replication.primaryProviderId = providerId;
    }
    project.updatedAt = nowIso();
    await saveWorkspaceConfig(config);

    return res.json({ ok: true, project });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/storage/policies", async (req, res) => {
  try {
    const {
      syncMode,
      syncEverySteps,
      syncEveryMinutes,
      retentionKeepLast,
    } = req.body || {};

    const mode = String(syncMode || "manual").toLowerCase();
    if (!["manual", "steps", "minutes"].includes(mode)) {
      return res.status(400).json({ ok: false, error: "Invalid sync mode" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const storage = ensureStorageState(config);
    const project = getActiveStorageProject(storage);
    if (!project) {
      return res.status(500).json({ ok: false, error: "Active storage project missing" });
    }

    project.policies = {
      syncMode: mode,
      syncEverySteps: Math.max(1, Number(syncEverySteps || project.policies?.syncEverySteps || 500)),
      syncEveryMinutes: Math.max(1, Number(syncEveryMinutes || project.policies?.syncEveryMinutes || 15)),
      retentionKeepLast: Math.max(1, Number(retentionKeepLast || project.policies?.retentionKeepLast || 5)),
    };
    project.updatedAt = nowIso();

    await saveWorkspaceConfig(config);
    return res.json({ ok: true, policies: project.policies });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/storage/replication", async (req, res) => {
  try {
    const { enabled, primaryProviderId, backupProviderId } = req.body || {};
    if (!STORAGE_PROVIDER_DEFINITIONS.some((provider) => provider.id === primaryProviderId)) {
      return res.status(400).json({ ok: false, error: "Invalid primary provider" });
    }
    if (backupProviderId && !STORAGE_PROVIDER_DEFINITIONS.some((provider) => provider.id === backupProviderId)) {
      return res.status(400).json({ ok: false, error: "Invalid backup provider" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const storage = ensureStorageState(config);
    const project = getActiveStorageProject(storage);
    if (!project) {
      return res.status(500).json({ ok: false, error: "Active storage project missing" });
    }

    project.replication = {
      enabled: Boolean(enabled),
      primaryProviderId,
      backupProviderId: backupProviderId || null,
    };
    project.updatedAt = nowIso();

    await saveWorkspaceConfig(config);
    return res.json({ ok: true, replication: project.replication });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/storage/artifact/upload", async (req, res) => {
  try {
    const { containerId, sizeBytes = 0, name, providerId } = req.body || {};
    const targetContainer = String(containerId || "").trim();
    if (!STORAGE_CONTAINER_BLUEPRINTS.some((container) => container.id === targetContainer)) {
      return res.status(400).json({ ok: false, error: "Invalid container id" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const storage = ensureStorageState(config);
    const project = getActiveStorageProject(storage);
    if (!project) {
      return res.status(500).json({ ok: false, error: "Active storage project missing" });
    }

    const selectedProvider = String(providerId || project.defaultProviderId || "local");
    const providerAccount = storage.providers[selectedProvider];
    if (!providerAccount?.configured) {
      return res.status(400).json({ ok: false, error: "Target provider is not configured" });
    }

    const adapter = buildStorageAdapter(storage, selectedProvider);
    const timestamp = Date.now();
    const safeName = String(name || `${targetContainer}-${timestamp}.bin`).trim() || `${targetContainer}-${timestamp}.bin`;
    const key = `${project.rootPath}/${targetContainer}/${safeName}`;
    const payloadSize = Math.max(1, Number(sizeBytes || 1024 * 1024));
    const artifact = {
      id: `artifact-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      providerId: selectedProvider,
      projectId: project.id,
      containerId: targetContainer,
      sizeBytes: payloadSize,
      checksum: computeStorageChecksum(`${key}:${payloadSize}:${timestamp}`),
      createdAt: nowIso(),
      replicatedFrom: null,
    };

    const shouldMultipart = payloadSize > 512 * 1024 * 1024;
    const stored = shouldMultipart
      ? adapter.multipartUpload({ key, record: artifact, parts: Math.ceil(payloadSize / (128 * 1024 * 1024)) })
      : adapter.put({ key, record: artifact });

    recomputeStorageProjectUsage(storage, project);
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, artifact: stored, presignedUrl: adapter.presign(key) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/storage/checkpoint/sync", async (req, res) => {
  try {
    const { step, sizeBytes } = req.body || {};
    const checkpointStep = Math.max(1, Number(step || 1));
    const checkpointSize = Math.max(1, Number(sizeBytes || 2 * 1024 * 1024 * 1024));

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const storage = ensureStorageState(config);
    const project = getActiveStorageProject(storage);
    if (!project) {
      return res.status(500).json({ ok: false, error: "Active storage project missing" });
    }

    const primaryProvider = String(project.replication?.primaryProviderId || project.defaultProviderId || "local");
    const primaryAccount = storage.providers[primaryProvider];
    if (!primaryAccount?.configured) {
      return res.status(400).json({ ok: false, error: "Primary provider is not configured" });
    }

    const checkpointName = `step-${checkpointStep}.ckpt`;
    const key = `${project.rootPath}/checkpoints/${checkpointName}`;
    const artifactSeed = `${project.id}:${checkpointStep}:${checkpointSize}:${Date.now()}`;
    const baseRecord = {
      id: `ckpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      providerId: primaryProvider,
      projectId: project.id,
      containerId: "checkpoints",
      step: checkpointStep,
      sizeBytes: checkpointSize,
      checksum: computeStorageChecksum(artifactSeed),
      createdAt: nowIso(),
      replicatedFrom: null,
    };

    const primaryAdapter = buildStorageAdapter(storage, primaryProvider);
    primaryAdapter.multipartUpload({
      key,
      record: baseRecord,
      parts: Math.max(2, Math.ceil(checkpointSize / (256 * 1024 * 1024))),
    });

    let replicated = null;
    if (project.replication?.enabled && project.replication?.backupProviderId && project.replication.backupProviderId !== primaryProvider) {
      const backupAccount = storage.providers[project.replication.backupProviderId];
      if (backupAccount?.configured) {
        const backupAdapter = buildStorageAdapter(storage, project.replication.backupProviderId);
        const backupRecord = {
          ...baseRecord,
          id: `ckpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          providerId: project.replication.backupProviderId,
          replicatedFrom: primaryProvider,
        };
        replicated = backupAdapter.multipartUpload({
          key,
          record: backupRecord,
          parts: Math.max(2, Math.ceil(checkpointSize / (256 * 1024 * 1024))),
        });
      }
    }

    const retention = applyStorageRetention(storage, project, project.policies?.retentionKeepLast || 5);
    recomputeStorageProjectUsage(storage, project);

    const syncJob = {
      id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId: project.id,
      kind: "checkpoint",
      step: checkpointStep,
      primaryProvider,
      backupProvider: replicated?.providerId || null,
      checkpointSize,
      retention,
      createdAt: nowIso(),
      status: "completed",
    };
    storage.syncJobs.unshift(syncJob);
    if (storage.syncJobs.length > 200) {
      storage.syncJobs = storage.syncJobs.slice(0, 200);
    }

    project.updatedAt = nowIso();
    await saveWorkspaceConfig(config);

    return res.json({
      ok: true,
      sync: syncJob,
      checkpoint: baseRecord,
      replicated,
      project,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/storage/restore/latest", async (req, res) => {
  try {
    const { providerId } = req.body || {};
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const storage = ensureStorageState(config);
    const project = getActiveStorageProject(storage);
    if (!project) {
      return res.status(500).json({ ok: false, error: "Active storage project missing" });
    }

    const targetProviderId = String(providerId || project.replication?.primaryProviderId || project.defaultProviderId || "local");
    const adapter = buildStorageAdapter(storage, targetProviderId);
    const candidates = adapter
      .list(`${project.rootPath}/checkpoints/`)
      .filter((item) => item.projectId === project.id && item.containerId === "checkpoints")
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    const latest = candidates[0] || null;
    if (!latest) {
      return res.status(404).json({ ok: false, error: "No checkpoint found for restore" });
    }

    const checksumValid = Boolean(latest.checksum);
    if (!checksumValid) {
      return res.status(409).json({ ok: false, error: "Integrity check failed: missing checksum" });
    }

    project.containers.checkpoints.lastRestoredAt = nowIso();
    project.updatedAt = nowIso();

    const restoreJob = {
      id: `restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId: project.id,
      providerId: targetProviderId,
      checkpointId: latest.id,
      checksum: latest.checksum,
      restoredAt: nowIso(),
      status: "completed",
    };
    storage.restoreJobs.unshift(restoreJob);
    if (storage.restoreJobs.length > 200) {
      storage.restoreJobs = storage.restoreJobs.slice(0, 200);
    }

    await saveWorkspaceConfig(config);
    return res.json({ ok: true, restore: restoreJob, checkpoint: latest });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

/* ── Storage: list artifacts ── */
app.get("/api/instances/storage/artifacts", async (req, res) => {
  try {
    const { containerId, providerId } = req.query || {};
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const storage = ensureStorageState(config);
    const project = getActiveStorageProject(storage);
    if (!project) {
      return res.status(500).json({ ok: false, error: "Active storage project missing" });
    }

    const artifacts = [];
    const providerIds = providerId ? [providerId] : Object.keys(storage.objects);
    for (const pid of providerIds) {
      const bucket = storage.objects[pid] || {};
      for (const item of Object.values(bucket)) {
        if (item.projectId !== project.id) continue;
        if (containerId && item.containerId !== containerId) continue;
        artifacts.push({ ...item, providerId: pid });
      }
    }

    artifacts.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return res.json({ ok: true, artifacts });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

/* ── Storage: delete artifact ── */
app.post("/api/instances/storage/artifact/delete", async (req, res) => {
  try {
    const { artifactId, providerId } = req.body || {};
    if (!artifactId) {
      return res.status(400).json({ ok: false, error: "artifactId is required" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const storage = ensureStorageState(config);
    const project = getActiveStorageProject(storage);
    if (!project) {
      return res.status(500).json({ ok: false, error: "Active storage project missing" });
    }

    let deleted = false;
    const searchProviders = providerId ? [providerId] : Object.keys(storage.objects);
    for (const pid of searchProviders) {
      const bucket = storage.objects[pid] || {};
      for (const [key, item] of Object.entries(bucket)) {
        if (item.id === artifactId && item.projectId === project.id) {
          delete bucket[key];
          deleted = true;
          break;
        }
      }
      if (deleted) break;
    }

    if (!deleted) {
      return res.status(404).json({ ok: false, error: "Artifact not found" });
    }

    recomputeStorageProjectUsage(storage, project);
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, message: "Artifact deleted" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

/* ── Storage: disconnect provider ── */
app.post("/api/instances/storage/provider/disconnect", async (req, res) => {
  try {
    const { providerId } = req.body || {};
    const provider = STORAGE_PROVIDER_DEFINITIONS.find((p) => p.id === providerId);
    if (!provider) {
      return res.status(404).json({ ok: false, error: "Unknown provider" });
    }
    if (provider.id === "local") {
      return res.status(400).json({ ok: false, error: "Cannot disconnect Local Workspace" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const storage = ensureStorageState(config);

    storage.providers[providerId] = {
      providerId,
      configured: false,
      mode: provider.authMode,
      credentialsMasked: {},
      oauthSession: null,
      updatedAt: nowIso(),
    };

    // Clean up artifacts from this provider
    const bucket = storage.objects[providerId] || {};
    const keysToRemove = Object.keys(bucket);
    keysToRemove.forEach((key) => delete bucket[key]);

    const project = getActiveStorageProject(storage);
    if (project) {
      recomputeStorageProjectUsage(storage, project);
      // Reset replication if this provider was primary or backup
      if (project.replication?.primaryProviderId === providerId) {
        project.replication.primaryProviderId = project.defaultProviderId || "local";
      }
      if (project.replication?.backupProviderId === providerId) {
        project.replication.backupProviderId = null;
        project.replication.enabled = false;
      }
    }

    await saveWorkspaceConfig(config);
    return res.json({ ok: true, message: `${provider.name} disconnected`, removedArtifacts: keysToRemove.length });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

/* ── Storage: clear container ── */
app.post("/api/instances/storage/container/clear", async (req, res) => {
  try {
    const { containerId } = req.body || {};
    if (!STORAGE_CONTAINER_BLUEPRINTS.some((c) => c.id === containerId)) {
      return res.status(400).json({ ok: false, error: "Invalid container id" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const storage = ensureStorageState(config);
    const project = getActiveStorageProject(storage);
    if (!project) {
      return res.status(500).json({ ok: false, error: "Active storage project missing" });
    }

    let removedCount = 0;
    for (const providerObjects of Object.values(storage.objects || {})) {
      for (const [key, item] of Object.entries(providerObjects || {})) {
        if (item.projectId === project.id && item.containerId === containerId) {
          delete providerObjects[key];
          removedCount++;
        }
      }
    }

    recomputeStorageProjectUsage(storage, project);
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, message: `Cleared ${removedCount} artifacts from ${containerId}`, removedCount });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/instances/gpu/providers", async (_req, res) => {
  try {
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const providers = gpuAdapters.listProviders().map((provider) => {
      const adapter = gpuAdapters.getAdapter(provider.id);
      const account = getProviderAccount(config, provider.id);
      let check = { ok: false };
      if (account?.credentialRef) {
        try {
          const { key } = ensureGpuMasterKey(config);
          const credentials = decryptCredentialEnvelope(account.credentialRef, key);
          check = adapter.validateCredentials(credentials || {});
        } catch {
          check = { ok: false };
        }
      }

      const permissionTemplate = adapter.getProviderInfo().requiredPermissions || [];
      const missingPermissions = account?.permissions?.missing || permissionTemplate;
      return {
        id: provider.id,
        name: provider.name,
        description: provider.description,
        authFields: provider.authFields,
        regions: adapter.listRegions(),
        gpuTypes: adapter.listGpuTypes(),
        requiredPermissions: permissionTemplate,
        tokenGuidance: adapter.getProviderInfo().tokenGuidance,
        configured: check.ok,
        credentialStatus: account?.status || "not-configured",
        lastValidatedAt: account?.lastValidatedAt || null,
        permissionsMissingCount: missingPermissions.length,
      };
    });

    res.json({ ok: true, providers });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/gpu/provider/configure", async (req, res) => {
  try {
    const { providerId, credentials, grantedPermissions } = req.body || {};
    const adapter = gpuAdapters.getAdapter(providerId);
    if (!adapter) {
      return res.status(404).json({ ok: false, error: "Unknown GPU provider" });
    }

    const payload = credentials && typeof credentials === "object" ? credentials : {};
    const validation = adapter.validateCredentials(payload);
    if (!validation.ok) {
      return res.status(400).json({ ok: false, error: validation.error || "Invalid credentials" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const { key, source, configChanged } = ensureGpuMasterKey(config);
    const nextCredentials = {};
    for (const field of adapter.getProviderInfo().authFields) {
      if (payload[field.key] !== undefined) {
        nextCredentials[field.key] = String(payload[field.key]).trim();
      }
    }

    const requiredPermissions = adapter.getProviderInfo().requiredPermissions || [];
    const granted = sanitizeGrantedPermissions(grantedPermissions);
    const effectiveGranted = granted.length > 0 ? granted : requiredPermissions;
    const permissions = evaluatePermissionCoverage(requiredPermissions, effectiveGranted);

    const account = {
      id: `gpuacct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: "local-user",
      providerId,
      credentialRef: encryptCredentialEnvelope(nextCredentials, key),
      status: permissions.missing.length ? "permissions-missing" : "valid",
      lastValidatedAt: nowIso(),
      updatedAt: nowIso(),
      permissions,
      tokenPolicy: {
        mode: "prefer-short-lived",
        maxTtlMinutes: 60,
      },
    };

    upsertProviderAccount(config, account);
    config.gpu.providers[providerId] = {
      accountId: account.id,
      status: account.status,
      updatedAt: account.updatedAt,
      lastValidatedAt: account.lastValidatedAt,
    };
    pushGpuAuditLog(config, "provider.credentials_updated", {
      providerId,
      accountId: account.id,
      status: account.status,
      permissionsMissing: account.permissions.missing,
    });
    await saveWorkspaceConfig(config);

    res.json({
      ok: true,
      message: `${adapter.getProviderInfo().name} credentials validated and stored securely`,
      account: normalizeProviderAccount(account),
      security: {
        encryptedAtRest: true,
        envelope: {
          kmsProvider: GPU_KMS_PROVIDER,
          keyId: GPU_KMS_KEY_ID,
          masterKeySource: source,
        },
        generatedMasterKey: configChanged,
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/gpu/provider/test", async (req, res) => {
  try {
    const { providerId, credentials, grantedPermissions } = req.body || {};
    const adapter = gpuAdapters.getAdapter(providerId);
    if (!adapter) {
      return res.status(404).json({ ok: false, error: "Unknown GPU provider" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const requiredPermissions = adapter.getProviderInfo().requiredPermissions || [];

    let credentialPayload = credentials && typeof credentials === "object" ? credentials : null;
    let account = getProviderAccount(config, providerId);
    if (!credentialPayload) {
      if (!account?.credentialRef) {
        return res.status(400).json({ ok: false, error: "No saved credentials found for provider" });
      }
      const { key } = ensureGpuMasterKey(config);
      credentialPayload = decryptCredentialEnvelope(account.credentialRef, key);
    }

    const validation = adapter.validateCredentials(credentialPayload);
    if (!validation.ok) {
      return res.status(400).json({ ok: false, error: validation.error || "Invalid credentials" });
    }

    const candidateGranted = sanitizeGrantedPermissions(grantedPermissions);
    const baselineGranted = account?.permissions?.granted || [];
    const effectiveGranted = candidateGranted.length > 0
      ? candidateGranted
      : (baselineGranted.length > 0 ? baselineGranted : requiredPermissions);
    const permissions = evaluatePermissionCoverage(requiredPermissions, effectiveGranted);

    const response = {
      ok: permissions.missing.length === 0,
      providerId,
      validation: {
        ok: true,
        checkedAt: nowIso(),
      },
      reachability: {
        ok: true,
        latencyMs: 60 + Math.floor(Math.random() * 160),
      },
      permissions,
      security: {
        tokenGuidance: adapter.getProviderInfo().tokenGuidance,
        leastPrivilegeTemplate: requiredPermissions,
      },
    };

    if (account) {
      account = {
        ...account,
        permissions,
        status: permissions.missing.length ? "permissions-missing" : "valid",
        lastValidatedAt: nowIso(),
        updatedAt: nowIso(),
      };
      upsertProviderAccount(config, account);
      config.gpu.providers[providerId] = {
        accountId: account.id,
        status: account.status,
        updatedAt: account.updatedAt,
        lastValidatedAt: account.lastValidatedAt,
      };
      await saveWorkspaceConfig(config);
    }

    return res.json(response);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/instances/gpu/provider/:providerId/capabilities", async (req, res) => {
  try {
    const adapter = gpuAdapters.getAdapter(req.params.providerId);
    if (!adapter) {
      return res.status(404).json({ ok: false, error: "Unknown GPU provider" });
    }

    res.json({
      ok: true,
      provider: adapter.getProviderInfo(),
      regions: adapter.listRegions(),
      gpuTypes: adapter.listGpuTypes(),
      runtimeTemplates: gpuAdapters.listRuntimeTemplates(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/instances/gpu/runtime/templates", async (_req, res) => {
  try {
    return res.json({ ok: true, templates: gpuAdapters.listRuntimeTemplates() });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/instances/gpu/instances", async (_req, res) => {
  try {
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const instances = config.gpu.instances.map((instance) => normalizeGpuInstance(instance));
    res.json({ ok: true, instances });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

/* ── Notebook cell API ── */
app.get("/api/notebook/cells", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const cells = ensureNotebookCells(config)
      .filter((cell) => recordProjectId(cell) === projectId)
      .map(normalizeCellRecord);
    return res.json({ ok: true, cells });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/notebook/cells", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    ensureNotebookCells(config);

    const type = String(req.body?.type || "code");
    const source = String(req.body?.source ?? "");
    const afterId = req.body?.afterId || null;
    const cell = makeCell(type, source, projectId);

    if (afterId) {
      const idx = config.notebook.cells.findIndex((c) => c.id === afterId && recordProjectId(c) === projectId);
      if (idx !== -1) {
        config.notebook.cells.splice(idx + 1, 0, cell);
      } else {
        config.notebook.cells.push(cell);
      }
    } else {
      config.notebook.cells.push(cell);
    }

    await saveWorkspaceConfig(config);
    return res.json({ ok: true, cell: normalizeCellRecord(cell) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.put("/api/notebook/cells/:cellId", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const cellId = String(req.params.cellId || "").trim();
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    ensureNotebookCells(config);

    const idx = config.notebook.cells.findIndex((c) => c.id === cellId && recordProjectId(c) === projectId);
    if (idx === -1) {
      return res.status(404).json({ ok: false, error: "Cell not found" });
    }

    const current = config.notebook.cells[idx];
    if (req.body?.source !== undefined) current.source = String(req.body.source);
    if (req.body?.type) current.type = req.body.type === "markdown" ? "markdown" : "code";
    current.updatedAt = nowIso();

    config.notebook.cells[idx] = current;
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, cell: normalizeCellRecord(current) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.delete("/api/notebook/cells/:cellId", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const cellId = String(req.params.cellId || "").trim();
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    ensureNotebookCells(config);

    const idx = config.notebook.cells.findIndex((c) => c.id === cellId && recordProjectId(c) === projectId);
    if (idx === -1) {
      return res.status(404).json({ ok: false, error: "Cell not found" });
    }

    config.notebook.cells.splice(idx, 1);
    await saveWorkspaceConfig(config);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/notebook/cells/:cellId/run", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const cellId = String(req.params.cellId || "").trim();
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    ensureNotebookCells(config);

    const idx = config.notebook.cells.findIndex((c) => c.id === cellId && recordProjectId(c) === projectId);
    if (idx === -1) {
      return res.status(404).json({ ok: false, error: "Cell not found" });
    }

    const cell = config.notebook.cells[idx];
    if (cell.type !== "code") {
      return res.status(400).json({ ok: false, error: "Only code cells can be run" });
    }

    config.notebook.cells[idx] = simulateCellExecution(cell);
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, cell: normalizeCellRecord(config.notebook.cells[idx]) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/notebook/run-all", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    ensureNotebookCells(config);

    config.notebook.cells = config.notebook.cells.map((cell) => {
      if (recordProjectId(cell) === projectId && cell.type === "code") return simulateCellExecution(cell);
      return cell;
    });

    await saveWorkspaceConfig(config);
    const cells = config.notebook.cells.map(normalizeCellRecord);
    return res.json({ ok: true, cells });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/notebook/clear-outputs", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    ensureNotebookCells(config);

    config.notebook.cells = config.notebook.cells.map((cell) => ({
      ...cell,
      ...(recordProjectId(cell) === projectId
        ? {
            outputs: [],
            executionCount: null,
            status: "idle",
            updatedAt: nowIso(),
          }
        : {}),
    }));

    await saveWorkspaceConfig(config);
    const cells = config.notebook.cells.map(normalizeCellRecord);
    return res.json({ ok: true, cells });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/data-studio/datasets", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const datasets = dataStudio.datasets
      .filter((dataset) => recordProjectId(dataset) === projectId)
      .map((dataset) => normalizeDataset(dataset));
    return res.json({ ok: true, datasets });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/data-studio/datasets", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const { name, sourceType, format, content, url } = req.body || {};
    let resolvedContent = String(content || "");
    let effectiveFormat = String(format || "auto");

    if (String(sourceType || "").toLowerCase() === "url") {
      const safeUrl = String(url || "").trim();
      if (!safeUrl) {
        return res.status(400).json({ ok: false, error: "URL is required for URL source" });
      }
      resolvedContent = await fetchRemoteTextContent(safeUrl);
      effectiveFormat = inferDataFormatFromUrl(safeUrl, format);
    }

    const rows = normalizeRowsFromInput({ content: resolvedContent, format: effectiveFormat });
    if (rows.length === 0) {
      return res.status(400).json({ ok: false, error: "No rows could be parsed from the provided input" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = createDatasetRecord({
      name,
      sourceType,
      format: effectiveFormat,
      rows,
      projectId,
    });

    dataStudio.datasets.unshift(dataset);
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/data-studio/library/resources", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const resources = await loadStoreResourcesByProject(projectId);
    return res.json({ ok: true, resources });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/data-studio/datasets/import/library", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const { resourceId, name, format = "auto" } = req.body || {};
    const normalizedResourceId = String(resourceId || "").trim();
    if (!normalizedResourceId) {
      return res.status(400).json({ ok: false, error: "resourceId is required" });
    }

    const resources = await loadStoreResourcesByProject(projectId);
    const resource = resources.find((item) => String(item?.id || "").trim() === normalizedResourceId);
    if (!resource) {
      return res.status(404).json({ ok: false, error: "Library resource not found" });
    }

    let rows = [];
    const source = String(resource?.source || "").toLowerCase();
    if (source === "huggingface") {
      const hfId = normalizedResourceId.startsWith("hf:dataset:")
        ? normalizedResourceId.slice("hf:dataset:".length)
        : String(resource?.name || "");
      try {
        rows = await fetchHuggingFaceDatasetRows(hfId);
      } catch {
        rows = [{ source: "huggingface", dataset: hfId, note: "Imported as metadata only; row sampling unavailable." }];
      }
    } else if (source === "zenodo") {
      const zenodoId = String(resource?.name || "").split("/").at(-1) || normalizedResourceId;
      rows = await fetchZenodoDatasetRows(zenodoId);
    } else if (resource?.url) {
      const text = await fetchRemoteTextContent(resource.url);
      rows = normalizeRowsFromInput({
        content: text,
        format: inferDataFormatFromUrl(String(resource.url || ""), format),
      });
    } else {
      rows = [{
        source: String(resource?.source || "library"),
        resourceId: normalizedResourceId,
        name: String(resource?.name || ""),
        url: String(resource?.url || ""),
        note: "Imported as metadata only",
      }];
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ ok: false, error: "No rows could be imported from selected library resource" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = createDatasetRecord({
      name: normalizeDatasetName(name, String(resource?.name || "Library Dataset")),
      sourceType: "library",
      format: String(format || "auto"),
      rows,
      projectId,
    });

    dataStudio.datasets.unshift(dataset);
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/data-studio/datasets/import/remote", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const { provider = "url", datasetId = "", url = "", name = "", format = "auto" } = req.body || {};
    if (!String(datasetId || "").trim() && !String(url || "").trim()) {
      return res.status(400).json({ ok: false, error: "datasetId or url is required" });
    }

    const rows = await resolveRowsFromRemoteSource({ provider, datasetId, url, format });
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ ok: false, error: "No rows were imported from remote source" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = createDatasetRecord({
      name: normalizeDatasetName(name, String(datasetId || "Remote Dataset")),
      sourceType: "remote",
      format: String(format || "auto"),
      rows,
      projectId,
    });
    dataStudio.datasets.unshift(dataset);
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/data-studio/datasets/:datasetId", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const datasetId = String(req.params.datasetId || "").trim();
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = findProjectDataset(dataStudio, projectId, datasetId);
    if (!dataset) {
      return res.status(404).json({ ok: false, error: "Dataset not found" });
    }

    if (!hasCompleteDatasetRowIds(dataset.rows)) {
      dataset.rows = ensureDatasetRowIds(dataset.rows, { forceNew: true });
      dataset.updatedAt = nowIso();
      await saveWorkspaceConfig(config);
    }
    dataset.stats = computeDatasetStats(dataset.rows || []);
    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/data-studio/datasets/:datasetId/rows", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const datasetId = String(req.params.datasetId || "").trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize || 25)));
    const query = String(req.query.q || "").trim().toLowerCase();

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = findProjectDataset(dataStudio, projectId, datasetId);
    if (!dataset) {
      return res.status(404).json({ ok: false, error: "Dataset not found" });
    }

    if (!hasCompleteDatasetRowIds(dataset.rows)) {
      dataset.rows = ensureDatasetRowIds(dataset.rows, { forceNew: true });
      dataset.updatedAt = nowIso();
      await saveWorkspaceConfig(config);
    }
    let rows = Array.isArray(dataset.rows) ? dataset.rows : [];
    if (query) {
      rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query));
    }

    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const pagedRows = rows.slice(start, start + pageSize);

    return res.json({
      ok: true,
      rows: pagedRows,
      page: safePage,
      pageSize,
      totalRows,
      totalPages,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/data-studio/datasets/:datasetId/rows", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const datasetId = String(req.params.datasetId || "").trim();
    const incomingRow = req.body?.row;
    const row = incomingRow && typeof incomingRow === "object" && !Array.isArray(incomingRow)
      ? { ...incomingRow }
      : {};

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = findProjectDataset(dataStudio, projectId, datasetId);
    if (!dataset) {
      return res.status(404).json({ ok: false, error: "Dataset not found" });
    }

    dataset.rows = ensureDatasetRowIds([...(Array.isArray(dataset.rows) ? dataset.rows : []), row], { forceNew: false });
    updateDatasetAfterMutation(dataset, "row:add");
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.patch("/api/data-studio/datasets/:datasetId/rows/:rowId", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const datasetId = String(req.params.datasetId || "").trim();
    const rowId = String(req.params.rowId || "").trim();
    const updates = req.body?.updates && typeof req.body.updates === "object" && !Array.isArray(req.body.updates)
      ? req.body.updates
      : {};
    if (!rowId) {
      return res.status(400).json({ ok: false, error: "rowId is required" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = findProjectDataset(dataStudio, projectId, datasetId);
    if (!dataset) {
      return res.status(404).json({ ok: false, error: "Dataset not found" });
    }

    const rows = ensureDatasetRowIds(dataset.rows, { forceNew: false });
    const index = rows.findIndex((row) => String(row?.__rowId || "") === rowId);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: "Row not found" });
    }

    rows[index] = {
      ...rows[index],
      ...Object.fromEntries(
        Object.entries(updates).map(([key, value]) => [String(key), value == null ? "" : value]),
      ),
      __rowId: rowId,
    };
    dataset.rows = rows;
    updateDatasetAfterMutation(dataset, "row:update");
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.delete("/api/data-studio/datasets/:datasetId/rows/:rowId", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const datasetId = String(req.params.datasetId || "").trim();
    const rowId = String(req.params.rowId || "").trim();
    if (!rowId) {
      return res.status(400).json({ ok: false, error: "rowId is required" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = findProjectDataset(dataStudio, projectId, datasetId);
    if (!dataset) {
      return res.status(404).json({ ok: false, error: "Dataset not found" });
    }

    const before = Array.isArray(dataset.rows) ? dataset.rows.length : 0;
    dataset.rows = ensureDatasetRowIds(dataset.rows, { forceNew: false }).filter(
      (row) => String(row?.__rowId || "") !== rowId,
    );
    if (dataset.rows.length === before) {
      return res.status(404).json({ ok: false, error: "Row not found" });
    }

    updateDatasetAfterMutation(dataset, "row:delete");
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/data-studio/datasets/:datasetId/columns", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const datasetId = String(req.params.datasetId || "").trim();
    const name = String(req.body?.name || "").trim();
    const defaultValue = req.body?.defaultValue ?? "";
    if (!name) {
      return res.status(400).json({ ok: false, error: "Column name is required" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = findProjectDataset(dataStudio, projectId, datasetId);
    if (!dataset) {
      return res.status(404).json({ ok: false, error: "Dataset not found" });
    }

    const rows = ensureDatasetRowIds(dataset.rows, { forceNew: false });
    const exists = rows.some((row) => Object.prototype.hasOwnProperty.call(row, name));
    if (exists) {
      return res.status(400).json({ ok: false, error: "Column already exists" });
    }

    dataset.rows = rows.map((row) => ({ ...row, [name]: defaultValue }));
    updateDatasetAfterMutation(dataset, "column:add");
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.patch("/api/data-studio/datasets/:datasetId/columns/:columnName", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const datasetId = String(req.params.datasetId || "").trim();
    const currentName = String(req.params.columnName || "").trim();
    const nextName = String(req.body?.name || "").trim();
    if (!currentName || !nextName) {
      return res.status(400).json({ ok: false, error: "Current and new column names are required" });
    }
    if (currentName === nextName) {
      return res.status(400).json({ ok: false, error: "New column name must differ from existing column name" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = findProjectDataset(dataStudio, projectId, datasetId);
    if (!dataset) {
      return res.status(404).json({ ok: false, error: "Dataset not found" });
    }

    const rows = ensureDatasetRowIds(dataset.rows, { forceNew: false });
    const hasColumn = rows.some((row) => Object.prototype.hasOwnProperty.call(row, currentName));
    if (!hasColumn) {
      return res.status(404).json({ ok: false, error: "Column not found" });
    }
    const hasTarget = rows.some((row) => Object.prototype.hasOwnProperty.call(row, nextName));
    if (hasTarget) {
      return res.status(400).json({ ok: false, error: "Target column already exists" });
    }

    dataset.rows = rows.map((row) => {
      if (!Object.prototype.hasOwnProperty.call(row, currentName)) {
        return row;
      }
      const { [currentName]: value, ...rest } = row;
      return { ...rest, [nextName]: value };
    });
    updateDatasetAfterMutation(dataset, "column:rename");
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.delete("/api/data-studio/datasets/:datasetId/columns/:columnName", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const datasetId = String(req.params.datasetId || "").trim();
    const columnName = String(req.params.columnName || "").trim();
    if (!columnName) {
      return res.status(400).json({ ok: false, error: "Column name is required" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = findProjectDataset(dataStudio, projectId, datasetId);
    if (!dataset) {
      return res.status(404).json({ ok: false, error: "Dataset not found" });
    }

    const rows = ensureDatasetRowIds(dataset.rows, { forceNew: false });
    const hasColumn = rows.some((row) => Object.prototype.hasOwnProperty.call(row, columnName));
    if (!hasColumn) {
      return res.status(404).json({ ok: false, error: "Column not found" });
    }

    dataset.rows = rows.map((row) => {
      const rest = { ...row };
      delete rest[columnName];
      return rest;
    });
    updateDatasetAfterMutation(dataset, "column:delete");
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.delete("/api/data-studio/datasets/:datasetId", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const datasetId = String(req.params.datasetId || "").trim();
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const beforeCount = dataStudio.datasets.length;
    dataStudio.datasets = dataStudio.datasets.filter((item) => !(item.id === datasetId && recordProjectId(item) === projectId));
    if (beforeCount === dataStudio.datasets.length) {
      return res.status(404).json({ ok: false, error: "Dataset not found" });
    }
    await saveWorkspaceConfig(config);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/data-studio/datasets/:datasetId/clean", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const datasetId = String(req.params.datasetId || "").trim();
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = findProjectDataset(dataStudio, projectId, datasetId);
    if (!dataset) {
      return res.status(404).json({ ok: false, error: "Dataset not found" });
    }

    dataset.rows = applyDatasetClean(dataset.rows || [], req.body || {});
    updateDatasetAfterMutation(dataset, `clean:${String(req.body?.operation || "trim-text")}`);
    await saveWorkspaceConfig(config);

    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/data-studio/datasets/:datasetId/chunk", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const datasetId = String(req.params.datasetId || "").trim();
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = findProjectDataset(dataStudio, projectId, datasetId);
    if (!dataset) {
      return res.status(404).json({ ok: false, error: "Dataset not found" });
    }

    dataset.rows = applyDatasetChunk(dataset.rows || [], req.body || {});
    updateDatasetAfterMutation(dataset, "chunk");
    await saveWorkspaceConfig(config);

    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/data-studio/datasets/:datasetId/tag", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const datasetId = String(req.params.datasetId || "").trim();
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = findProjectDataset(dataStudio, projectId, datasetId);
    if (!dataset) {
      return res.status(404).json({ ok: false, error: "Dataset not found" });
    }

    dataset.rows = applyDatasetTag(dataset.rows || [], req.body || {});
    updateDatasetAfterMutation(dataset, "tag");
    await saveWorkspaceConfig(config);

    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/data-studio/datasets/:datasetId/split", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const datasetId = String(req.params.datasetId || "").trim();
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = findProjectDataset(dataStudio, projectId, datasetId);
    if (!dataset) {
      return res.status(404).json({ ok: false, error: "Dataset not found" });
    }

    dataset.rows = applyDatasetSplit(dataset.rows || [], req.body || {});
    updateDatasetAfterMutation(dataset, "split");
    await saveWorkspaceConfig(config);

    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/data-studio/datasets/:datasetId/version", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const datasetId = String(req.params.datasetId || "").trim();
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = findProjectDataset(dataStudio, projectId, datasetId);
    if (!dataset) {
      return res.status(404).json({ ok: false, error: "Dataset not found" });
    }

    createDatasetVersion(dataset, req.body?.label);
    updateDatasetAfterMutation(dataset, "version");
    await saveWorkspaceConfig(config);

    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/data-studio/datasets/:datasetId/rollback", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const datasetId = String(req.params.datasetId || "").trim();
    const versionId = String(req.body?.versionId || "").trim();
    if (!versionId) {
      return res.status(400).json({ ok: false, error: "versionId is required" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const dataStudio = ensureDataStudioState(config);
    const dataset = findProjectDataset(dataStudio, projectId, datasetId);
    if (!dataset) {
      return res.status(404).json({ ok: false, error: "Dataset not found" });
    }

    const version = (dataset.versions || []).find((item) => item.id === versionId);
    if (!version) {
      return res.status(404).json({ ok: false, error: "Version not found" });
    }

    dataset.rows = Array.isArray(version.rowsSnapshot)
      ? version.rowsSnapshot.map((row) => ({ ...row }))
      : [];
    dataset.currentVersionId = version.id;
    updateDatasetAfterMutation(dataset, `rollback:${version.label}`);
    await saveWorkspaceConfig(config);

    return res.json({ ok: true, dataset: normalizeDataset(dataset) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/gpu/instance/launch", async (req, res) => {
  try {
    const {
      providerId,
      region,
      gpuType,
      gpuCount = 1,
      name,
      runtime,
      projectId = "default",
      budgetPolicy,
      skipWarmup,
    } = req.body || {};

    const adapter = gpuAdapters.getAdapter(providerId);
    if (!adapter) {
      return res.status(404).json({ ok: false, error: "Unknown GPU provider" });
    }

    if (!adapter.listRegions().includes(region)) {
      return res.status(400).json({ ok: false, error: "Invalid region for provider" });
    }
    if (!adapter.listGpuTypes().includes(gpuType)) {
      return res.status(400).json({ ok: false, error: "Invalid GPU type for provider" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const reliability = ensureReliabilityPolicy(config);
    const observability = ensureObservabilityState(config);
    observability.metrics.provision.attempts = Number(observability.metrics.provision.attempts || 0) + 1;
    const account = getProviderAccount(config, providerId);
    if (!account?.credentialRef) {
      return res.status(400).json({ ok: false, error: "Provider credentials are not configured" });
    }

    const { key } = ensureGpuMasterKey(config);
    const decryptedCredentials = decryptCredentialEnvelope(account.credentialRef, key);
    const credentialsValidation = adapter.validateCredentials(decryptedCredentials || {});
    if (!credentialsValidation.ok) {
      return res.status(400).json({ ok: false, error: "Provider credentials are not configured or invalid" });
    }

    const instanceSeed = adapter.createInstance({
      name,
      region,
      gpuType,
      gpuCount,
      credentials: decryptedCredentials,
    });

    const profile = ensureInferenceProfile(config, {
      ...(runtime || {}),
      model: runtime?.model,
      containerImage: runtime?.image,
    });

    const policy = budgetPolicy && typeof budgetPolicy === "object"
      ? {
          id: String(budgetPolicy.id || `policy-${String(projectId)}`),
          projectId: String(projectId),
          hardSpendCapUsd: Number(budgetPolicy.hardSpendCapUsd || 25),
          autoStopIdleMinutes: Number(budgetPolicy.autoStopIdleMinutes || 30),
          alertThresholds: Array.isArray(budgetPolicy.alertThresholds)
            ? budgetPolicy.alertThresholds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
            : [0.5, 0.8, 1],
          stopWindows: Array.isArray(budgetPolicy.stopWindows) ? budgetPolicy.stopWindows : [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
      : ensureDefaultBudgetPolicy(config, projectId);
    config.gpu.budgetPolicies[policy.id] = policy;

    if (isWithinStopWindow(policy)) {
      observability.metrics.provision.failed = Number(observability.metrics.provision.failed || 0) + 1;
      pushGpuAuditLog(config, "instance.launch_blocked_stop_window", {
        providerId,
        projectId: String(projectId),
        policyId: policy.id,
      });
      await saveWorkspaceConfig(config);
      return res.status(403).json({
        ok: false,
        error: "Launch blocked by scheduled stop window",
        policy: {
          policyId: policy.id,
          stopWindows: policy.stopWindows || [],
        },
      });
    }

    const preLaunchEstimateUsd = estimateLaunchHourlyCostUsd(gpuType, gpuCount);
    if (preLaunchEstimateUsd > Number(policy.hardSpendCapUsd || 0)) {
      observability.metrics.provision.failed = Number(observability.metrics.provision.failed || 0) + 1;
      pushGpuAuditLog(config, "instance.launch_blocked_budget", {
        providerId,
        gpuType,
        gpuCount: Number(gpuCount || 1),
        preLaunchEstimateUsd,
        hardSpendCapUsd: Number(policy.hardSpendCapUsd || 0),
      });
      await saveWorkspaceConfig(config);
      return res.status(400).json({
        ok: false,
        error: "Pre-launch estimated hourly cost exceeds budget cap",
        estimate: {
          preLaunchEstimateUsd,
          hardSpendCapUsd: Number(policy.hardSpendCapUsd || 0),
        },
      });
    }

    const instanceRuntime = {
      ...(runtime || {}),
      image: profile.containerImage,
      model: profile.model,
    };
    let instance = adapter.deployRuntime(instanceSeed, instanceRuntime);
    const hardware = estimateHardwareShape(gpuType, gpuCount);
    instance = {
      ...instance,
      ...hardware,
      health: "healthy",
      lastHealthCheckAt: nowIso(),
      projectId: String(projectId),
      inferenceProfileId: profile.id,
      budgetPolicyId: policy.id,
      lastActivityAt: nowIso(),
    };

    const shouldWarmup = !Boolean(skipWarmup);
    if (shouldWarmup && typeof adapter.warmupRuntime === "function") {
      instance = adapter.warmupRuntime(instance, { maxChecks: 3 });
    }

    config.gpu.instances.push(instance);
    const warmupStartedAt = instance.runtime?.warmup?.startedAt;
    const warmupCompletedAt = instance.runtime?.warmup?.completedAt;
    if (warmupStartedAt && warmupCompletedAt) {
      const readyMs = Math.max(0, new Date(warmupCompletedAt).getTime() - new Date(warmupStartedAt).getTime());
      observability.metrics.provision.timeToReadyMsSum = Number(observability.metrics.provision.timeToReadyMsSum || 0) + readyMs;
      observability.metrics.provision.timeToReadySamples = Number(observability.metrics.provision.timeToReadySamples || 0) + 1;
    }
    observability.metrics.provision.success = Number(observability.metrics.provision.success || 0) + 1;
    observability.metrics.lastUpdatedAt = nowIso();
    pushGpuAuditLog(config, "instance.launched", {
      instanceId: instance.id,
      providerId,
      projectId: String(projectId),
      preLaunchEstimateUsd,
      reliabilityPolicy: reliability,
    });
    await saveWorkspaceConfig(config);

    res.json({
      ok: true,
      instance: normalizeGpuInstance(instance),
      estimate: {
        preLaunchHourlyUsd: preLaunchEstimateUsd,
      },
      readiness: {
        state: instance.status === "running" && instance.health === "ready" ? "Ready" : "Instance provisioning",
        warmup: instance.runtime?.warmup || null,
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/instances/gpu/instance/:instanceId/health", async (req, res) => {
  try {
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const instanceId = String(req.params.instanceId || "").trim();
    const index = config.gpu.instances.findIndex((instance) => instance.id === instanceId);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: "Instance not found" });
    }

    const current = { ...config.gpu.instances[index] };
    const adapter = gpuAdapters.getAdapter(current.providerId);
    if (!adapter) {
      return res.status(404).json({ ok: false, error: "Provider adapter not found" });
    }

    const health = typeof adapter.checkRuntimeHealth === "function"
      ? adapter.checkRuntimeHealth(current)
      : {
          ok: current.status === "running",
          status: current.health || "unknown",
          endpoint: current.endpoint || "",
          checkedAt: nowIso(),
        };

    current.lastHealthCheckAt = health.checkedAt || nowIso();
    current.health = health.ok ? "ready" : (current.health || "error");
    current.updatedAt = nowIso();
    config.gpu.instances[index] = current;
    await saveWorkspaceConfig(config);

    return res.json({
      ok: true,
      instanceId,
      health,
      instance: normalizeGpuInstance(current),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/gpu/instance/action", async (req, res) => {
  try {
    const { instanceId, action } = req.body || {};
    if (!instanceId || !action) {
      return res.status(400).json({ ok: false, error: "instanceId and action are required" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const observability = ensureObservabilityState(config);
    const index = config.gpu.instances.findIndex((instance) => instance.id === instanceId);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: "Instance not found" });
    }

    const current = { ...config.gpu.instances[index] };
    const adapter = gpuAdapters.getAdapter(current.providerId);
    if (!adapter) {
      return res.status(404).json({ ok: false, error: "Provider adapter not found" });
    }

    const normalizedAction = String(action).toLowerCase();
    let instance = current;
    if (normalizedAction === "start") {
      const policy = config.gpu.budgetPolicies[current.budgetPolicyId] || null;
      if (policy && isWithinStopWindow(policy)) {
        pushGpuAuditLog(config, "instance.start_blocked_stop_window", {
          instanceId,
          policyId: policy.id,
        });
        await saveWorkspaceConfig(config);
        return res.status(403).json({ ok: false, error: "Start blocked by scheduled stop window" });
      }
      instance = adapter.startInstance(current);
      if (typeof adapter.warmupRuntime === "function") {
        instance = adapter.warmupRuntime({
          ...instance,
          status: "provisioning",
          health: "warming",
        }, { maxChecks: 2 });
      }
    } else if (normalizedAction === "stop") {
      instance = adapter.stopInstance(current);
    } else if (normalizedAction === "terminate") {
      instance = adapter.terminateInstance(current);
    } else {
      return res.status(400).json({ ok: false, error: "Unsupported action" });
    }

    const status = adapter.getInstanceStatus(instance);
    instance = {
      ...instance,
      status: status.status,
      endpoint: status.endpoint || instance.endpoint,
      health: normalizedAction === "terminate" ? "terminated" : (normalizedAction === "stop" ? "idle" : "healthy"),
      lastHealthCheckAt: nowIso(),
      updatedAt: status.updatedAt || new Date().toISOString(),
    };

    if (normalizedAction === "start") {
      instance.health = "ready";
    }

    config.gpu.instances[index] = instance;
    observability.metrics.lastUpdatedAt = nowIso();
    pushGpuAuditLog(config, "instance.action", {
      instanceId,
      action: normalizedAction,
      status: instance.status,
      health: instance.health,
    });
    await saveWorkspaceConfig(config);

    res.json({ ok: true, instance: normalizeGpuInstance(instance) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/instances/gpu/routing", async (req, res) => {
  try {
    const projectId = String(req.query.projectId || "default");
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const instanceId = gpuRouting.getRoute(config, projectId) || null;
    res.json({ ok: true, projectId, instanceId });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/gpu/routing", async (req, res) => {
  try {
    const { projectId = "default", instanceId } = req.body || {};
    if (!instanceId) {
      return res.status(400).json({ ok: false, error: "instanceId is required" });
    }

    let config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const exists = config.gpu.instances.some((instance) => instance.id === instanceId);
    if (!exists) {
      return res.status(404).json({ ok: false, error: "Instance not found" });
    }

    config = gpuRouting.setRoute(config, String(projectId), instanceId);
    pushGpuAuditLog(config, "routing.updated", {
      projectId: String(projectId),
      instanceId,
    });
    await saveWorkspaceConfig(config);

    res.json({ ok: true, projectId: String(projectId), instanceId });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/instances/gpu/inference-profiles", async (_req, res) => {
  try {
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const profiles = Object.values(config.gpu.inferenceProfiles || {});
    return res.json({ ok: true, profiles });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/gpu/inference-profiles", async (req, res) => {
  try {
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const profile = ensureInferenceProfile(config, req.body || {});
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, profile });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/instances/gpu/budget-policy", async (req, res) => {
  try {
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const projectId = String(req.query.projectId || "default");
    const policy = ensureDefaultBudgetPolicy(config, projectId);
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, policy });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/gpu/budget-policy", async (req, res) => {
  try {
    const { id, projectId = "default", hardSpendCapUsd, autoStopIdleMinutes, alertThresholds, stopWindows } = req.body || {};
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const policyId = String(id || `policy-${String(projectId)}`);
    const existing = config.gpu.budgetPolicies[policyId] || {};
    config.gpu.budgetPolicies[policyId] = {
      id: policyId,
      projectId: String(projectId),
      hardSpendCapUsd: Number(hardSpendCapUsd ?? existing.hardSpendCapUsd ?? 25),
      autoStopIdleMinutes: Number(autoStopIdleMinutes ?? existing.autoStopIdleMinutes ?? 30),
      alertThresholds: Array.isArray(alertThresholds)
        ? alertThresholds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
        : (existing.alertThresholds || [0.5, 0.8, 1]),
      stopWindows: Array.isArray(stopWindows) ? stopWindows : (existing.stopWindows || []),
      createdAt: existing.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    pushGpuAuditLog(config, "budget.policy_updated", {
      policyId,
      projectId: String(projectId),
    });
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, policy: config.gpu.budgetPolicies[policyId] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/instances/gpu/inference/logs", async (req, res) => {
  try {
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const instanceId = String(req.query.instanceId || "").trim();
    const projectId = String(req.query.projectId || "").trim();
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));

    let logs = [...config.gpu.inferenceRequestLogs];
    if (instanceId) {
      logs = logs.filter((entry) => entry.instanceId === instanceId);
    }
    if (projectId) {
      logs = logs.filter((entry) => entry.projectId === projectId);
    }

    logs.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return res.json({ ok: true, logs: logs.slice(0, limit) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/instances/gpu/reliability", async (_req, res) => {
  try {
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const reliability = ensureReliabilityPolicy(config);
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, reliability });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/gpu/reliability", async (req, res) => {
  try {
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const current = ensureReliabilityPolicy(config);
    const next = req.body && typeof req.body === "object" ? req.body : {};
    config.gpu.reliability = {
      ...current,
      inferenceTimeoutMs: Number(next.inferenceTimeoutMs ?? current.inferenceTimeoutMs),
      maxQueueDepthPerInstance: Number(next.maxQueueDepthPerInstance ?? current.maxQueueDepthPerInstance),
      retryPolicy: {
        ...current.retryPolicy,
        ...(next.retryPolicy && typeof next.retryPolicy === "object" ? next.retryPolicy : {}),
      },
      circuitBreaker: {
        ...current.circuitBreaker,
        ...(next.circuitBreaker && typeof next.circuitBreaker === "object" ? next.circuitBreaker : {}),
      },
    };
    pushGpuAuditLog(config, "reliability.policy_updated", { reliability: config.gpu.reliability });
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, reliability: config.gpu.reliability });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/instances/gpu/fallback-route", async (req, res) => {
  try {
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const projectId = String(req.query.projectId || "default");
    return res.json({
      ok: true,
      projectId,
      fallbackInstanceId: config.gpu.fallbackRoutes[projectId] || null,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/gpu/fallback-route", async (req, res) => {
  try {
    const { projectId = "default", fallbackInstanceId } = req.body || {};
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    if (!fallbackInstanceId) {
      delete config.gpu.fallbackRoutes[String(projectId)];
      pushGpuAuditLog(config, "fallback.cleared", { projectId: String(projectId) });
      await saveWorkspaceConfig(config);
      return res.json({ ok: true, projectId: String(projectId), fallbackInstanceId: null });
    }

    const exists = config.gpu.instances.some((instance) => instance.id === fallbackInstanceId);
    if (!exists) {
      return res.status(404).json({ ok: false, error: "Fallback instance not found" });
    }

    config.gpu.fallbackRoutes[String(projectId)] = fallbackInstanceId;
    pushGpuAuditLog(config, "fallback.updated", {
      projectId: String(projectId),
      fallbackInstanceId,
    });
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, projectId: String(projectId), fallbackInstanceId });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/instances/gpu/observability", async (_req, res) => {
  try {
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const summary = summarizeObservability(config);
    await saveWorkspaceConfig(config);
    return res.json({
      ok: true,
      summary,
      metrics: config.gpu.observability.metrics,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/instances/gpu/audit-logs", async (req, res) => {
  try {
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
    const logs = [...config.gpu.auditLogs]
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, limit);
    return res.json({ ok: true, logs });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/instances/gpu/rollout/status", async (_req, res) => {
  try {
    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const readiness = computeRolloutReadiness(config);
    await saveWorkspaceConfig(config);
    return res.json({ ok: true, ...readiness });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/gpu/rollout/status", async (req, res) => {
  try {
    const { milestoneId, status, gates } = req.body || {};
    const allowed = new Set(["planned", "in-progress", "completed", "blocked"]);

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const rollout = ensureRolloutState(config);

    if (milestoneId && status) {
      if (!allowed.has(String(status))) {
        return res.status(400).json({ ok: false, error: "Invalid milestone status" });
      }

      const idx = rollout.milestones.findIndex((item) => item.id === String(milestoneId));
      if (idx === -1) {
        return res.status(404).json({ ok: false, error: "Milestone not found" });
      }

      rollout.milestones[idx] = {
        ...rollout.milestones[idx],
        status: String(status),
        completedAt: String(status) === "completed" ? nowIso() : null,
      };
    }

    if (gates && typeof gates === "object") {
      rollout.gates = {
        ...rollout.gates,
        strictTesting: Boolean(gates.strictTesting ?? rollout.gates.strictTesting),
        securityChecks: Boolean(gates.securityChecks ?? rollout.gates.securityChecks),
        observabilityChecks: Boolean(gates.observabilityChecks ?? rollout.gates.observabilityChecks),
        productionReadiness: Boolean(gates.productionReadiness ?? rollout.gates.productionReadiness),
        updatedAt: nowIso(),
      };
    }

    config.gpu.rollout = rollout;
    pushGpuAuditLog(config, "rollout.updated", {
      milestoneId: milestoneId || null,
      status: status || null,
      gates: gates || null,
    });
    await saveWorkspaceConfig(config);

    const readiness = computeRolloutReadiness(config);
    return res.json({ ok: true, ...readiness });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/instances/gpu/inference", async (req, res) => {
  let queuedInstanceId = null;
  try {
    const { instanceId, projectId = "default", prompt, model } = req.body || {};
    if (!String(prompt || "").trim()) {
      return res.status(400).json({ ok: false, error: "prompt is required" });
    }

    const config = ensureGpuConfigShape(await loadWorkspaceConfig());
    const reliability = ensureReliabilityPolicy(config);
    const observability = ensureObservabilityState(config);
    const autoStopped = applyIdleAutoShutdown(config);

    let instance = gpuRouting.resolveInstance({
      config,
      projectId: String(projectId),
      instanceId: instanceId || null,
    });

    if (!instance) {
      if (autoStopped) {
        await saveWorkspaceConfig(config);
      }
      return res.status(404).json({ ok: false, error: "No matching routed/running instance found" });
    }
    if (instance.status !== "running") {
      if (autoStopped) {
        await saveWorkspaceConfig(config);
      }
      return res.status(400).json({ ok: false, error: "Instance is not running" });
    }

    let adapter = gpuAdapters.getAdapter(instance.providerId);
    if (!adapter) {
      if (autoStopped) {
        await saveWorkspaceConfig(config);
      }
      return res.status(404).json({ ok: false, error: "Provider adapter not found" });
    }

    const policy = config.gpu.budgetPolicies[instance.budgetPolicyId] || ensureDefaultBudgetPolicy(config, projectId);
    if (isWithinStopWindow(policy)) {
      pushGpuAuditLog(config, "inference.blocked_stop_window", {
        projectId: String(projectId),
        instanceId: instance.id,
        policyId: policy.id,
      });
      await saveWorkspaceConfig(config);
      return res.status(403).json({ ok: false, error: "Inference blocked by scheduled stop window" });
    }

    if (!canPassCircuitBreaker(config, instance.id, reliability.circuitBreaker.resetTimeoutMs)) {
      const fallbackFromBreaker = resolveFallbackInstance(config, String(projectId), instance.id);
      if (fallbackFromBreaker) {
        instance = fallbackFromBreaker;
        adapter = gpuAdapters.getAdapter(instance.providerId);
      } else {
        pushGpuAuditLog(config, "inference.blocked_circuit_open", {
          instanceId: instance.id,
        });
        await saveWorkspaceConfig(config);
        return res.status(503).json({ ok: false, error: "Circuit breaker is open for instance" });
      }
    }

    if (!enqueueInference(instance.id, reliability.maxQueueDepthPerInstance)) {
      return res.status(429).json({
        ok: false,
        error: "Inference queue is full for target instance",
        queue: {
          instanceId: instance.id,
          depth: Number(inferenceQueueState.get(instance.id) || 0),
          maxDepth: reliability.maxQueueDepthPerInstance,
        },
      });
    }
    queuedInstanceId = instance.id;

    const consumedUsd = config.gpu.inferenceRequestLogs
      .filter((entry) => entry.budgetPolicyId === policy.id)
      .reduce((sum, entry) => sum + Number(entry.costEstimateUsd || 0), 0);

    if (consumedUsd >= Number(policy.hardSpendCapUsd || 0)) {
      if (queuedInstanceId) {
        dequeueInference(queuedInstanceId);
        queuedInstanceId = null;
      }
      return res.status(429).json({
        ok: false,
        error: `Budget cap reached for policy ${policy.id}`,
        budget: {
          policyId: policy.id,
          hardSpendCapUsd: policy.hardSpendCapUsd,
          consumedUsd: Number(consumedUsd.toFixed(6)),
        },
      });
    }

    const inferencePayload = {
      prompt: String(prompt).trim(),
      model,
      projectId: String(projectId),
    };

    let execution = await runInferenceWithRetry({
      adapter,
      instance,
      payload: inferencePayload,
      retryPolicy: reliability.retryPolicy,
      timeoutMs: reliability.inferenceTimeoutMs,
    });

    if (!execution.ok) {
      const fallbackInstance = resolveFallbackInstance(config, String(projectId), instance.id);
      if (fallbackInstance) {
        const fallbackAdapter = gpuAdapters.getAdapter(fallbackInstance.providerId);
        if (fallbackAdapter) {
          pushGpuAuditLog(config, "inference.fallback_attempt", {
            fromInstanceId: instance.id,
            toInstanceId: fallbackInstance.id,
            projectId: String(projectId),
          });
          instance = fallbackInstance;
          adapter = fallbackAdapter;
          execution = await runInferenceWithRetry({
            adapter,
            instance,
            payload: inferencePayload,
            retryPolicy: reliability.retryPolicy,
            timeoutMs: reliability.inferenceTimeoutMs,
          });
        }
      }
    }

    if (!execution.ok) {
      const runtimeError = execution.result?.error || {
        code: "INFERENCE_ERROR",
        message: "Inference failed",
        details: {},
        retriable: false,
      };

      const errorLog = {
        id: `gpuinf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        projectId: String(projectId),
        instanceId: instance.id,
        providerId: instance.providerId,
        model: String(model || instance.runtime?.model || "open-source-default"),
        inputSizeChars: String(prompt).trim().length,
        inputTokens: Math.max(1, Math.ceil(String(prompt).trim().length / 4)),
        outputTokensEstimate: 0,
        latencyMs: 0,
        costEstimateUsd: 0,
        errorCode: runtimeError.code,
        errorTaxonomy: classifyProviderError(runtimeError.code, runtimeError.message),
        budgetPolicyId: policy.id,
        createdAt: nowIso(),
      };
      config.gpu.inferenceRequestLogs.push(errorLog);
      observability.metrics.inference.total = Number(observability.metrics.inference.total || 0) + 1;
      observability.metrics.inference.failed = Number(observability.metrics.inference.failed || 0) + 1;
      observability.metrics.lastUpdatedAt = nowIso();
      recordProviderErrorMetric(config, instance.providerId, errorLog.errorTaxonomy);
      recordCircuitFailure(
        config,
        instance.id,
        reliability.circuitBreaker.failureThreshold,
        reliability.circuitBreaker.resetTimeoutMs,
        runtimeError.code,
      );
      pushGpuAuditLog(config, "inference.failed", {
        instanceId: instance.id,
        providerId: instance.providerId,
        code: runtimeError.code,
        taxonomy: errorLog.errorTaxonomy,
      });
      if (queuedInstanceId) {
        dequeueInference(queuedInstanceId);
        queuedInstanceId = null;
      }
      await saveWorkspaceConfig(config);

      return res.status(502).json({
        ok: false,
        error: runtimeError.message,
        runtimeError,
        requestLog: errorLog,
      });
    }

    const result = execution.result;
    recordCircuitSuccess(config, instance.id);

    const logEntry = {
      id: `gpuinf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId: String(projectId),
      instanceId: instance.id,
      providerId: instance.providerId,
      model: String(result.model || model || instance.runtime?.model || "open-source-default"),
      inputSizeChars: String(prompt).trim().length,
      inputTokens: Math.max(1, Math.ceil(String(prompt).trim().length / 4)),
      outputTokensEstimate: Number(result.tokensEstimate || 0),
      latencyMs: Number(result.latencyMs || 0),
      costEstimateUsd: estimateInferenceCostUsd(instance, result.tokensEstimate, result.latencyMs),
      errorCode: null,
      attempts: execution.attempts,
      budgetPolicyId: policy.id,
      createdAt: nowIso(),
    };
    config.gpu.inferenceRequestLogs.push(logEntry);
    observability.metrics.inference.total = Number(observability.metrics.inference.total || 0) + 1;
    observability.metrics.inference.latencyMsSum = Number(observability.metrics.inference.latencyMsSum || 0) + Number(logEntry.latencyMs || 0);
    observability.metrics.inference.latencySamples = Number(observability.metrics.inference.latencySamples || 0) + 1;
    observability.metrics.inference.estimatedSpendUsd = Number(observability.metrics.inference.estimatedSpendUsd || 0) + Number(logEntry.costEstimateUsd || 0);
    observability.metrics.lastUpdatedAt = nowIso();
    pushGpuAuditLog(config, "inference.succeeded", {
      instanceId: instance.id,
      providerId: instance.providerId,
      attempts: execution.attempts,
      latencyMs: logEntry.latencyMs,
      costEstimateUsd: logEntry.costEstimateUsd,
    });

    const instanceIndex = config.gpu.instances.findIndex((item) => item.id === instance.id);
    if (instanceIndex >= 0) {
      config.gpu.instances[instanceIndex] = {
        ...config.gpu.instances[instanceIndex],
        lastActivityAt: nowIso(),
        updatedAt: nowIso(),
      };
    }

    if (queuedInstanceId) {
      dequeueInference(queuedInstanceId);
      queuedInstanceId = null;
    }
    await saveWorkspaceConfig(config);

    res.json({
      ok: true,
      projectId: String(projectId),
      routedInstanceId: instance.id,
      instance: normalizeGpuInstance(instance),
      requestLog: logEntry,
      result,
    });
  } catch (error) {
    if (typeof queuedInstanceId === "string" && queuedInstanceId) {
      dequeueInference(queuedInstanceId);
    }
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// ── Active chat sessions (for abort support) ──
const activeSessions = new Map(); // sessionId -> child process
const finetuneSessionState = new Map(); // sessionId -> pending finetune workflow state

function isQwenFinetuneIntent(text) {
  const body = String(text || "").toLowerCase();
  const wantsFinetune = /\b(finetune|fine\s*tune|fine-tune)\b/.test(body);
  const targetsQwen = /\bqwen\b/.test(body);
  return wantsFinetune && targetsQwen;
}

function isApprovalMessage(text) {
  const body = String(text || "").toLowerCase();
  return /(approve|approved|go ahead|proceed|start|run it|yes)/.test(body);
}

function parseFinetunePersona(text) {
  const source = String(text || "").trim();
  if (!source) {
    return "Custom Assistant AI";
  }

  const directMatch = source.match(/(?:for|as|build|create|make)\s+(?:an?\s+)?([a-z0-9\-\s]{4,60}?)(?:[.,;!?]|$)/i);
  if (directMatch?.[1]) {
    const phrase = directMatch[1].trim().replace(/\s+/g, " ");
    if (phrase) {
      return phrase
        .split(" ")
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(" ")
        .replace(/\s+Ai$/i, " AI");
    }
  }

  return "Custom Assistant AI";
}

function extractIntentFocus(message) {
  const source = String(message || "").trim();
  if (!source) {
    return "the requested behavior";
  }

  const intentMatch = source.match(/(?:for|to|about)\s+([a-z0-9\-\s]{4,100}?)(?:[.,;!?]|$)/i);
  if (intentMatch?.[1]) {
    return intentMatch[1].trim().replace(/\s+/g, " ");
  }

  const compact = source.replace(/\s+/g, " ");
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

const CHAT_ANSI_ESCAPE_REGEX = /\u001b\[[0-9;]*m/g;

function isChatDiagnosticLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) {
    return true;
  }
  return (
    trimmed.startsWith("[tools]") ||
    trimmed.startsWith("[agent/embedded]") ||
    trimmed.startsWith("[diagnostic]") ||
    trimmed.startsWith("🦞 text2llm") ||
    trimmed.includes("google tool schema snapshot") ||
    trimmed.includes("allowlist contains unknown entries") ||
    trimmed.startsWith("At line:") ||
    trimmed.startsWith("CategoryInfo") ||
    trimmed.startsWith("FullyQualifiedErrorId") ||
    trimmed.startsWith("+") ||
    trimmed.startsWith("~") ||
    /\b(Command exited with code|CannotConvertArgumentNoMessage|ParameterBindingException)\b/i.test(trimmed)
  );
}

function sanitizeChatAgentText(text) {
  const withoutAnsi = String(text || "").replace(CHAT_ANSI_ESCAPE_REGEX, "");
  const lines = withoutAnsi.split(/\r?\n/);
  const kept = lines.filter((line) => !isChatDiagnosticLine(line));
  return kept.join("\n").trim();
}

function extractFinalAnswerOnly(text) {
  const sanitized = sanitizeChatAgentText(text);
  if (!sanitized) {
    return "";
  }

  const noiseLineRegex =
    /^(recognized as a valid datetime|date\s*\/t|at line:|categoryinfo|fullyqualifiederrorid|cannotconvertargument|parameterbindingexception|command exited with code|\+\s|~\s|\.{2,})/i;

  const filteredLines = sanitized
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return true;
      }
      return !noiseLineRegex.test(trimmed);
    });

  const filtered = filteredLines.join("\n").trim();
  if (!filtered) {
    return "";
  }

  const markerMatch = filtered.match(/(?:^|\n)(?:\*\*?\s*)?(final\s+answer|assistant|response)\s*[:\-]\s*/i);
  if (markerMatch && typeof markerMatch.index === "number") {
    const sliced = filtered.slice(markerMatch.index + markerMatch[0].length).trim();
    if (sliced) {
      return sliced;
    }
  }

  const paragraphs = filtered
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return filtered;
  }

  const conversational = paragraphs.filter((part) => /[a-z]/i.test(part) && /[.!?]|\n/.test(part));
  const preferred = conversational.length > 0 ? conversational[conversational.length - 1] : paragraphs[paragraphs.length - 1];

  return preferred.trim();
}

function normalizeStreamChunkText(text) {
  const normalized = sanitizeChatAgentText(String(text || "").replace(/\r\n/g, "\n"));
  if (!normalized) {
    return "";
  }

  const compact = normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

  return compact;
}

function createProgressReporter(sendSSE) {
  const stepState = new Map();

  const emit = (payload) => {
    if (!payload?.id) {
      return;
    }
    sendSSE("progress", {
      ...payload,
      ts: Date.now(),
    });
  };

  return {
    start(id, label, detail) {
      const previous = stepState.get(id);
      stepState.set(id, { label: label || previous?.label || id, state: "running" });
      emit({
        id,
        label: label || previous?.label || id,
        detail: detail || undefined,
        state: "running",
      });
    },
    update(id, detail) {
      const previous = stepState.get(id);
      if (!previous) {
        return;
      }
      emit({
        id,
        label: previous.label,
        detail: detail || undefined,
        state: "running",
      });
    },
    done(id, detail) {
      const previous = stepState.get(id);
      const label = previous?.label || id;
      stepState.set(id, { label, state: "done" });
      emit({
        id,
        label,
        detail: detail || undefined,
        state: "done",
      });
    },
    error(id, detail) {
      const previous = stepState.get(id);
      const label = previous?.label || id;
      stepState.set(id, { label, state: "error" });
      emit({
        id,
        label,
        detail: detail || undefined,
        state: "error",
      });
    },
  };
}

function buildFinetuneClarificationAndPlan(message, persona) {
  const intentFocus = extractIntentFocus(message);

  return [
    `I can finetune Qwen for a ${persona} via your configured Kaggle provider, but I need to lock assumptions first.`,
    "",
    "Clarifications to confirm:",
    `1) Target scope: should it focus only on \"${intentFocus}\", or also adjacent tasks?`,
    "2) Success criteria: what 3 example prompts should it handle perfectly after finetuning?",
    "3) Data source: do you want to use your own examples, synthetic data, or a mix?",
    "4) Safety/permissions: what must always require confirmation or be refused?",
    "",
    "Proposed execution plan:",
    `- Define acceptance tests and behavior rubric for \"${intentFocus}\".`,
    "- Prepare and clean supervised instruction data aligned to your rubric.",
    "- Run Qwen LoRA-style finetune job on Kaggle T4 runtime.",
    "- Evaluate against your acceptance prompts, then report artifacts and next tuning steps.",
    "",
    "Reply with 'approve plan' to start Kaggle finetuning now, or answer the clarifications first.",
    "",
    `Original request: ${String(message || "").trim()}`,
  ].join("\n");
}

async function internalJsonRequest(pathname, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    const details = payload?.error || payload?.details || `Request failed (${response.status})`;
    throw new Error(`${pathname}: ${details}`);
  }
  return payload;
}

async function runKaggleQwenFinetuneWorkflow({ sessionId, persona, sendSSE }) {
  const creds = await getKaggleCredentials();
  if (!creds) {
    throw new Error("Kaggle credentials not configured. Go to Instances > GPU > Kaggle and set your username/key.");
  }

  const jobId = `ft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseModel = "unsloth/Qwen2.5-7B-Instruct-bnb-4bit";

  const job = createFinetuneJob(jobId, {
    baseModel,
    persona,
    dataset: null, // synthetic dataset for math tutor
  });

  if (sendSSE) {
    sendSSE("status", { text: `Creating finetune job ${jobId}...` });
  }

  addFinetuneLog(jobId, `Finetune job created — model: ${baseModel}, persona: ${persona}`);
  addFinetuneLog(jobId, "Generating training notebook...");

  const notebook = generateFinetuneNotebook({
    baseModel,
    dataset: null,
    persona,
    config: job.trainingConfig,
  });

  if (sendSSE) {
    sendSSE("status", { text: "Notebook generated. Pushing to Kaggle..." });
  }

  updateFinetuneJob(jobId, { status: "pushing" });
  addFinetuneLog(jobId, "Pushing kernel to Kaggle with GPU acceleration...");

  const pushResult = await pushKaggleKernel({
    username: creds.username,
    title: `text2llm-finetune-${persona.toLowerCase().replace(/\s+/g, "-")}`,
    notebookContent: notebook,
    enableGpu: true,
    enableInternet: true,
  });

  updateFinetuneJob(jobId, {
    status: "running",
    kernelSlug: pushResult.kernelSlug,
    kernelUrl: pushResult.url,
  });
  addFinetuneLog(jobId, `Kernel pushed: ${pushResult.url}`);
  addFinetuneLog(jobId, "Queued for GPU execution on Kaggle T4.");

  if (sendSSE) {
    sendSSE("status", { text: `Kernel pushed to Kaggle: ${pushResult.url}` });
    sendSSE("status", { text: "GPU queued. Background polling started — check /api/finetune/status for live updates." });
  }

  // Start background polling
  pollFinetuneJob(jobId);

  return {
    jobId,
    kernelSlug: pushResult.kernelSlug,
    kernelUrl: pushResult.url,
    baseModel,
    persona,
  };
}

app.post("/api/chat", async (req, res) => {
  const { message, sessionId, history, projectId } = req.body || {};
  const body = (message || "").trim();
  if (!body) {
    return res.status(400).json({ ok: false, error: "Message is required" });
  }

  const sid = sessionId || `web-${Date.now()}`;
  const conversationHistory = Array.isArray(history) ? history : [];
  
  // Only use project ID if explicitly provided; otherwise treat as ephemeral
  const activeProjectId = projectId ? String(projectId) : null;

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Session-Id": sid,
  });

  // Send session id to client
  res.write(`event: session\ndata: ${JSON.stringify({ sessionId: sid })}\n\n`);

  const sendSSE = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) {
      // client disconnected
    }
  };

  const progress = createProgressReporter(sendSSE);
  progress.start("request", "Receive request", "Request accepted");

  sendSSE("status", { text: "Connected. Preparing your response..." });
  progress.start("prepare-context", "Prepare context", "Resolving conversation memory");

  const existingFinetuneState = finetuneSessionState.get(sid);
  const intentDetected = isQwenFinetuneIntent(body);
  const shouldHandleFinetuneApproval =
    existingFinetuneState?.stage === "awaiting-approval" && isApprovalMessage(body);

  // Clear stale finetune session state if user sends a non-finetune, non-approval message
  if (existingFinetuneState && !intentDetected && !shouldHandleFinetuneApproval) {
    finetuneSessionState.delete(sid);
  }

  if (intentDetected || shouldHandleFinetuneApproval) {
    const persona =
        existingFinetuneState?.persona || parseFinetunePersona(existingFinetuneState?.originalMessage || body);

    if (!shouldHandleFinetuneApproval) {
      progress.done("prepare-context", "Prepared approval plan");
      progress.done("request", "Waiting for approval");
      finetuneSessionState.set(sid, {
        stage: "awaiting-approval",
        originalMessage: body,
        persona,
        createdAt: nowIso(),
      });

      sendSSE("chunk", {
        text: buildFinetuneClarificationAndPlan(body, persona),
      });
      sendSSE("done", { code: 0, workflow: "awaiting-approval" });
      res.end();
      return;
    }

    try {
      progress.done("prepare-context", "Approval received");
      progress.start("finetune-workflow", "Start finetune workflow", "Launching Kaggle job");
      sendSSE("status", {
        text: "Approval received. Launching Kaggle runtime and starting Qwen finetune workflow...",
      });

      const run = await runKaggleQwenFinetuneWorkflow({
        sessionId: sid,
        persona,
        sendSSE,
      });

      finetuneSessionState.delete(sid);
      progress.done("finetune-workflow", "Kaggle workflow started");
      progress.done("request", "Workflow submitted");
      sendSSE("chunk", {
        text: [
          "Kaggle finetune job submitted successfully!",
          "",
          `Job ID: ${run.jobId}`,
          `Kernel: ${run.kernelUrl}`,
          `Base model: ${run.baseModel}`,
          `Persona: ${run.persona}`,
          "",
          "The kernel is now queued for GPU execution on Kaggle.",
          "Training will run LoRA finetuning with unsloth on a T4 GPU.",
          "",
          "You can monitor progress:",
          `• View live on Kaggle: ${run.kernelUrl}`,
          `• Check status: GET /api/finetune/status?jobId=${run.jobId}`,
          `• View logs: GET /api/finetune/logs?jobId=${run.jobId}`,
          "",
          "I'll keep polling in the background. Once training completes, the finetuned model artifacts will be available for download.",
        ].join("\n"),
      });
      sendSSE("done", {
        code: 0,
        workflow: "started",
        jobId: run.jobId,
        kernelUrl: run.kernelUrl,
      });
      res.end();
      return;
    } catch (error) {
      progress.error("finetune-workflow", "Failed to start workflow");
      progress.error("request", "Workflow failed");
      const errMsg = error instanceof Error ? error.message : "Failed to start Kaggle finetune workflow";
      const recovery = diagnoseKaggleError(error);
      sendSSE("error", {
        message: errMsg,
        recovery,
      });
      sendSSE("done", { code: 1, workflow: "failed" });
      res.end();
      return;
    }
  }

  if (process.env.TEXT2LLM_CHAT_TEST_MODE === "1") {
    const timers = [];
    const schedule = (ms, fn) => {
      const timer = setTimeout(fn, ms);
      timers.push(timer);
      return timer;
    };

    const cleanupTimers = () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };

    schedule(10, () => progress.start("test-prepare", "Prepare response", "Test mode"));
    schedule(25, () => sendSSE("status", { text: "Test mode: preparing response" }));
    schedule(60, () => progress.done("test-prepare", "Prepared"));
    schedule(70, () => progress.start("test-stream", "Stream response", "Sending first chunk"));
    schedule(80, () => sendSSE("chunk", { text: "Test mode partial chunk" }));
    schedule(130, () => sendSSE("status", { text: "Test mode: finalizing" }));
    schedule(140, () => progress.done("test-stream", "Stream complete"));
    schedule(180, () => {
      progress.done("request", "Completed");
      sendSSE("done", { code: 0, testMode: true });
      cleanupTimers();
      res.end();
    });

    req.on("aborted", cleanupTimers);
    res.on("close", cleanupTimers);
    return;
  }

  // Build context from user.md (project memory) + conversation history
  let projectMemory = "";
  try {
    if (activeProjectId) {
      projectMemory = sanitizeProjectMemoryForPrompt(await loadProjectMemory(activeProjectId));
    }
  } catch (_) { /* ignore */ }

  const contextParts = [];

  // System instruction — always present
  contextParts.push(
    "You are Text2LLM, an AI assistant for building and finetuning language models.",
    "Respond naturally to what the user actually says.",
    "Be proactive but stay strictly on-topic for the current user request.",
    "Do not output generic acknowledgements (e.g., 'I got your message').",
    "If clarification is needed, ask only the minimum specific question, otherwise answer directly.",
    "If the user greets you, greet them back warmly.",
    "Do NOT proactively suggest finetuning or project tasks unless the user asks.",
    "Only discuss finetuning, datasets, or model training when the user explicitly brings it up.",
    ""
  );

  // Project memory (user.md) — persistent project context
  if (projectMemory.trim()) {
    contextParts.push(
      "== Project Memory (user.md) ==",
      projectMemory.trim(),
      "== End Project Memory ==",
      ""
    );
  }

  // Conversation history — recent turns for context
  if (conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-20);
    contextParts.push("== Recent Conversation ==");
    for (const msg of recentHistory) {
      const role = msg.role === "user" ? "User" : "Assistant";
      const content = String(msg.content || "").slice(0, 500);
      contextParts.push(`${role}: ${content}`);
    }
    contextParts.push("== End Conversation ==", "");
  }

  // Current user message
  contextParts.push(`User: ${body}`);

  const contextMessage = contextParts.join("\n");
  progress.done("prepare-context", "Context assembled");
  progress.start("launch-agent", "Launch agent", "Starting runtime process");

  const args = [
    "scripts/run-node.mjs",
    "agent",
    "--agent", "main",
    "--local",
    "--message", contextMessage,
  ];

  const env = {
    ...process.env,
    TEXT2LLM_CONFIG_PATH: process.env.TEXT2LLM_CONFIG_PATH || workspaceConfig,
    RUNPOD_API_KEY: process.env.RUNPOD_API_KEY || "text2llm-web-local",
    VAST_API_KEY: process.env.VAST_API_KEY || "text2llm-web-local",
    WANDB_API_KEY: process.env.WANDB_API_KEY || "text2llm-web-local",
    HF_TOKEN: process.env.HF_TOKEN || "text2llm-web-local",
  };

  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env,
    shell: false,
  });

  let emittedVisibleReply = false;
  let stderrTail = "";
  let stdoutTail = "";
  let stdoutFull = "";
  let stdoutLineBuffer = "";
  let pendingChunkText = "";
  let pendingChunkTimer = null;
  let closed = false;

  const heartbeatInterval = setInterval(() => {
    if (closed || res.writableEnded) {
      return;
    }
    sendSSE("heartbeat", { ts: Date.now() });
  }, 5000);

  const delayedStatusTimers = [
    setTimeout(() => {
      if (!closed && !emittedVisibleReply) {
        sendSSE("status", { text: "Still working… collecting model output." });
      }
    }, 3000),
    setTimeout(() => {
      if (!closed && !emittedVisibleReply) {
        sendSSE("status", { text: "This is taking longer than usual, but the agent is still running." });
      }
    }, 12000),
    setTimeout(() => {
      if (!closed && !emittedVisibleReply) {
        sendSSE("status", { text: "Long response in progress. You can stop anytime and retry with a shorter prompt." });
      }
    }, 30000),
  ];

  const clearStreamingTimers = () => {
    clearInterval(heartbeatInterval);
    for (const timer of delayedStatusTimers) {
      clearTimeout(timer);
    }
    if (pendingChunkTimer) {
      clearTimeout(pendingChunkTimer);
      pendingChunkTimer = null;
    }
  };

  const flushPendingChunk = () => {
    if (!pendingChunkText.trim()) {
      pendingChunkText = "";
      return;
    }

    sendSSE("chunk", { text: pendingChunkText.trim() });
    emittedVisibleReply = true;
    pendingChunkText = "";
  };

  const scheduleChunkFlush = () => {
    if (pendingChunkTimer) {
      return;
    }
    pendingChunkTimer = setTimeout(() => {
      pendingChunkTimer = null;
      flushPendingChunk();
    }, 140);
  };

  const queueChunk = (text) => {
    const clean = normalizeStreamChunkText(text);
    if (!clean) {
      return;
    }

    if (!streamStepStarted) {
      streamStepStarted = true;
      progress.done("await-output", "First output received");
      progress.start("stream-output", "Stream response", "Delivering output to chat");
    }

    pendingChunkText += pendingChunkText ? `\n${clean}` : clean;
    scheduleChunkFlush();
  };

  const consumeStdoutLines = (raw, force = false) => {
    if (raw) {
      stdoutLineBuffer += raw;
    }

    const lines = stdoutLineBuffer.split(/\r?\n/);
    const trailing = force ? "" : (lines.pop() || "");

    for (const line of lines) {
      queueChunk(line);
    }

    if (force) {
      const remainder = lines.length === 0 ? stdoutLineBuffer : "";
      if (remainder) {
        queueChunk(remainder);
      }
      stdoutLineBuffer = "";
    } else {
      stdoutLineBuffer = trailing;
    }
  };

  activeSessions.set(sid, child);
  console.log(`[chat] Session ${sid} started (PID ${child.pid})`);
  progress.done("launch-agent", `PID ${child.pid || "unknown"}`);
  progress.start("await-output", "Await model output", "Waiting for first response token");
  let streamStepStarted = false;
  let toolRunCounter = 0;
  const pendingToolRunIds = new Map();

  child.stdout.on("data", (chunk) => {
    const raw = chunk.toString();
    stdoutFull = (stdoutFull + raw).slice(-25000);
    stdoutTail = (stdoutTail + raw).slice(-6000);
    consumeStdoutLines(raw, false);
  });

  let stderrLineBuffer = "";
  child.stderr.on("data", (chunk) => {
    const raw = chunk.toString();
    stderrTail = (stderrTail + raw).slice(-6000);

    // Parse stderr for tool activity patterns and send as thinking events
    stderrLineBuffer += raw;
    const stderrLines = stderrLineBuffer.split(/\r?\n/);
    stderrLineBuffer = stderrLines.pop() || "";

    for (const line of stderrLines) {
      // Match: "embedded run tool start: ... tool=<name>"
      const toolStartMatch = line.match(/embedded run tool start:.*?tool=(\S+)/);
      if (toolStartMatch) {
        const toolName = toolStartMatch[1];
        const metaMatch = line.match(/meta=(.+?)(?:\s|$)/);
        const meta = metaMatch ? metaMatch[1] : undefined;
        toolRunCounter += 1;
        const toolStepId = `tool-${toolRunCounter}`;
        if (!pendingToolRunIds.has(toolName)) {
          pendingToolRunIds.set(toolName, []);
        }
        pendingToolRunIds.get(toolName).push(toolStepId);
        progress.start(toolStepId, `Run tool: ${toolName}`, meta || "Starting");
        sendSSE("thinking", { phase: "start", tool: toolName, meta: meta || undefined });
        continue;
      }

      // Match: "embedded run tool end: ... tool=<name>"
      const toolEndMatch = line.match(/embedded run tool end:.*?tool=(\S+)/);
      if (toolEndMatch) {
        const toolName = toolEndMatch[1];
        const queue = pendingToolRunIds.get(toolName);
        const toolStepId = Array.isArray(queue) && queue.length > 0 ? queue.shift() : null;
        if (toolStepId) {
          progress.done(toolStepId, "Completed");
        }
        sendSSE("thinking", { phase: "end", tool: toolName });
        continue;
      }

      // Match general agent status lines like "[agent/embedded] ..."
      const agentInfoMatch = line.match(/\[agent\/embedded\]\s+(.+)/);
      if (agentInfoMatch && !agentInfoMatch[1].includes("runId=probe-")) {
        const infoText = agentInfoMatch[1].trim();
        if (infoText.length > 5 && infoText.length < 200) {
          progress.update(streamStepStarted ? "stream-output" : "await-output", infoText);
          sendSSE("thinking", { phase: "info", text: infoText });
        }
      }
    }
  });

  child.on("error", (error) => {
    closed = true;
    progress.error("launch-agent", error.message || "Process error");
    progress.error("request", "Failed");
    clearStreamingTimers();
    sendSSE("error", { message: error.message });
    activeSessions.delete(sid);
    res.end();
  });

  child.on("close", (code) => {
    closed = true;
    consumeStdoutLines("", true);
    flushPendingChunk();

    const finalAnswer = extractFinalAnswerOnly(stdoutFull);
    if (!emittedVisibleReply && finalAnswer) {
      emittedVisibleReply = true;
      sendSSE("chunk", { text: finalAnswer });
    }

    if (!emittedVisibleReply) {
      if (code === 0) {
        sendSSE("chunk", {
          text: "I could not generate a visible reply for that request. Please try again, or check provider/auth settings in Settings.",
        });
      } else {
        const debug = sanitizeChatAgentText(stderrTail || stdoutTail);
        sendSSE("error", {
          message: debug || `Agent process exited with code ${code}. Check provider/auth settings in Settings.`,
        });
      }
    }
    if (streamStepStarted) {
      progress.done("stream-output", code === 0 ? "Completed" : "Stopped with errors");
    } else {
      progress.done("await-output", code === 0 ? "No streamed output" : "Stopped with errors");
    }
    if (code === 0) {
      progress.done("request", "Completed");
    } else {
      progress.error("request", `Exited with code ${code}`);
    }
    sendSSE("done", { code });
    clearStreamingTimers();
    activeSessions.delete(sid);
    res.end();
    console.log(`[chat] Session ${sid} ended (code ${code})`);
  });

  // Cleanup on real client disconnect/abort only.
  req.on("aborted", () => {
    if (activeSessions.has(sid)) {
      console.log(`[chat] Client aborted request, killing session ${sid}`);
      child.kill();
      activeSessions.delete(sid);
    }
  });

  res.on("close", () => {
    if (!res.writableEnded && activeSessions.has(sid)) {
      console.log(`[chat] Response closed early, killing session ${sid}`);
      child.kill();
      activeSessions.delete(sid);
    }
  });
});

app.post("/api/chat/stop", (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId || !activeSessions.has(sessionId)) {
    return res.status(404).json({ ok: false, error: "No active session found" });
  }
  const child = activeSessions.get(sessionId);
  child.kill();
  activeSessions.delete(sessionId);
  res.json({ ok: true, message: "Session stopped" });
});

/* ═══════════════════════════════════════════════
   Store — AI Resource Search API (proxy to external sources)
   ═══════════════════════════════════════════════ */

// In-memory project resources (persisted to workspace config)
let storeProjectResourcesByProject = {};

// Search cache
const searchCache = new Map();
const SEARCH_CACHE_TTL = 1000 * 60 * 5; // 5 minutes

/**
 * Parse an arXiv Atom XML response into normalized resources.
 */
function parseArxivAtom(xml) {
  const entries = [];
  const entryRegex = /<entry\b[^>]*>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
      const match = r.exec(block);
      return match ? match[1].trim() : "";
    };
    const getAttr = (tag, attr) => {
      const r = new RegExp(`<${tag}[^>]*?${attr}="([^"]*)"`, "i");
      const match = r.exec(block);
      return match ? match[1] : "";
    };

    const id = get("id");
    const title = get("title").replace(/\s+/g, " ");
    const summary = get("summary").replace(/\s+/g, " ");
    const published = get("published");
    const updated = get("updated");

    // Authors
    const authors = [];
    const authorRegex = /<author\b[^>]*>[\s\S]*?<name\b[^>]*>([^<]+)<\/name>[\s\S]*?<\/author>/g;
    let am;
    while ((am = authorRegex.exec(block)) !== null) {
      authors.push(am[1].trim());
    }

    // Categories
    const categories = [];
    const catRegex = /category[^>]+term="([^"]+)"/g;
    let cm;
    while ((cm = catRegex.exec(block)) !== null) {
      categories.push(cm[1]);
    }

    // PDF link
    const pdfLink = getAttr('link[^>]*title="pdf"', "href") ||
                    id.replace("abs", "pdf");

    const arxivId = id.replace("http://arxiv.org/abs/", "").replace(/v\d+$/, "");

    entries.push({
      id: `arxiv:${arxivId}`,
      type: "paper",
      source: "arxiv",
      name: title,
      author: authors.slice(0, 3).join(", ") + (authors.length > 3 ? " et al." : ""),
      description: summary.slice(0, 300),
      url: id,
      metrics: { citations: null },
      tags: categories.slice(0, 5),
      license: "arXiv",
      updatedAt: updated || published,
    });
  }
  return entries;
}

function withResultMeta(items, meta = {}) {
  const list = Array.isArray(items) ? items : [];
  list._meta = meta;
  return list;
}

function getResultMeta(items) {
  if (Array.isArray(items) && items._meta && typeof items._meta === "object") {
    return items._meta;
  }
  return {};
}

function parseArxivTotalResults(xml) {
  const match = /<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/i.exec(xml || "");
  return match ? Number(match[1]) : null;
}

/**
 * Search Hugging Face Hub for models and datasets.
 */
async function searchHuggingFace(query, type, sort, page, limit) {
  const results = [];
  let hasMoreAcrossTypes = false;
  let totalGlobalCount = 0;
  const hfToken = process.env.HF_TOKEN;
  const headers = {};
  if (hfToken && hfToken !== "text2llm-web-local") {
    headers["Authorization"] = `Bearer ${hfToken}`;
  }

  const searchTypes = type === "all" ? ["model", "dataset"] :
                      type === "model" ? ["model"] :
                      type === "dataset" ? ["dataset"] : [];

  const resolveNextLink = (linkHeader) => {
    if (!linkHeader) return null;
    const parts = linkHeader.split(",");
    for (const part of parts) {
      const trimmed = part.trim();
      if (!/rel=\"next\"/i.test(trimmed)) continue;
      const match = trimmed.match(/<([^>]+)>/);
      if (!match?.[1]) continue;
      const href = match[1].trim();
      if (/^https?:\/\//i.test(href)) return href;
      return `https://huggingface.co${href.startsWith("/") ? "" : "/"}${href}`;
    }
    return null;
  };

  for (const sType of searchTypes) {
    const endpoint = sType === "model" ? "models" : "datasets";
    const sortParam = sort === "downloads" ? "downloads" : sort === "stars" ? "likes" : sort === "recent" ? "lastModified" : "downloads";

    const baseUrl = new URL(`https://huggingface.co/api/${endpoint}`);
    baseUrl.searchParams.set("search", query);
    baseUrl.searchParams.set("sort", sortParam);
    baseUrl.searchParams.set("direction", "-1");
    baseUrl.searchParams.set("limit", String(limit));
    let pageUrl = baseUrl.toString();
    let pageItems = [];
    let typeHasMore = false;

    try {
      for (let currentPage = 1; currentPage <= page; currentPage++) {
        const resp = await fetch(pageUrl, { headers, signal: AbortSignal.timeout(4000) });
        
        if (currentPage === 1) {
          const t = parseInt(resp.headers.get("x-total-count"), 10);
          if (!isNaN(t)) totalGlobalCount += t;
        }

        if (!resp.ok) {
          pageItems = [];
          break;
        }
        const items = await resp.json();
        if (!Array.isArray(items)) {
          pageItems = [];
          break;
        }
        const nextLink = resolveNextLink(resp.headers.get("link"));
        if (currentPage === page) {
          pageItems = items;
          typeHasMore = Boolean(nextLink);
          break;
        }
        if (!nextLink) {
          pageItems = [];
          break;
        }
        pageUrl = nextLink;
      }

      for (const item of pageItems) {
        results.push({
          id: `hf:${sType}:${item.id || item.modelId}`,
          type: sType,
          source: "huggingface",
          name: item.id || item.modelId,
          author: (item.id || item.modelId || "").split("/")[0] || "",
          description: item.description || item.cardData?.description || "",
          url: `https://huggingface.co/${sType === "dataset" ? "datasets/" : ""}${item.id || item.modelId}`,
          metrics: {
            downloads: item.downloads,
            likes: item.likes,
            stars: item.likes,
          },
          tags: [
            ...(item.tags || []).slice(0, 3),
            ...(item.pipeline_tag ? [item.pipeline_tag] : []),
          ],
          license: item.cardData?.license || (item.tags || []).find(t => t.startsWith("license:"))?.replace("license:", "") || "",
          updatedAt: item.lastModified || item.updatedAt || "",
        });
      }
      if (typeHasMore) {
        hasMoreAcrossTypes = true;
      }
    } catch (err) {
      console.error(`HF ${sType} search error:`, err.message);
    }
  }

  return withResultMeta(results, {
    hasMore: hasMoreAcrossTypes,
    totalCount: totalGlobalCount > 0 ? totalGlobalCount : undefined,
  });
}

/**
 * Search GitHub repositories for ML code/tools.
 */
async function searchGitHub(query, sort, page, limit) {
  const ghToken = process.env.GITHUB_TOKEN;
  const headers = { "Accept": "application/vnd.github+json" };
  if (ghToken) {
    headers["Authorization"] = `Bearer ${ghToken}`;
  }

  const sortParam = sort === "stars" ? "stars" : sort === "recent" ? "updated" : "stars";
  // Use the bare query + minimum stars to get relevant ML repos without over-constraining
  const q = encodeURIComponent(`${query} in:name,description,readme stars:>5`);
  const url = `https://api.github.com/search/repositories?q=${q}&sort=${sortParam}&order=desc&per_page=${limit}&page=${page}`;

  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    const totalCount = Number(data.total_count || 0);
    const mapped = (data.items || []).map(repo => ({
      id: `gh:${repo.full_name}`,
      type: "code",
      source: "github",
      name: repo.full_name,
      author: repo.owner?.login || "",
      description: repo.description || "",
      url: repo.html_url,
      metrics: {
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        downloads: null,
      },
      tags: (repo.topics || []).slice(0, 5),
      license: repo.license?.spdx_id || "",
      updatedAt: repo.updated_at || repo.pushed_at || "",
    }));
    return withResultMeta(mapped, {
      totalCount,
      hasMore: page * limit < totalCount,
    });
  } catch (err) {
    console.error("GitHub search error:", err.message);
    return [];
  }
}

/**
 * Search arXiv for research papers.
 */
async function searchArxiv(query, sort, page, limit) {
  const sortBy = sort === "recent" ? "submittedDate" : "relevance";
  const start = (page - 1) * limit;
  const url = `https://arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=${start}&max_results=${limit}&sortBy=${sortBy}&sortOrder=descending`;
  const headers = {
    "Accept": "application/atom+xml, text/xml;q=0.9, */*;q=0.8",
    "User-Agent": "text2llm-web/1.0 (+https://localhost)",
  };

  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return await searchArxivViaSemanticScholar(query, sort, page, limit);
    const xml = await resp.text();
    if (!xml || /rate\s+exceeded/i.test(xml)) return await searchArxivViaSemanticScholar(query, sort, page, limit);
    const parsed = parseArxivAtom(xml);
    if (parsed.length > 0) {
      const totalCount = parseArxivTotalResults(xml);
      return withResultMeta(parsed, {
        totalCount: Number.isFinite(totalCount) ? totalCount : undefined,
        hasMore: Number.isFinite(totalCount) ? page * limit < totalCount : parsed.length === limit,
      });
    }
    return await searchArxivViaSemanticScholar(query, sort, page, limit);
  } catch (err) {
    console.error("arXiv search error:", err.message);
    return await searchArxivViaSemanticScholar(query, sort, page, limit);
  }
}

async function searchArxivViaSemanticScholar(query, sort, page, limit) {
  try {
    if (!process.env.SEMANTIC_SCHOLAR_API_KEY) {
      const dblpFallback = await searchDBLP(query, page, limit);
      const dblpMeta = getResultMeta(dblpFallback);
      const mapped = dblpFallback.slice(0, limit).map((paper) => ({
        ...paper,
        id: `arxiv:dblp:${paper.id.replace(/^dblp:/, "")}`,
        source: "arxiv",
        license: paper.license || "arXiv",
      }));
      return withResultMeta(mapped, {
        hasMore: Boolean(dblpMeta.hasMore) || mapped.length === limit,
      });
    }

    const s2Papers = await searchSemanticScholar(query, sort, page, Math.max(limit * 2, 20));
    const s2Meta = getResultMeta(s2Papers);
    const fromArxiv = s2Papers
      .filter(paper => /arxiv\.org\/(abs|pdf)\//i.test(paper.url || ""))
      .slice(0, limit)
      .map(paper => {
        const idMatch = /arxiv\.org\/(?:abs|pdf)\/([^?#/]+)/i.exec(paper.url || "");
        const arxivId = idMatch?.[1] || paper.id.replace(/^s2:/, "");
        return {
          ...paper,
          id: `arxiv:${arxivId}`,
          source: "arxiv",
          license: "arXiv",
        };
      });
    if (fromArxiv.length > 0) {
      return withResultMeta(fromArxiv, {
        hasMore: Boolean(s2Meta.hasMore) || fromArxiv.length === limit,
      });
    }

    const mapped = s2Papers.slice(0, limit).map(paper => ({
      ...paper,
      id: `arxiv:s2:${paper.id.replace(/^s2:/, "")}`,
      source: "arxiv",
      license: paper.license || "arXiv",
    }));
    return withResultMeta(mapped, {
      hasMore: Boolean(s2Meta.hasMore) || mapped.length === limit,
    });
  } catch (err) {
    console.error("arXiv fallback search error:", err.message);
    return [];
  }
}

/**
 * Search Papers With Code — aggregates multiple sources to find papers with associated code.
 * PapersWithCode API is non-functional (returns HTML). We combine:
 * 1. Semantic Scholar API with openAccessPdf/externalIds to find papers with code repos
 * 2. HuggingFace daily papers as a supplement for trending research
 * 3. GitHub search for associated code repos
 */
async function searchPapersWithCode(query, page, limit) {
  try {
    const promises = [];

    // Source 1: Semantic Scholar — larger corpus, with code/PDF indicators
    const s2Offset = (page - 1) * Math.ceil(limit * 1.5);
    const s2Url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query + " code implementation")}&offset=${s2Offset}&limit=${Math.ceil(limit * 1.5)}&fields=title,abstract,authors,citationCount,year,url,openAccessPdf,externalIds,fieldsOfStudy,publicationDate`;
    const s2Headers = {};
    const s2Key = process.env.SEMANTIC_SCHOLAR_API_KEY;
    if (s2Key) s2Headers["x-api-key"] = s2Key;

    promises.push(
      (async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const resp = await fetch(s2Url, { headers: s2Headers, signal: AbortSignal.timeout(4000) });
            if (resp.status === 429) {
              await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
              continue;
            }
            if (!resp.ok) return [];
            const data = await resp.json();
            return (data.data || []).map(paper => {
              const arxivId = paper.externalIds?.ArXiv;
              const paperUrl = arxivId
                ? `https://arxiv.org/abs/${arxivId}`
                : (paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`);
              return {
                id: `pwc:s2:${paper.paperId}`,
                type: "paper",
                source: "paperswithcode",
                name: paper.title || "Untitled",
                author: (paper.authors || []).slice(0, 3).map(a => a.name).join(", ") + ((paper.authors || []).length > 3 ? " et al." : ""),
                description: (paper.abstract || "").slice(0, 300),
                url: paperUrl,
                metrics: {
                  citations: paper.citationCount || 0,
                  stars: paper.openAccessPdf ? 1 : 0, // boost papers with PDFs
                },
                tags: (paper.fieldsOfStudy || []).slice(0, 4),
                license: paper.openAccessPdf ? "Open Access" : "",
                updatedAt: paper.publicationDate || (paper.year ? `${paper.year}-01-01` : ""),
              };
            });
          } catch {
            if (attempt < 1) continue;
            return [];
          }
        }
        return [];
      })()
    );

    // Source 2: HuggingFace daily papers (trending recent papers)
    promises.push(
      (async () => {
        try {
          const resp = await fetch(`https://huggingface.co/api/daily_papers?limit=30`, {
            headers: { "Accept": "application/json" },
            signal: AbortSignal.timeout(3000),
          });
          if (!resp.ok) return [];
          const data = await resp.json();
          if (!Array.isArray(data)) return [];

          const q = query.toLowerCase();
          const queryTokens = q.split(/\s+/).filter(Boolean);

          let filtered = data.filter(item => {
            const title = (item.paper?.title || item.title || "").toLowerCase();
            const abstract = (item.paper?.summary || "").toLowerCase();
            return queryTokens.some(tok => title.includes(tok) || abstract.includes(tok));
          });

          // If no query match, include all trending papers
          if (filtered.length === 0) filtered = data;

          return filtered.map(item => {
            const paper = item.paper || item;
            const authors = (paper.authors || []).slice(0, 3).map(a => a.name || a._id || "").join(", ");
            return {
              id: `pwc:hf:${paper.id || Math.random().toString(36).slice(2)}`,
              type: "paper",
              source: "paperswithcode",
              name: paper.title || "Untitled",
              author: authors,
              description: (paper.summary || paper.abstract || "").slice(0, 300),
              url: paper.id ? `https://arxiv.org/abs/${paper.id}` : (paper.url || ""),
              metrics: {
                stars: item.paper?.upvotes || item.numComments || null,
                citations: null,
              },
              tags: ["trending"],
              license: "",
              updatedAt: item.publishedAt || paper.publishedAt || "",
            };
          });
        } catch {
          return [];
        }
      })()
    );

    const settled = await Promise.allSettled(promises);
    let results = [];
    for (const r of settled) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        results = results.concat(r.value);
      }
    }

    // Deduplicate by normalized title
    const seen = new Set();
    results = results.filter(item => {
      const key = (item.name || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort: papers with citations/stars first
    results.sort((a, b) => {
      const aScore = (a.metrics.citations || 0) + (a.metrics.stars || 0) * 10;
      const bScore = (b.metrics.citations || 0) + (b.metrics.stars || 0) * 10;
      return bScore - aScore;
    });

    const start = (page - 1) * limit;
    return withResultMeta(results.slice(start, start + limit), {
      totalCount: results.length,
      hasMore: start + limit < results.length,
    });
  } catch (err) {
    console.error("Papers With Code search error:", err.message);
    return [];
  }
}

/**
 * Search Semantic Scholar for academic papers with citation data.
 */
async function searchSemanticScholar(query, sort, page, limit) {
  const offset = (page - 1) * limit;
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}&fields=title,abstract,authors,citationCount,year,url,openAccessPdf,fieldsOfStudy,publicationDate`;

  const headers = {};
  const s2Key = process.env.SEMANTIC_SCHOLAR_API_KEY;
  if (s2Key) headers["x-api-key"] = s2Key;

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (resp.status === 429) {
        const retryAfter = Number(resp.headers.get("retry-after") || NaN);
        const delayMs = Number.isFinite(retryAfter) ? Math.max(1000, retryAfter * 1000) : 5000 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      if (!resp.ok) return [];
      const data = await resp.json();
      const totalCount = Number(data.total ?? NaN);
      const mapped = (data.data || []).map(paper => ({
        id: `s2:${paper.paperId}`,
        type: "paper",
        source: "semanticscholar",
        name: paper.title || "Untitled",
        author: (paper.authors || []).slice(0, 3).map(a => a.name).join(", ") + ((paper.authors || []).length > 3 ? " et al." : ""),
        description: (paper.abstract || "").slice(0, 300),
        url: paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`,
        metrics: {
          citations: paper.citationCount || 0,
        },
        tags: (paper.fieldsOfStudy || []).slice(0, 4),
        license: paper.openAccessPdf ? "Open Access" : "",
        updatedAt: paper.publicationDate || (paper.year ? `${paper.year}-01-01` : ""),
      }));
      return withResultMeta(mapped, {
        totalCount: Number.isFinite(totalCount) ? totalCount : undefined,
        hasMore: Number.isFinite(totalCount) ? offset + mapped.length < totalCount : mapped.length === limit,
      });
    }
    const dblpFallback = await searchDBLP(query, page, limit);
    const dblpMeta = getResultMeta(dblpFallback);
    const mapped = dblpFallback.map((paper) => ({
      ...paper,
      id: `s2:fallback:${paper.id.replace(/^dblp:/, "")}`,
      source: "semanticscholar",
      license: paper.license || "Open Access",
    }));
    return withResultMeta(mapped, {
      totalCount: dblpMeta.totalCount,
      hasMore: Boolean(dblpMeta.hasMore),
    });
  } catch (err) {
    console.error("Semantic Scholar search error:", err.message);
    const dblpFallback = await searchDBLP(query, page, limit);
    const dblpMeta = getResultMeta(dblpFallback);
    const mapped = dblpFallback.map((paper) => ({
      ...paper,
      id: `s2:fallback:${paper.id.replace(/^dblp:/, "")}`,
      source: "semanticscholar",
      license: paper.license || "Open Access",
    }));
    return withResultMeta(mapped, {
      totalCount: dblpMeta.totalCount,
      hasMore: Boolean(dblpMeta.hasMore),
    });
  }
}

/**
 * Search Civitai for image generation models, LoRAs, etc.
 */
async function searchCivitai(query, sort, page, limit) {
  const sortParam = sort === "recent" ? "Newest" : sort === "downloads" ? "Most Downloaded" : "Highest Rated";

  try {
    let cursor = null;
    let pageData = { items: [], metadata: {} };
    for (let currentPage = 1; currentPage <= page; currentPage++) {
      const url = new URL("https://civitai.com/api/v1/models");
      url.searchParams.set("query", query);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("sort", sortParam);
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }
      const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(6000) });
      if (!resp.ok) return [];
      const data = await resp.json();
      pageData = data && typeof data === "object" ? data : { items: [], metadata: {} };
      if (currentPage === page) {
        break;
      }
      const nextCursor = pageData.metadata?.nextCursor;
      if (!nextCursor) {
        pageData = { items: [], metadata: pageData.metadata || {} };
        break;
      }
      cursor = String(nextCursor);
    }

    const items = Array.isArray(pageData.items) ? pageData.items : [];
    const totalCount = Number(pageData.metadata?.totalItems ?? pageData.metadata?.total ?? NaN);
    const hasMore = Boolean(pageData.metadata?.nextCursor) ||
      (Number.isFinite(totalCount) ? page * limit < totalCount : items.length === limit);
    const mapped = items.map(item => ({
      id: `civitai:${item.id}`,
      type: "model",
      source: "civitai",
      name: item.name || "Untitled",
      author: item.creator?.username || "",
      description: (item.description || "").replace(/<[^>]*>/g, "").slice(0, 300),
      url: `https://civitai.com/models/${item.id}`,
      metrics: {
        downloads: item.stats?.downloadCount || 0,
        likes: item.stats?.thumbsUpCount || item.stats?.favoriteCount || 0,
        stars: item.stats?.rating ? Math.round(item.stats.rating * 100) : null,
      },
      tags: (item.tags || []).slice(0, 5),
      license: item.allowCommercialUse || "",
      updatedAt: item.updatedAt || item.publishedAt || "",
    }));
    return withResultMeta(mapped, {
      totalCount: Number.isFinite(totalCount) ? totalCount : undefined,
      hasMore,
    });
  } catch (err) {
    console.error("Civitai search error:", err.message);
    return [];
  }
}

/**
 * Search Kaggle for datasets and notebooks (competitions).
 * Uses the Kaggle public dataset search endpoint (no auth required for basic search).
 */
async function searchKaggle(query, type, sort, page, limit) {
  const results = [];

  // Search datasets
  if (type === "all" || type === "dataset") {
    try {
      const sortParam = sort === "recent" ? "updated" : sort === "downloads" ? "downloadCount" : "relevance";
      const url = `https://www.kaggle.com/api/v1/datasets/list?search=${encodeURIComponent(query)}&sortBy=${sortParam}&page=${page}&maxSize=&minSize=&filetype=all`;
      const headers = { "Accept": "application/json" };
      const kaggleKey = process.env.KAGGLE_KEY;
      const kaggleUser = process.env.KAGGLE_USERNAME;
      if (kaggleKey && kaggleUser) {
        headers["Authorization"] = `Basic ${Buffer.from(`${kaggleUser}:${kaggleKey}`).toString("base64")}`;
      }

      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
      if (resp.ok) {
        const data = await resp.json();
        for (const ds of (Array.isArray(data) ? data : data.datasets || [])) {
          results.push({
            id: `kaggle:dataset:${ds.ref || ds.id}`,
            type: "dataset",
            source: "kaggle",
            name: ds.title || ds.ref || "Untitled",
            author: ds.ownerName || ds.creatorName || "",
            description: (ds.subtitle || ds.description || "").slice(0, 300),
            url: `https://www.kaggle.com/datasets/${ds.ref || ""}`,
            metrics: {
              downloads: ds.downloadCount || ds.totalDownloads || null,
              likes: ds.voteCount || ds.usabilityRating || null,
              stars: ds.voteCount || null,
            },
            tags: (ds.tags || []).map(t => typeof t === "string" ? t : t.name || "").slice(0, 5),
            license: ds.licenseName || "",
            updatedAt: ds.lastUpdated || "",
          });
        }
      }
    } catch (err) {
      console.error("Kaggle dataset search error:", err.message);
    }
  }

  // Search models / notebooks as "code" type
  if (type === "all" || type === "code") {
    try {
      const url = `https://www.kaggle.com/api/v1/kernels/list?search=${encodeURIComponent(query)}&page=${page}&pageSize=${limit}&sortBy=voteCount`;
      const headers = { "Accept": "application/json" };
      const kaggleKey = process.env.KAGGLE_KEY;
      const kaggleUser = process.env.KAGGLE_USERNAME;
      if (kaggleKey && kaggleUser) {
        headers["Authorization"] = `Basic ${Buffer.from(`${kaggleUser}:${kaggleKey}`).toString("base64")}`;
      }

      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
      if (resp.ok) {
        const data = await resp.json();
        for (const nb of (Array.isArray(data) ? data : data.kernels || [])) {
          results.push({
            id: `kaggle:notebook:${nb.ref || nb.id}`,
            type: "code",
            source: "kaggle",
            name: nb.title || nb.ref || "Untitled Notebook",
            author: nb.author || "",
            description: (nb.description || `Kaggle notebook: ${nb.title || ""}`).slice(0, 300),
            url: `https://www.kaggle.com/code/${nb.ref || ""}`,
            metrics: {
              stars: nb.totalVotes || null,
              downloads: null,
            },
            tags: (nb.tags || []).map(t => typeof t === "string" ? t : t.name || "").slice(0, 4),
            license: "",
            updatedAt: nb.lastRunTime || "",
          });
        }
      }
    } catch (err) {
      console.error("Kaggle notebook search error:", err.message);
    }
  }

  const pageItems = results.slice(0, limit);
  return withResultMeta(pageItems, {
    hasMore: results.length > limit || pageItems.length === limit,
  });
}

/**
 * Search Zenodo for research datasets and software.
 */
async function searchZenodo(query, sort, page, limit) {
  const sortParam = sort === "recent" ? "mostrecent" : sort === "downloads" ? "-stats.downloads" : "bestmatch";
  const url = `https://zenodo.org/api/records?q=${encodeURIComponent(query)}&size=${limit}&page=${page}&sort=${sortParam}`;

  try {
    let data = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (resp.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
        continue;
      }
      if (!resp.ok) return [];
      data = await resp.json();
      break;
    }
    if (!data || typeof data !== "object") {
      return [];
    }

    const records = data.hits?.hits || [];
    const rawTotal = data.hits?.total;
    const totalCount = typeof rawTotal === "number" ? rawTotal : Number(rawTotal?.value ?? NaN);
    const mapped = records.map(item => {
      const meta = item.metadata || {};
      return {
        id: `zenodo:${item.id}`,
        type: meta.resource_type?.type === "dataset" ? "dataset" : meta.resource_type?.type === "software" ? "code" : "paper",
        source: "zenodo",
        name: meta.title || "Untitled",
        author: (meta.creators || []).slice(0, 3).map(c => c.name).join(", "),
        description: (meta.description || "").replace(/<[^>]*>/g, "").slice(0, 300),
        url: item.links?.html || `https://zenodo.org/records/${item.id}`,
        metrics: {
          downloads: item.stats?.downloads || null,
          citations: null,
        },
        tags: (meta.keywords || []).slice(0, 5),
        license: meta.license?.id || "",
        updatedAt: meta.publication_date || item.updated || "",
      };
    });
    return withResultMeta(mapped, {
      totalCount: Number.isFinite(totalCount) ? totalCount : undefined,
      hasMore: Number.isFinite(totalCount) ? page * limit < totalCount : mapped.length === limit,
    });
  } catch (err) {
    console.error("Zenodo search error:", err.message);
    return [];
  }
}

/**
 * Search DBLP for computer science papers.
 */
async function searchDBLP(query, page, limit) {
  const first = (page - 1) * limit;
  const url = `https://dblp.org/search/publ/api?q=${encodeURIComponent(query)}&format=json&h=${limit}&f=${first}`;

  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        "Accept": "application/json",
        "User-Agent": "text2llm-web/1.0 (+https://localhost)",
      },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const totalCount = Number(data.result?.hits?.["@total"] ?? NaN);

    const hits = data.result?.hits?.hit || [];
    const mapped = hits.map(hit => {
      const info = hit.info || {};
      const authors = info.authors?.author || [];
      const authorList = Array.isArray(authors) ? authors : [authors];
      return {
        id: `dblp:${info.key || hit["@id"]}`,
        type: "paper",
        source: "dblp",
        name: info.title || "Untitled",
        author: authorList.slice(0, 3).map(a => typeof a === "string" ? a : a.text || a["#text"] || "").join(", "),
        description: `${info.venue || ""} ${info.year || ""}`.trim(),
        url: info.ee || info.url || `https://dblp.org/rec/${info.key}`,
        metrics: { citations: null },
        tags: info.venue ? [info.venue] : [],
        license: "",
        updatedAt: info.year ? `${info.year}-01-01` : "",
      };
    });
    return withResultMeta(mapped, {
      totalCount: Number.isFinite(totalCount) ? totalCount : undefined,
      hasMore: Number.isFinite(totalCount) ? first + mapped.length < totalCount : mapped.length === limit,
    });
  } catch (err) {
    console.error("DBLP search error:", err.message);
    return [];
  }
}

/**
 * Search Ollama library for locally-runnable models.
 */
// Cache for Ollama library (scraped from HTML — 200+ models vs 31 from /api/tags)
let ollamaLibraryCache = [];
let ollamaLibraryCacheTime = 0;
const OLLAMA_LIBRARY_TTL = 1000 * 60 * 60; // 1 hour

function parsePullCount(str) {
  if (!str) return 0;
  const s = str.trim().toUpperCase();
  const num = parseFloat(s);
  if (isNaN(num)) return 0;
  if (s.endsWith("B")) return num * 1_000_000_000;
  if (s.endsWith("M")) return num * 1_000_000;
  if (s.endsWith("K")) return num * 1_000;
  return num;
}

async function fetchOllamaLibrary() {
  if (ollamaLibraryCache.length > 0 && Date.now() - ollamaLibraryCacheTime < OLLAMA_LIBRARY_TTL) {
    return ollamaLibraryCache;
  }
  try {
    const resp = await fetch("https://ollama.com/library", { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    const models = [];
    const regex = /<li x-test-model[^>]*>[\s\S]*?<a href="\/library\/([^"]+)"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<span x-test-pull-count>([^<]*)<\/span>/g;
    let m;
    while ((m = regex.exec(html))) {
      models.push({
        name: m[1].trim(),
        description: m[2].replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim(),
        pullsRaw: m[3].trim(),
        pulls: parsePullCount(m[3]),
      });
    }
    if (models.length > 0) {
      ollamaLibraryCache = models;
      ollamaLibraryCacheTime = Date.now();
      console.log(`Ollama library cached: ${models.length} models`);
    }
    return models;
  } catch (err) {
    console.error("Ollama library fetch error:", err.message);
    // Fall back to stale cache or /api/tags
    if (ollamaLibraryCache.length > 0) return ollamaLibraryCache;
    try {
      const resp = await fetch("https://ollama.com/api/tags", { signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        const data = await resp.json();
        return (data.models || []).map(m => ({
          name: m.name || "",
          description: m.description || "",
          pullsRaw: "",
          pulls: m.pulls || 0,
        }));
      }
    } catch { /* ignore */ }
    return [];
  }
}

async function searchOllama(query, page, limit) {
  try {
    const allModels = await fetchOllamaLibrary();
    const q = query.toLowerCase();
    const queryTokens = q.split(/\s+/).filter(Boolean);

    // Fuzzy match: any query token matches name or description
    let models = allModels.filter(m => {
      const combined = `${m.name} ${m.description}`.toLowerCase();
      return queryTokens.length === 0 || queryTokens.some(tok => combined.includes(tok));
    });

    // If no matches found, return all available models
    if (models.length === 0) {
      models = [...allModels];
    }
    const totalMatches = models.length;

    // Sort by relevance (exact name match first, then partial, then by pulls)
    models.sort((a, b) => {
      const aName = (a.name || "").toLowerCase();
      const bName = (b.name || "").toLowerCase();
      const aExact = aName === q ? 2 : aName.includes(q) ? 1 : 0;
      const bExact = bName === q ? 2 : bName.includes(q) ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return (b.pulls || 0) - (a.pulls || 0);
    });

    const start = (page - 1) * limit;
    models = models.slice(start, start + limit);

    const mapped = models.map(m => ({
      id: `ollama:${m.name}`,
      type: "model",
      source: "ollama",
      name: m.name || "Unknown",
      author: "Ollama",
      description: m.description || `Ollama model: ${m.name}`,
      url: `https://ollama.com/library/${(m.name || "").split(":")[0]}`,
      metrics: {
        downloads: m.pulls || null,
        stars: null,
      },
      tags: ["ollama", "local"],
      license: "",
      updatedAt: "",
    }));
    return withResultMeta(mapped, {
      totalCount: totalMatches,
      hasMore: start + mapped.length < totalMatches,
    });
  } catch (err) {
    console.error("Ollama search error:", err.message);
    return [];
  }
}

// Cache for Replicate explore catalog (scraped from HTML — 165+ models vs 15 hardcoded)
let replicateCatalogCache = [];
let replicateCatalogCacheTime = 0;
const REPLICATE_CATALOG_TTL = 1000 * 60 * 60; // 1 hour

async function fetchReplicateExplore() {
  if (replicateCatalogCache.length > 0 && Date.now() - replicateCatalogCacheTime < REPLICATE_CATALOG_TTL) {
    return replicateCatalogCache;
  }
  try {
    const resp = await fetch("https://replicate.com/explore", {
      signal: AbortSignal.timeout(3000),
      headers: { "User-Agent": "text2llm/1.0" },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();

    // Extract unique owner/model links from explore page
    const modelLinks = [...new Set([...html.matchAll(/href="\/([\w][\w-]*\/[\w][\w._-]*)"/g)].map(m => m[1]))];

    if (modelLinks.length > 0) {
      // Infer category tags from the section context — each model name is descriptive enough
      const catalog = modelLinks.map(link => {
        const [owner, name] = link.split("/");
        // Derive tags from model/owner name
        const combined = `${owner} ${name}`.toLowerCase();
        const tags = ["replicate", "cloud"];
        if (/flux|sdxl|stable.?diff|imagen|dalle|image.?gen/.test(combined)) tags.push("image-generation");
        if (/llama|mistral|gemma|phi|qwen|gpt|chat|instruct|lm/.test(combined)) tags.push("llm");
        if (/whisper|speech|tts|audio|music|voice/.test(combined)) tags.push("audio");
        if (/video|animate|motion/.test(combined)) tags.push("video");
        if (/code|program/.test(combined)) tags.push("code");
        if (/embed|clip|feature/.test(combined)) tags.push("embedding");
        if (/ocr|text.?extract|detect/.test(combined)) tags.push("vision");
        if (/3d|mesh|point.?cloud|nerf/.test(combined)) tags.push("3d");
        if (/upscal|super.?res|esrgan|restore/.test(combined)) tags.push("upscaling");
        if (/face|portrait/.test(combined)) tags.push("face");
        if (/lora|fine.?tun/.test(combined)) tags.push("fine-tuning");
        return { owner, name, tags };
      });
      replicateCatalogCache = catalog;
      replicateCatalogCacheTime = Date.now();
      console.log(`Replicate catalog cached: ${catalog.length} models`);
      return catalog;
    }
  } catch (err) {
    console.error("Replicate explore fetch error:", err.message);
  }
  // Stale cache or fallback to hardcoded
  if (replicateCatalogCache.length > 0) return replicateCatalogCache;
  return null; // signals to use hardcoded fallback
}

/**
 * Search Replicate for cloud-hosted ML models.
 */
async function searchReplicate(query, page, limit) {
  // Use Replicate's public models API endpoint
  try {
    const replicateToken = process.env.REPLICATE_API_TOKEN;

    // If we have a token, use the official API
    if (replicateToken) {
      const headers = { "Authorization": `Bearer ${replicateToken}` };
      const resp = await fetch(`https://api.replicate.com/v1/models?query=${encodeURIComponent(query)}`, {
        headers,
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        const data = await resp.json();
        const models = (data.results || []).slice(0, limit).map(model => ({
          id: `replicate:${model.owner}/${model.name}`,
          type: "model",
          source: "replicate",
          name: `${model.owner}/${model.name}`,
          author: model.owner || "Replicate",
          description: (model.description || "").slice(0, 300),
          url: model.url || `https://replicate.com/${model.owner}/${model.name}`,
          metrics: {
            stars: model.run_count || null,
            downloads: model.run_count || null,
          },
          tags: ["replicate", "cloud"],
          license: model.license_url ? "Open" : "",
          updatedAt: model.latest_version?.created_at || "",
        }));
        return withResultMeta(models, {
          hasMore: Boolean(data.next),
        });
      }
    }

    // No token: scrape the full explore catalog (165+ models)
    const exploreCatalog = await fetchReplicateExplore();
    if (exploreCatalog && exploreCatalog.length > 0) {
      return searchReplicateFromDynamicCatalog(exploreCatalog, query, page, limit);
    }

    // Final fallback: static catalog
    return searchReplicateFromCatalog(query, page, limit);
  } catch (err) {
    console.error("Replicate search error:", err.message);
    return searchReplicateFromCatalog(query, page, limit);
  }
}

function searchReplicateFromDynamicCatalog(catalog, query, page, limit) {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  let matches = catalog.filter(m => {
    const combined = `${m.owner} ${m.name} ${m.tags.join(" ")}`.toLowerCase();
    return tokens.some(tok => combined.includes(tok));
  });

  // If no query match, return all catalog items sorted by relevance
  if (matches.length === 0) matches = [...catalog];
  const totalMatches = matches.length;

  const start = (page - 1) * limit;
  const mapped = matches.slice(start, start + limit).map(m => ({
    id: `replicate:${m.owner}/${m.name}`,
    type: "model",
    source: "replicate",
    name: `${m.owner}/${m.name}`,
    author: m.owner,
    description: `Replicate model by ${m.owner}: ${m.name.replace(/[-_]/g, " ")}`,
    url: `https://replicate.com/${m.owner}/${m.name}`,
    metrics: { stars: null, downloads: null },
    tags: m.tags,
    license: "",
    updatedAt: "",
  }));
  return withResultMeta(mapped, {
    totalCount: totalMatches,
    hasMore: start + mapped.length < totalMatches,
  });
}

function searchReplicateFromCatalog(query, page, limit) {
  // Curated catalog of popular Replicate models since their API requires auth
  const catalog = [
    { owner: "stability-ai", name: "stable-diffusion", desc: "A latent text-to-image diffusion model capable of generating photo-realistic images given any text input", tags: ["image-generation", "diffusion"] },
    { owner: "stability-ai", name: "sdxl", desc: "Stable Diffusion XL - a text-to-image generative AI model that creates beautiful images", tags: ["image-generation", "sdxl"] },
    { owner: "meta", name: "llama-2-70b-chat", desc: "Meta's Llama 2 70B Chat - a large language model fine-tuned for chat", tags: ["llm", "chat"] },
    { owner: "meta", name: "llama-2-13b-chat", desc: "Meta's Llama 2 13B Chat model", tags: ["llm", "chat"] },
    { owner: "openai", name: "whisper", desc: "Robust speech recognition via large-scale weak supervision", tags: ["audio", "speech-to-text"] },
    { owner: "cjwbw", name: "real-esrgan", desc: "Real-ESRGAN: upscale images with AI", tags: ["image", "upscaling"] },
    { owner: "replicate", name: "codellama-13b", desc: "Code Llama - a code generation model from Meta", tags: ["code", "llm"] },
    { owner: "lucataco", name: "flux-dev-lora", desc: "FLUX.1 Dev with LoRA support for custom image generation", tags: ["image-generation", "lora"] },
    { owner: "black-forest-labs", name: "flux-schnell", desc: "FLUX.1 Schnell - fast and high quality image generation", tags: ["image-generation"] },
    { owner: "zsxkib", name: "musicgen", desc: "Generate music from text descriptions using Meta's MusicGen", tags: ["audio", "music"] },
    { owner: "replicate", name: "mistral-7b-instruct-v0.2", desc: "Mistral 7B Instruct v0.2 - a fast and capable language model", tags: ["llm", "chat"] },
    { owner: "abiruyt", name: "text-extract-ocr", desc: "Extract text from images using OCR", tags: ["ocr", "text"] },
    { owner: "nightmareai", name: "real-esrgan", desc: "Image super-resolution and restoration", tags: ["image", "upscaling"] },
    { owner: "fofr", name: "face-to-many", desc: "Turn a face photo into various art styles", tags: ["image", "face"] },
    { owner: "chenxwh", name: "shap-e", desc: "Generate 3D objects conditioned on text or images", tags: ["3d", "generation"] },
  ];

  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  let matches = catalog.filter(m => {
    const combined = `${m.owner} ${m.name} ${m.desc} ${m.tags.join(" ")}`.toLowerCase();
    return tokens.some(tok => combined.includes(tok));
  });

  // If no matches, return all catalog items
  if (matches.length === 0) matches = catalog;
  const totalMatches = matches.length;

  const start = Math.max(0, (page - 1) * limit);
  const mapped = matches.slice(start, start + limit).map(m => ({
    id: `replicate:${m.owner}/${m.name}`,
    type: "model",
    source: "replicate",
    name: `${m.owner}/${m.name}`,
    author: m.owner,
    description: m.desc,
    url: `https://replicate.com/${m.owner}/${m.name}`,
    metrics: { stars: null, downloads: null },
    tags: ["replicate", "cloud", ...m.tags],
    license: "",
    updatedAt: "",
  }));
  return withResultMeta(mapped, {
    totalCount: totalMatches,
    hasMore: start + mapped.length < totalMatches,
  });
}

/**
 * Fetch trending/featured content for the storefront (no query needed).
 * This implements the "Amazon/Flipkart psychology" — auto-populated content on load.
 */
let storeFeaturedCache = null;
let storeFeaturedCacheTime = 0;
const FEATURED_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchStoreFeatured() {
  // Return cached if fresh
  if (storeFeaturedCache && (Date.now() - storeFeaturedCacheTime) < FEATURED_CACHE_TTL) {
    return storeFeaturedCache;
  }

  const sections = [];

  // Parallel: trending models, popular datasets, recent papers
  const [trendingModels, popularDatasets, recentPapers, trendingCode] = await Promise.allSettled([
    // Trending models from HuggingFace (most downloaded)
    (async () => {
      try {
        const resp = await fetch("https://huggingface.co/api/models?sort=downloads&direction=-1&limit=8", { signal: AbortSignal.timeout(3000) });
        if (!resp.ok) return [];
        const items = await resp.json();
        return items.map(item => ({
          id: `hf:model:${item.id || item.modelId}`,
          type: "model",
          source: "huggingface",
          name: item.id || item.modelId,
          author: (item.id || item.modelId || "").split("/")[0] || "",
          description: item.description || "",
          url: `https://huggingface.co/${item.id || item.modelId}`,
          metrics: { downloads: item.downloads, likes: item.likes, stars: item.likes },
          tags: [...(item.tags || []).slice(0, 3), ...(item.pipeline_tag ? [item.pipeline_tag] : [])],
          license: (item.tags || []).find(t => t.startsWith("license:"))?.replace("license:", "") || "",
          updatedAt: item.lastModified || "",
        }));
      } catch { return []; }
    })(),
    // Popular datasets from HuggingFace
    (async () => {
      try {
        const resp = await fetch("https://huggingface.co/api/datasets?sort=downloads&direction=-1&limit=8", { signal: AbortSignal.timeout(3000) });
        if (!resp.ok) return [];
        const items = await resp.json();
        return items.map(item => ({
          id: `hf:dataset:${item.id}`,
          type: "dataset",
          source: "huggingface",
          name: item.id,
          author: (item.id || "").split("/")[0] || "",
          description: item.description || "",
          url: `https://huggingface.co/datasets/${item.id}`,
          metrics: { downloads: item.downloads, likes: item.likes, stars: item.likes },
          tags: (item.tags || []).slice(0, 4),
          license: (item.tags || []).find(t => t.startsWith("license:"))?.replace("license:", "") || "",
          updatedAt: item.lastModified || "",
        }));
      } catch { return []; }
    })(),
    // Recent CS papers from Semantic Scholar (highly cited recent papers)
    (async () => {
      try {
        const resp = await fetch("https://api.semanticscholar.org/graph/v1/paper/search?query=large language model&fields=title,abstract,authors,citationCount,year,url,fieldsOfStudy&limit=8&year=2024-&fieldsOfStudy=Computer Science", { signal: AbortSignal.timeout(3000) });
        if (!resp.ok) return [];
        const data = await resp.json();
        return (data.data || []).map(paper => ({
          id: `s2:${paper.paperId}`,
          type: "paper",
          source: "semanticscholar",
          name: paper.title || "Untitled",
          author: (paper.authors || []).slice(0, 3).map(a => a.name).join(", "),
          description: (paper.abstract || "").slice(0, 300),
          url: paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`,
          metrics: { citations: paper.citationCount || 0 },
          tags: (paper.fieldsOfStudy || []).slice(0, 4),
          license: "",
          updatedAt: paper.year ? `${paper.year}-01-01` : "",
        }));
      } catch { return []; }
    })(),
    // Trending GitHub ML repos
    (async () => {
      try {
        const headers = { "Accept": "application/vnd.github+json" };
        const ghToken = process.env.GITHUB_TOKEN;
        if (ghToken) headers["Authorization"] = `Bearer ${ghToken}`;
        const resp = await fetch("https://api.github.com/search/repositories?q=topic:machine-learning+stars:>1000&sort=stars&order=desc&per_page=8", { headers, signal: AbortSignal.timeout(3000) });
        if (!resp.ok) return [];
        const data = await resp.json();
        return (data.items || []).map(repo => ({
          id: `gh:${repo.full_name}`,
          type: "code",
          source: "github",
          name: repo.full_name,
          author: repo.owner?.login || "",
          description: repo.description || "",
          url: repo.html_url,
          metrics: { stars: repo.stargazers_count, forks: repo.forks_count },
          tags: (repo.topics || []).slice(0, 5),
          license: repo.license?.spdx_id || "",
          updatedAt: repo.updated_at || "",
        }));
      } catch { return []; }
    })(),
  ]);

  if (trendingModels.status === "fulfilled" && trendingModels.value.length > 0) {
    sections.push({ title: "Trending Models", icon: "🔥", category: "model", items: trendingModels.value });
  }
  if (popularDatasets.status === "fulfilled" && popularDatasets.value.length > 0) {
    sections.push({ title: "Popular Datasets", icon: "📊", category: "dataset", items: popularDatasets.value });
  }
  if (recentPapers.status === "fulfilled" && recentPapers.value.length > 0) {
    sections.push({ title: "Latest Research", icon: "📄", category: "paper", items: recentPapers.value });
  }
  if (trendingCode.status === "fulfilled" && trendingCode.value.length > 0) {
    sections.push({ title: "Top ML Repositories", icon: "⭐", category: "code", items: trendingCode.value });
  }

  // Category browsing cards (always present)
  const categories = [
    { name: "Natural Language Processing", icon: "💬", query: "NLP natural language processing", color: "#2D6A4F" },
    { name: "Computer Vision", icon: "👁️", query: "computer vision image recognition", color: "#6A2D4F" },
    { name: "Audio & Speech", icon: "🎙️", query: "speech recognition audio processing", color: "#4F2D6A" },
    { name: "Multimodal", icon: "🧩", query: "multimodal vision language model", color: "#2D4F6A" },
    { name: "Reinforcement Learning", icon: "🎮", query: "reinforcement learning agent", color: "#6A4F2D" },
    { name: "Generative AI", icon: "🎨", query: "generative model diffusion GAN", color: "#4F6A2D" },
    { name: "Fine-tuning & PEFT", icon: "🔧", query: "LoRA fine-tuning PEFT adapter", color: "#3D5A4F" },
    { name: "Embeddings & RAG", icon: "🔗", query: "embeddings RAG vector retrieval", color: "#5A3D4F" },
    { name: "LLM Tools & Frameworks", icon: "🛠️", query: "LLM framework inference toolkit", color: "#4F5A3D" },
    { name: "Robotics & Control", icon: "🤖", query: "robotics control simulation", color: "#3D4F5A" },
    { name: "Time Series", icon: "📈", query: "time series forecasting prediction", color: "#5A4F3D" },
    { name: "Healthcare & Bio", icon: "🧬", query: "medical AI healthcare bioinformatics", color: "#3D5A5A" },
  ];

  storeFeaturedCache = { sections, categories };
  storeFeaturedCacheTime = Date.now();
  return storeFeaturedCache;
}

/**
 * Featured/trending storefront endpoint — returns auto-populated content.
 */
app.get("/api/store/featured", async (_req, res) => {
  try {
    const featured = await fetchStoreFeatured();
    res.json(featured);
  } catch (err) {
    console.error("Store featured error:", err);
    res.status(500).json({ error: "Failed to load featured content", details: err.message });
  }
});

/**
 * Unified store search: fans out to multiple sources and merges results.
 */
app.get("/api/store/search", async (req, res) => {
  try {
    const {
      q = "",
      type = "all",
      source = "all",
      sort = "trending",
      page = "1",
      limit = "12",
    } = req.query;

    const trimmedQuery = (q || "").trim();
    const hasFilters = type !== "all" || source !== "all";

    // If no query, return featured content instead of empty
    if (!trimmedQuery && !hasFilters) {
      try {
        const featured = await fetchStoreFeatured();
        // Flatten all featured sections into a merged result set
        let allItems = [];
        for (const section of featured.sections) {
          allItems = allItems.concat(section.items);
        }
        // Apply type filter if not "all"
        if (type !== "all") {
          allItems = allItems.filter(item => item.type === type);
        }
        // Apply source filter if not "all"
        if (source !== "all") {
          allItems = allItems.filter(item => item.source === source);
        }
        return res.json({ results: allItems.slice(0, 24), totalCount: allItems.length, totalPages: 1, page: 1, featured: true });
      } catch {
        return res.json({ results: [], totalCount: 0, totalPages: 0 });
      }
    }

    const effectiveQuery = trimmedQuery || (
      source === "all"
        ? (
          type === "paper" ? "large language model" :
          type === "dataset" ? "machine learning dataset" :
          type === "code" ? "llm framework" :
          "machine learning"
        )
        : (
          // Keep true catalog-style browsing for sources with bounded/public catalogs.
          source === "ollama" || source === "replicate" || source === "huggingface" || source === "civitai" || source === "kaggle"
            ? ""
            // Sources that reject blank query or degrade badly with blank input.
            : "machine learning"
        )
    );

    // Check cache
    const cacheKey = JSON.stringify({ q: effectiveQuery, type, source, sort, page, limit });
    if (searchCache.has(cacheKey)) {
      const cached = searchCache.get(cacheKey);
      if (Date.now() - cached.timestamp < SEARCH_CACHE_TTL) {
        console.log(`[store] Cache hit for "${effectiveQuery}"`);
        return res.json(cached.data);
      }
      searchCache.delete(cacheKey);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(30, Math.max(1, parseInt(limit, 10) || 12));

    const isSingleSourceQuery = source !== "all";

    // Decide which sources to query
    const shouldQueryHF = (source === "all" || source === "huggingface") && (type === "all" || type === "model" || type === "dataset");
    const shouldQueryGH = (source === "all" || source === "github") && (type === "all" || type === "code");
    const shouldQueryArxiv = (source === "all" || source === "arxiv") && (type === "all" || type === "paper");
    const shouldQueryPWC = (source === "all" || source === "paperswithcode") && (type === "all" || type === "paper");
    const shouldQueryS2 = (source === "all" || source === "semanticscholar") && (type === "all" || type === "paper");
    const shouldQueryCivitai = (source === "all" || source === "civitai") && (type === "all" || type === "model");
    const shouldQueryZenodo = (source === "all" || source === "zenodo") && (type === "all" || type === "dataset" || type === "paper" || type === "code");
    const shouldQueryDBLP = (source === "all" || source === "dblp") && (type === "all" || type === "paper");
    const shouldQueryOllama = (source === "all" || source === "ollama") && (type === "all" || type === "model");
    const shouldQueryReplicate = (source === "all" || source === "replicate") && (type === "all" || type === "model");
    const shouldQueryKaggle = (source === "all" || source === "kaggle") && (type === "all" || type === "dataset" || type === "code");

    const buildSourcePromises = (pageValue, limitValue) => {
      const nextPromises = [];
      if (shouldQueryHF) nextPromises.push(searchHuggingFace(effectiveQuery, type, sort, pageValue, limitValue));
      if (shouldQueryGH) nextPromises.push(searchGitHub(effectiveQuery, sort, pageValue, limitValue));
      if (shouldQueryArxiv) nextPromises.push(searchArxiv(effectiveQuery, sort, pageValue, limitValue));
      if (shouldQueryPWC) nextPromises.push(searchPapersWithCode(effectiveQuery, pageValue, limitValue));
      if (shouldQueryS2) nextPromises.push(searchSemanticScholar(effectiveQuery, sort, pageValue, limitValue));
      if (shouldQueryCivitai) nextPromises.push(searchCivitai(effectiveQuery, sort, pageValue, limitValue));
      if (shouldQueryZenodo) nextPromises.push(searchZenodo(effectiveQuery, sort, pageValue, limitValue));
      if (shouldQueryDBLP) nextPromises.push(searchDBLP(effectiveQuery, pageValue, limitValue));
      if (shouldQueryOllama) nextPromises.push(searchOllama(effectiveQuery, pageValue, limitValue));
      if (shouldQueryReplicate) nextPromises.push(searchReplicate(effectiveQuery, pageValue, limitValue));
      if (shouldQueryKaggle) nextPromises.push(searchKaggle(effectiveQuery, type, sort, pageValue, limitValue));
      return nextPromises;
    };

    // Fan out queries in parallel
    const promises = buildSourcePromises(pageNum, limitNum);

    // If no sources match the type filter, return empty
    if (promises.length === 0) {
      return res.json({ results: [], totalCount: 0, totalPages: 0 });
    }

    const allResults = await Promise.allSettled(promises);
    let merged = [];
    let singleSourceMeta = {};

    for (const result of allResults) {
      if (result.status === "fulfilled" && Array.isArray(result.value)) {
        merged = merged.concat(result.value);
        if (isSingleSourceQuery) {
          singleSourceMeta = { ...getResultMeta(result.value) };
        }
      }
    }

    // arXiv can rate-limit aggressively; keep paper results available for arXiv filter
    if (source === "arxiv" && merged.length === 0) {
      const arxivFallbacks = await Promise.allSettled([
        searchSemanticScholar(effectiveQuery, sort, pageNum, limitNum),
        searchDBLP(effectiveQuery, pageNum, limitNum),
        searchZenodo(effectiveQuery, sort, pageNum, limitNum),
      ]);

      for (const fallback of arxivFallbacks) {
        if (fallback.status === "fulfilled" && Array.isArray(fallback.value)) {
          merged = merged.concat(fallback.value);
        }
      }

      merged = merged
        .filter(item => item.type === "paper")
        .map(item => ({
          ...item,
          id: item.id.startsWith("arxiv:") ? item.id : `arxiv:fallback:${item.id}`,
          source: "arxiv",
          license: item.license || "arXiv",
        }));
    }

    // Deduplicate by id
    const seen = new Set();
    merged = merged.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    // Sort merged results
    // For "trending" in multi-source mode, use interleaved round-robin across sources
    // so no single source dominates the first page (e.g., GitHub stars >> HF likes)
    if ((sort === "stars" || sort === "trending") && source === "all") {
      // Group by source, sort within each group, then interleave
      const bySource = {};
      for (const item of merged) {
        const s = item.source || "unknown";
        if (!bySource[s]) bySource[s] = [];
        bySource[s].push(item);
      }
      // Sort within each source group by their best metric
      for (const s of Object.keys(bySource)) {
        bySource[s].sort((a, b) => {
          const am = a.metrics?.stars || a.metrics?.likes || a.metrics?.downloads || a.metrics?.citations || 0;
          const bm = b.metrics?.stars || b.metrics?.likes || b.metrics?.downloads || b.metrics?.citations || 0;
          return bm - am;
        });
      }
      // Round-robin interleave
      const sourceKeys = Object.keys(bySource);
      const interleaved = [];
      let idx = 0;
      let exhausted = 0;
      while (exhausted < sourceKeys.length && interleaved.length < merged.length) {
        const key = sourceKeys[idx % sourceKeys.length];
        if (bySource[key].length > 0) {
          interleaved.push(bySource[key].shift());
        } else {
          exhausted++;
        }
        idx++;
      }
      merged = interleaved;
    } else if (sort === "stars" || sort === "trending") {
      merged.sort((a, b) => ((b.metrics?.stars || b.metrics?.likes || b.metrics?.downloads || b.metrics?.citations || 0) - (a.metrics?.stars || a.metrics?.likes || a.metrics?.downloads || a.metrics?.citations || 0)));
    } else if (sort === "downloads") {
      merged.sort((a, b) => ((b.metrics?.downloads || 0) - (a.metrics?.downloads || 0)));
    } else if (sort === "recent") {
      merged.sort((a, b) => {
        const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return db - da;
      });
    } else if (sort === "citations") {
      merged.sort((a, b) => ((b.metrics?.citations || 0) - (a.metrics?.citations || 0)));
    }

    const pageResults = merged.slice(0, limitNum);
    let hasMore = typeof singleSourceMeta.hasMore === "boolean" ? singleSourceMeta.hasMore : false;
    const knownTotalCount = Number(singleSourceMeta.totalCount ?? NaN);
    if (
      isSingleSourceQuery &&
      !Number.isFinite(knownTotalCount) &&
      pageResults.length === limitNum
    ) {
      const lookaheadPromises = buildSourcePromises(pageNum + 1, limitNum);
      const lookaheadSettled = await Promise.allSettled(lookaheadPromises);
      hasMore = lookaheadSettled.some(
        (result) => result.status === "fulfilled" && Array.isArray(result.value) && result.value.length > 0,
      );
    }
    const knownBeforePage = (pageNum - 1) * limitNum;

    // For single-source queries, provider APIs often don't return exact totals.
    // We expose a rolling lower-bound total + hasMore-driven next page so users can
    // continue browsing the full upstream catalog without local storage growth.
    const totalCount = isSingleSourceQuery
      ? (
        Number.isFinite(knownTotalCount)
          ? knownTotalCount
          : (hasMore ? knownBeforePage + pageResults.length + 1 : knownBeforePage + pageResults.length)
      )
      : merged.length;
    const totalPages = isSingleSourceQuery
      ? (hasMore ? Math.max(pageNum + 1, Math.ceil(totalCount / limitNum)) : Math.max(1, Math.ceil(totalCount / limitNum)))
      : (Math.ceil(totalCount / limitNum) || 1);

    const responseData = {
      results: pageResults,
      totalCount,
      totalPages,
      page: pageNum,
    };

    // Cache successful results
    if (responseData.results.length > 0) {
      searchCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
    }

    res.json(responseData);
  } catch (err) {
    console.error("Store search error:", err);
    res.status(500).json({ error: "Store search failed", details: err.message });
  }
});

/**
 * Add a resource to the current project.
 */
app.post("/api/store/add-to-project", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const { resource } = req.body;
    if (!resource || !resource.id) {
      return res.status(400).json({ error: "Resource with id is required" });
    }

    if (!storeProjectResourcesByProject || typeof storeProjectResourcesByProject !== "object") {
      storeProjectResourcesByProject = {};
    }
    const scopedResources = Array.isArray(storeProjectResourcesByProject[projectId])
      ? storeProjectResourcesByProject[projectId]
      : [];

    // Avoid duplicates
    if (scopedResources.some(r => r.id === resource.id)) {
      return res.json({ ok: true, message: "Already added" });
    }

    scopedResources.push({
      id: resource.id,
      projectId,
      type: resource.type,
      source: resource.source,
      name: resource.name,
      author: resource.author,
      description: resource.description,
      url: resource.url,
      metrics: resource.metrics,
      tags: resource.tags,
      license: resource.license,
      addedAt: new Date().toISOString(),
    });
    storeProjectResourcesByProject[projectId] = scopedResources;

    // Persist to workspace config
    try {
      const configRaw = await readFile(workspaceConfig, "utf-8").catch(() => "{}");
      const config = JSON.parse(configRaw);
      if (Array.isArray(config.storeResources) && (!config.storeResourcesByProject || typeof config.storeResourcesByProject !== "object")) {
        config.storeResourcesByProject = { default: config.storeResources };
      }
      config.storeResourcesByProject = {
        ...(config.storeResourcesByProject && typeof config.storeResourcesByProject === "object" ? config.storeResourcesByProject : {}),
        [projectId]: scopedResources,
      };
      await writeFile(workspaceConfig, JSON.stringify(config, null, 2));
    } catch (configErr) {
      console.error("Failed to persist store resources to config:", configErr.message);
    }

    res.json({ ok: true, message: "Resource added to project" });
  } catch (err) {
    res.status(500).json({ error: "Failed to add resource", details: err.message });
  }
});

/**
 * Remove a resource from the current project.
 */
app.post("/api/store/remove-from-project", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    const { resourceId } = req.body;
    if (!resourceId) {
      return res.status(400).json({ error: "resourceId is required" });
    }

    const scopedResources = Array.isArray(storeProjectResourcesByProject?.[projectId])
      ? storeProjectResourcesByProject[projectId]
      : [];
    storeProjectResourcesByProject[projectId] = scopedResources.filter(r => r.id !== resourceId);

    // Persist
    try {
      const configRaw = await readFile(workspaceConfig, "utf-8").catch(() => "{}");
      const config = JSON.parse(configRaw);
      if (Array.isArray(config.storeResources) && (!config.storeResourcesByProject || typeof config.storeResourcesByProject !== "object")) {
        config.storeResourcesByProject = { default: config.storeResources };
      }
      config.storeResourcesByProject = {
        ...(config.storeResourcesByProject && typeof config.storeResourcesByProject === "object" ? config.storeResourcesByProject : {}),
        [projectId]: storeProjectResourcesByProject[projectId],
      };
      await writeFile(workspaceConfig, JSON.stringify(config, null, 2));
    } catch (configErr) {
      console.error("Failed to persist store resources to config:", configErr.message);
    }

    res.json({ ok: true, message: "Resource removed" });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove resource", details: err.message });
  }
});

/**
 * List resources added to the current project.
 */
app.get("/api/store/project-resources", async (req, res) => {
  try {
    const projectId = resolveRequestProjectId(req);
    // Load from config if not yet loaded
    if (!storeProjectResourcesByProject || Object.keys(storeProjectResourcesByProject).length === 0) {
      try {
        const configRaw = await readFile(workspaceConfig, "utf-8");
        const config = JSON.parse(configRaw);
        if (config.storeResourcesByProject && typeof config.storeResourcesByProject === "object") {
          storeProjectResourcesByProject = config.storeResourcesByProject;
        } else if (Array.isArray(config.storeResources)) {
          storeProjectResourcesByProject = { default: config.storeResources };
        } else {
          storeProjectResourcesByProject = {};
        }
      } catch { /* no config yet */ }
    }
    const resources = Array.isArray(storeProjectResourcesByProject[projectId])
      ? storeProjectResourcesByProject[projectId]
      : [];
    res.json({ resources });
  } catch (err) {
    res.status(500).json({ error: "Failed to load resources", details: err.message });
  }
});




// Create HTTP server
const server = app.listen(port, () => {
  console.log(`Text2LLM web running at http://localhost:${port}`);
});

// Create WebSocket server for terminal
const wss = new WebSocketServer({ server, path: '/terminal' });

wss.on('connection', (ws) => {
  console.log('Terminal WebSocket client connected');
  
  // Determine shell based on OS
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const cwd = path.resolve(__dirname, '..', '..');
  
  // Spawn shell process
  const shellProcess = spawn(shell, [], {
    cwd: cwd,
    env: process.env,
    shell: false,
    windowsHide: false
  });
  
  console.log(`Spawned ${shell} with PID ${shellProcess.pid} in ${cwd}`);
  
  // Send process output to WebSocket client
  shellProcess.stdout.on('data', (data) => {
    try {
      ws.send(data.toString());
    } catch (ex) {
      console.error('Error sending stdout to client:', ex);
    }
  });
  
  shellProcess.stderr.on('data', (data) => {
    try {
      ws.send(data.toString());
    } catch (ex) {
      console.error('Error sending stderr to client:', ex);
    }
  });
  
  // Handle messages from client
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());
      
      if (msg.type === 'input') {
        // Write input to shell stdin
        shellProcess.stdin.write(msg.data);
      } else if (msg.type === 'resize') {
        // Resize not supported with basic child_process
        console.log(`Resize requested: ${msg.cols}x${msg.rows} (not supported)`);
      }
    } catch (ex) {
      console.error('Error handling message:', ex);
    }
  });
  
  // Handle client disconnect
  ws.on('close', () => {
    console.log('Terminal WebSocket client disconnected');
    shellProcess.kill();
  });
  
  // Handle process exit
  shellProcess.on('exit', (code, signal) => {
    console.log(`Shell exited with code ${code}, signal ${signal}`);
    ws.close();
  });
  
  // Handle WebSocket errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

console.log('WebSocket server ready at ws://localhost:' + port + '/terminal');
