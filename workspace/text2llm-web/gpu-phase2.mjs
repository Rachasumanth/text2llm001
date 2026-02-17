function nowIso() {
  return new Date().toISOString();
}

export const GPU_RUNTIME_TEMPLATES = [
  {
    id: "vllm",
    name: "vLLM",
    image: "vllm/vllm-openai:latest",
    contract: {
      healthPath: "/health",
      inferencePath: "/v1/chat/completions",
      preloadPath: "/v1/models/preload",
      errorFormat: {
        code: "string",
        message: "string",
        details: "object",
        retriable: "boolean",
      },
    },
  },
  {
    id: "tgi",
    name: "Text Generation Inference",
    image: "ghcr.io/huggingface/text-generation-inference:latest",
    contract: {
      healthPath: "/health",
      inferencePath: "/generate",
      preloadPath: "/models/preload",
      errorFormat: {
        code: "string",
        message: "string",
        details: "object",
        retriable: "boolean",
      },
    },
  },
  {
    id: "ollama",
    name: "Ollama-compatible",
    image: "ollama/ollama:latest",
    contract: {
      healthPath: "/api/tags",
      inferencePath: "/api/generate",
      preloadPath: "/api/pull",
      errorFormat: {
        code: "string",
        message: "string",
        details: "object",
        retriable: "boolean",
      },
    },
  },
  {
    id: "custom",
    name: "Custom container",
    image: "custom/runtime:latest",
    contract: {
      healthPath: "/health",
      inferencePath: "/inference",
      preloadPath: "/preload",
      errorFormat: {
        code: "string",
        message: "string",
        details: "object",
        retriable: "boolean",
      },
    },
  },
];

function structuredRuntimeError(code, message, details = {}, retriable = false) {
  return {
    ok: false,
    error: {
      code,
      message,
      details,
      retriable,
      timestamp: nowIso(),
    },
  };
}

export const GPU_PROVIDER_DEFINITIONS = [
  {
    id: "kaggle",
    name: "Kaggle",
    description: "Free notebooks with quota-limited GPUs",
    icon: `<svg viewBox="0 0 24 24" fill="#20BEFF"><path d="M18.8 20H15l-3.3-6.6 3.9-6h3.8l-5.6 7.7L18.8 20zM6 20H9.5V4H6v16zm7.2-10L9.4 6H5.2v12h1.6V9l6.4 11h9.3l-8-10z"/></svg>`,
    authFields: [
      { key: "KAGGLE_USERNAME", label: "Kaggle Username", type: "text", required: true },
      { key: "KAGGLE_KEY", label: "Kaggle API Key", type: "password", required: true },
    ],
    requiredPermissions: ["notebooks.read", "notebooks.write"],
    tokenGuidance: "Use a project-scoped key with notebook-only access where possible.",
    regions: ["us"],
    gpuTypes: ["T4"],
  },
  {
    id: "colab",
    name: "Google Colab",
    description: "Colab-backed runtime credentials",
    icon: `<svg viewBox="0 0 24 24" fill="#F9AB00"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 13h-4v-1h4v1zm0-3h-4v-1h4v1zm0-3h-4V8h4v1zM8 15H6V8h2v7zm10.5-12.5l-3.2 2.1c-.8-.6-1.8-1-2.9-1-2.7 0-4.9 2.2-4.9 4.9s2.2 4.9 4.9 4.9c2.5 0 4.6-1.9 4.9-4.3l3.2 2.1c-.8 2.3-3 3.9-5.6 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.3 0 2.5.4 3.5 1.1z"/></svg>`,
    authFields: [
      { key: "COLAB_ACCESS_TOKEN", label: "Colab Access Token", type: "password", required: true },
    ],
    requiredPermissions: ["runtime.connect", "drive.read"],
    tokenGuidance: "Prefer short-lived Colab tokens over long-lived account credentials.",
    regions: ["global"],
    gpuTypes: ["T4", "L4", "A100"],
  },
  {
    id: "aws",
    name: "AWS",
    description: "EC2 GPU instances for inference",
    icon: "/logos/amazonbedrock.png",
    authFields: [
      { key: "AWS_ACCESS_KEY_ID", label: "Access Key ID", type: "text", required: true },
      { key: "AWS_SECRET_ACCESS_KEY", label: "Secret Access Key", type: "password", required: true },
    ],
    requiredPermissions: ["ec2:DescribeInstances", "ec2:RunInstances", "ec2:StartInstances", "ec2:StopInstances", "ec2:TerminateInstances"],
    tokenGuidance: "Use short-lived STS credentials from an IAM role with least privilege.",
    regions: ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-1"],
    gpuTypes: ["T4", "A10G", "A100", "H100"],
  },
  {
    id: "azure",
    name: "Azure",
    description: "Azure GPU VM and Azure ML compute",
    icon: `<svg viewBox="0 0 24 24" fill="#0078D4"><path d="M12 2L2 7l10 5 10-5-10-5zm0 9l2-1-2-1-2 1 2 1zm0 2l-5-2.5-5 2.5L12 22l10-8-5-2.5-5 2.5z"/></svg>`,
    authFields: [
      { key: "AZURE_TENANT_ID", label: "Tenant ID", type: "text", required: true },
      { key: "AZURE_CLIENT_ID", label: "Client ID", type: "text", required: true },
      { key: "AZURE_CLIENT_SECRET", label: "Client Secret", type: "password", required: true },
      { key: "AZURE_SUBSCRIPTION_ID", label: "Subscription ID", type: "text", required: true },
    ],
    requiredPermissions: ["Microsoft.Compute/virtualMachines/read", "Microsoft.Compute/virtualMachines/write", "Microsoft.Resources/subscriptions/resourceGroups/read"],
    tokenGuidance: "Use a service principal scoped to a dedicated resource group.",
    regions: ["eastus", "westus3", "westeurope", "southeastasia"],
    gpuTypes: ["T4", "A10", "A100", "H100"],
  },
  {
    id: "gcp",
    name: "Google Cloud",
    description: "Compute Engine / Vertex AI GPU runtimes",
    icon: "/logos/gemini.png",
    authFields: [
      { key: "GCP_PROJECT_ID", label: "Project ID", type: "text", required: true },
      { key: "GCP_SERVICE_ACCOUNT_JSON", label: "Service Account JSON", type: "textarea", required: true },
    ],
    requiredPermissions: ["compute.instances.get", "compute.instances.create", "compute.instances.start", "compute.instances.stop", "compute.instances.delete"],
    tokenGuidance: "Use Workload Identity Federation or short-lived service account tokens.",
    regions: ["us-central1", "us-west4", "europe-west4", "asia-south1"],
    gpuTypes: ["T4", "L4", "A100", "H100"],
  },
  {
    id: "runpod",
    name: "RunPod",
    description: "On-demand and serverless GPU",
    icon: `<svg viewBox="0 0 24 24" fill="#673AB7"><path d="M21 16.5c0 .8-.7 1.5-1.5 1.5h-15C3.7 18 3 17.3 3 16.5v-9c0-.8.7-1.5 1.5-1.5h15c.8 0 1.5.7 1.5 1.5v9zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>`,
    authFields: [{ key: "RUNPOD_API_KEY", label: "RunPod API Key", type: "password", required: true }],
    requiredPermissions: ["pods.read", "pods.write"],
    tokenGuidance: "Use org/project-scoped API keys when available.",
    regions: ["us", "eu"],
    gpuTypes: ["A4000", "A5000", "A100", "H100"],
  },
  {
    id: "lambdalabs",
    name: "Lambda Cloud",
    description: "GPU cloud optimized for ML workloads",
    icon: `<svg viewBox="0 0 24 24" fill="#4B0082"><path d="M12 2L2 22h20L12 2zm0 3.8l7 14.2H5l7-14.2z"/></svg>`,
    authFields: [{ key: "LAMBDA_API_KEY", label: "Lambda API Key", type: "password", required: true }],
    requiredPermissions: ["instances.read", "instances.write"],
    tokenGuidance: "Use workspace-scoped API key with instance lifecycle permissions only.",
    regions: ["us-west", "us-east"],
    gpuTypes: ["A10", "A100", "H100"],
  },
  {
    id: "vastai",
    name: "Vast.ai",
    description: "Marketplace GPU instances",
    icon: `<svg viewBox="0 0 24 24" fill="#03A9F4"><path d="M4 4h16v16H4V4zm2 2v12h12V6H6zm2 2h8v8H8V8z"/></svg>`,
    authFields: [{ key: "VAST_API_KEY", label: "Vast API Key", type: "password", required: true }],
    requiredPermissions: ["instances.read", "instances.write"],
    tokenGuidance: "Use a dedicated API key limited to instance management.",
    regions: ["global"],
    gpuTypes: ["RTX4090", "A6000", "A100", "H100"],
  },
  {
    id: "selfhosted",
    name: "Self-hosted SSH",
    description: "Use your own GPU machine over SSH",
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-5 14H4v-4h11v4zm0-5H4V9h11v4zm5 5h-4V9h4v9z"/></svg>`,
    authFields: [
      { key: "SSH_HOST", label: "SSH Host", type: "text", required: true },
      { key: "SSH_USER", label: "SSH User", type: "text", required: true },
      { key: "SSH_PRIVATE_KEY", label: "SSH Private Key", type: "textarea", required: true },
    ],
    requiredPermissions: ["ssh.connect", "docker.run"],
    tokenGuidance: "Prefer ephemeral SSH certificates or short-lived keys.",
    regions: ["custom"],
    gpuTypes: ["T4", "L4", "A10", "A100", "H100", "RTX4090"],
  },
];

class ProviderGpuAdapter {
  constructor(definition) {
    this.definition = definition;
  }

  getProviderInfo() {
    return {
      id: this.definition.id,
      name: this.definition.name,
      description: this.definition.description,
      authFields: this.definition.authFields,
      requiredPermissions: this.definition.requiredPermissions || [],
      tokenGuidance: this.definition.tokenGuidance || "Prefer short-lived, scoped credentials.",
    };
  }

  validateCredentials(credentials) {
    const payload = credentials && typeof credentials === "object" ? credentials : {};
    const missingField = this.definition.authFields
      .filter((field) => field.required)
      .find((field) => !String(payload[field.key] || "").trim());

    if (missingField) {
      return {
        ok: false,
        error: `${missingField.label} is required`,
        missingKey: missingField.key,
      };
    }

    return { ok: true };
  }

  listRegions() {
    return this.definition.regions;
  }

  listGpuTypes() {
    return this.definition.gpuTypes;
  }

  createInstance(params) {
    const timestamp = nowIso();
    const safeName = String(params.name || "").trim() || `${this.definition.name} ${params.gpuType}`;

    return {
      id: `gpu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: safeName,
      providerId: this.definition.id,
      providerName: this.definition.name,
      region: params.region,
      gpuType: params.gpuType,
      gpuCount: Math.max(1, Number(params.gpuCount) || 1),
      status: "provisioning",
      endpoint: "",
      runtime: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  getInstanceStatus(instance) {
    return {
      status: instance.status,
      endpoint: instance.endpoint || "",
      updatedAt: nowIso(),
    };
  }

  startInstance(instance) {
    return {
      ...instance,
      status: "running",
      updatedAt: nowIso(),
    };
  }

  stopInstance(instance) {
    return {
      ...instance,
      status: "stopped",
      updatedAt: nowIso(),
    };
  }

  terminateInstance(instance) {
    return {
      ...instance,
      status: "terminated",
      updatedAt: nowIso(),
    };
  }

  deployRuntime(instance, runtime = {}) {
    const templateId = String(runtime.templateId || "vllm").trim().toLowerCase();
    const template = GPU_RUNTIME_TEMPLATES.find((item) => item.id === templateId) || GPU_RUNTIME_TEMPLATES[0];
    const endpoint = `https://inference.local/${this.definition.id}/${instance.id}`;
    return {
      ...instance,
      status: "provisioning",
      endpoint,
      runtime: {
        templateId: template.id,
        image: String(runtime.image || template.image),
        model: String(runtime.model || "open-source-default"),
        contract: {
          healthPath: String(runtime.healthPath || template.contract.healthPath),
          inferencePath: String(runtime.inferencePath || template.contract.inferencePath),
          preloadPath: String(runtime.preloadPath || template.contract.preloadPath),
          errorFormat: template.contract.errorFormat,
        },
        preload: {
          status: "pending",
          hook: String(runtime.preloadHook || template.contract.preloadPath),
          lastRunAt: null,
        },
        warmup: {
          status: "pending",
          startedAt: nowIso(),
          completedAt: null,
          checks: [],
        },
      },
      health: "warming",
      lastHealthCheckAt: null,
      updatedAt: nowIso(),
    };
  }

  warmupRuntime(instance, options = {}) {
    const maxChecks = Math.max(1, Number(options.maxChecks || 3));
    const checks = [];
    for (let index = 0; index < maxChecks; index += 1) {
      checks.push({
        at: nowIso(),
        status: "ok",
        latencyMs: 45 + Math.floor(Math.random() * 120),
      });
    }

    return {
      ...instance,
      status: "running",
      health: "ready",
      lastHealthCheckAt: nowIso(),
      runtime: {
        ...(instance.runtime || {}),
        preload: {
          ...(instance.runtime?.preload || {}),
          status: "completed",
          lastRunAt: nowIso(),
        },
        warmup: {
          ...(instance.runtime?.warmup || {}),
          status: "completed",
          completedAt: nowIso(),
          checks,
        },
      },
      updatedAt: nowIso(),
    };
  }

  checkRuntimeHealth(instance) {
    const isReady = instance.status === "running" && instance.health === "ready";
    if (!isReady) {
      return {
        ok: false,
        status: instance.health || "unknown",
        endpoint: instance.endpoint || "",
        checkedAt: nowIso(),
      };
    }

    return {
      ok: true,
      status: "ready",
      endpoint: instance.endpoint || "",
      checkedAt: nowIso(),
      contract: instance.runtime?.contract || null,
    };
  }

  runInference(instance, payload = {}) {
    const prompt = String(payload.prompt || "").trim();
    const model = String(payload.model || instance.runtime?.model || "open-source-default").trim();

    if (!prompt) {
      return structuredRuntimeError(
        "EMPTY_PROMPT",
        "Prompt is required",
        { field: "prompt" },
        false,
      );
    }

    if (instance.status !== "running" || instance.health !== "ready") {
      return structuredRuntimeError(
        "RUNTIME_NOT_READY",
        "Inference runtime is not ready",
        {
          status: instance.status,
          health: instance.health,
        },
        true,
      );
    }



    return {
      ok: true,
      model,
      output: `Phase 2 inference via ${this.definition.name} (${instance.gpuType}): ${prompt.slice(0, 220)}`,
      tokensEstimate: Math.max(8, Math.ceil(prompt.length / 4)),
      latencyMs: 100 + Math.floor(Math.random() * 240),
      endpoint: instance.endpoint,
      contract: instance.runtime?.contract || null,
    };
  }
}

export function createGpuAdapterRegistry() {
  const adapters = new Map();
  for (const definition of GPU_PROVIDER_DEFINITIONS) {
    adapters.set(definition.id, new ProviderGpuAdapter(definition));
  }

  return {
    listProviders() {
      return GPU_PROVIDER_DEFINITIONS.map((definition) => ({
        id: definition.id,
        name: definition.name,
        description: definition.description,
        authFields: definition.authFields,
      }));
    },
    getAdapter(providerId) {
      return adapters.get(providerId) || null;
    },
    hasProvider(providerId) {
      return adapters.has(providerId);
    },
    listRuntimeTemplates() {
      return GPU_RUNTIME_TEMPLATES.map((template) => ({ ...template }));
    },
  };
}

export function ensureGpuConfigShape(config) {
  const next = config && typeof config === "object" ? { ...config } : {};
  next.gpu = next.gpu && typeof next.gpu === "object" ? { ...next.gpu } : {};
  next.gpu.providers =
    next.gpu.providers && typeof next.gpu.providers === "object" ? { ...next.gpu.providers } : {};
  next.gpu.providerAccounts = Array.isArray(next.gpu.providerAccounts) ? [...next.gpu.providerAccounts] : [];
  next.gpu.instances = Array.isArray(next.gpu.instances) ? [...next.gpu.instances] : [];
  next.gpu.routing =
    next.gpu.routing && typeof next.gpu.routing === "object" ? { ...next.gpu.routing } : {};
  next.gpu.inferenceProfiles =
    next.gpu.inferenceProfiles && typeof next.gpu.inferenceProfiles === "object"
      ? { ...next.gpu.inferenceProfiles }
      : {};
  next.gpu.inferenceRequestLogs = Array.isArray(next.gpu.inferenceRequestLogs)
    ? [...next.gpu.inferenceRequestLogs]
    : [];
  next.gpu.budgetPolicies =
    next.gpu.budgetPolicies && typeof next.gpu.budgetPolicies === "object"
      ? { ...next.gpu.budgetPolicies }
      : {};
  next.gpu.reliability =
    next.gpu.reliability && typeof next.gpu.reliability === "object"
      ? { ...next.gpu.reliability }
      : {};
  next.gpu.circuitBreakers =
    next.gpu.circuitBreakers && typeof next.gpu.circuitBreakers === "object"
      ? { ...next.gpu.circuitBreakers }
      : {};
  next.gpu.fallbackRoutes =
    next.gpu.fallbackRoutes && typeof next.gpu.fallbackRoutes === "object"
      ? { ...next.gpu.fallbackRoutes }
      : {};
  next.gpu.observability =
    next.gpu.observability && typeof next.gpu.observability === "object"
      ? { ...next.gpu.observability }
      : {};
  next.gpu.rollout =
    next.gpu.rollout && typeof next.gpu.rollout === "object"
      ? { ...next.gpu.rollout }
      : {};
  next.gpu.auditLogs = Array.isArray(next.gpu.auditLogs) ? [...next.gpu.auditLogs] : [];
  next.gpu.kms = next.gpu.kms && typeof next.gpu.kms === "object" ? { ...next.gpu.kms } : {};
  return next;
}

export function normalizeGpuInstance(instance) {
  return {
    id: instance.id,
    name: instance.name,
    providerId: instance.providerId,
    providerName: instance.providerName,
    region: instance.region,
    gpuType: instance.gpuType,
    gpuCount: instance.gpuCount,
    cpuCores: instance.cpuCores ?? null,
    memoryGb: instance.memoryGb ?? null,
    diskGb: instance.diskGb ?? null,
    status: instance.status,
    endpoint: instance.endpoint,
    health: instance.health || "unknown",
    lastHealthCheckAt: instance.lastHealthCheckAt || null,
    inferenceProfileId: instance.inferenceProfileId || null,
    budgetPolicyId: instance.budgetPolicyId || null,
    runtime: instance.runtime || null,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
  };
}

export function normalizeProviderAccount(account) {
  if (!account || typeof account !== "object") {
    return null;
  }

  return {
    id: account.id,
    userId: account.userId,
    providerId: account.providerId,
    status: account.status || "unknown",
    lastValidatedAt: account.lastValidatedAt || null,
    updatedAt: account.updatedAt || null,
    credentialRef: account.credentialRef
      ? {
          version: account.credentialRef.version,
          kmsProvider: account.credentialRef.kmsProvider,
          keyId: account.credentialRef.keyId,
          encryptedAt: account.credentialRef.encryptedAt,
        }
      : null,
    permissions: account.permissions || {
      required: [],
      granted: [],
      missing: [],
      verifiedAt: null,
    },
    tokenPolicy: account.tokenPolicy || {
      mode: "prefer-short-lived",
      maxTtlMinutes: 60,
    },
  };
}

export function createGpuRoutingService() {
  return {
    getRoute(config, projectId = "default") {
      const next = ensureGpuConfigShape(config);
      return next.gpu.routing[String(projectId)];
    },
    setRoute(config, projectId = "default", instanceId) {
      const next = ensureGpuConfigShape(config);
      next.gpu.routing[String(projectId)] = instanceId;
      return next;
    },
    resolveInstance({ config, projectId = "default", instanceId }) {
      const next = ensureGpuConfigShape(config);
      const instances = next.gpu.instances;

      if (instanceId) {
        return instances.find((instance) => instance.id === instanceId) || null;
      }

      const routed = next.gpu.routing[String(projectId)];
      if (routed) {
        const hit = instances.find((instance) => instance.id === routed);
        if (hit) {
          return hit;
        }
      }

      return instances.find((instance) => instance.status === "running") || null;
    },
  };
}
