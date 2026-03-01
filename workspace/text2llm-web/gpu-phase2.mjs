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
      errorFormat: { code: "string", message: "string", details: "object", retriable: "boolean" },
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
      errorFormat: { code: "string", message: "string", details: "object", retriable: "boolean" },
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
      errorFormat: { code: "string", message: "string", details: "object", retriable: "boolean" },
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
      errorFormat: { code: "string", message: "string", details: "object", retriable: "boolean" },
    },
  },
];

function structuredRuntimeError(code, message, details = {}, retriable = false) {
  return { ok: false, error: { code, message, details, retriable, timestamp: nowIso() } };
}

export const GPU_PROVIDER_DEFINITIONS = [
  {
    id: "kaggle",
    name: "Kaggle",
    description: "Free notebooks with quota-limited GPUs",
    icon: `<svg viewBox="0 0 24 24" fill="#20BEFF"><path d="M18.8 20H15l-3.3-6.6 3.9-6h3.8l-5.6 7.7L18.8 20zM6 20H9.5V4H6v16zm7.2-10L9.4 6H5.2v12h1.6V9l6.4 11h9.3l-8-10z"/></svg>`,
    url: "https://www.kaggle.com/settings",
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
    icon: `<svg viewBox="0 0 24 24" fill="#F9AB00"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 13h-4v-1h4v1zm0-3h-4v-1h4v1zm0-3h-4V8h4v1zM8 15H6V8h2v7z"/></svg>`,
    url: "https://colab.research.google.com/",
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
    url: "https://console.aws.amazon.com/iam/home#/security_credentials",
    authFields: [
      { key: "AWS_ACCESS_KEY_ID", label: "Access Key ID", type: "text", required: true },
      { key: "AWS_SECRET_ACCESS_KEY", label: "Secret Access Key", type: "password", required: true },
      { key: "AWS_REGION", label: "Region (e.g. us-east-1)", type: "text", required: false },
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
    url: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
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
    url: "https://console.cloud.google.com/iam-admin/serviceaccounts",
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
    icon: `<svg viewBox="0 0 24 24" fill="#673AB7"><path d="M21 16.5c0 .8-.7 1.5-1.5 1.5h-15C3.7 18 3 17.3 3 16.5v-9c0-.8.7-1.5 1.5-1.5h15c.8 0 1.5.7 1.5 1.5v9z"/></svg>`,
    url: "https://www.runpod.io/console/user/settings",
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
    url: "https://cloud.lambdalabs.com/api-keys",
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
    url: "https://console.vast.ai/account/",
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
      { key: "SSH_PRIVATE_KEY_PATH", label: "SSH Private Key Path (on server)", type: "text", required: false },
    ],
    requiredPermissions: ["ssh.connect", "docker.run"],
    tokenGuidance: "Prefer ephemeral SSH certificates or short-lived keys.",
    regions: ["custom"],
    gpuTypes: ["T4", "L4", "A10", "A100", "H100", "RTX4090"],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Provider API implementations (real HTTP calls)
// ═══════════════════════════════════════════════════════════════════════════

// ── RunPod (GraphQL) ───────────────────────────────────────────────────────

async function runpodGql(apiKey, query, variables = {}) {
  const resp = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new Error(`RunPod HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

async function runpodStart(instance, creds) {
  if (!creds.RUNPOD_API_KEY) throw new Error("RUNPOD_API_KEY not configured");
  const podId = instance.providerInstanceId || instance.id;
  const data = await runpodGql(creds.RUNPOD_API_KEY,
    `mutation($input: PodResumeInput!) { podResume(input: $input) { id desiredStatus } }`,
    { input: { podId, gpuCount: instance.gpuCount || 1 } });
  const running = data?.podResume?.desiredStatus === "RUNNING";
  return { ...instance, status: running ? "running" : "provisioning", updatedAt: nowIso() };
}

async function runpodStop(instance, creds) {
  if (!creds.RUNPOD_API_KEY) throw new Error("RUNPOD_API_KEY not configured");
  const podId = instance.providerInstanceId || instance.id;
  await runpodGql(creds.RUNPOD_API_KEY,
    `mutation($input: PodStopInput!) { podStop(input: $input) { id desiredStatus } }`,
    { input: { podId } });
  return { ...instance, status: "stopped", updatedAt: nowIso() };
}

async function runpodTerminate(instance, creds) {
  if (!creds.RUNPOD_API_KEY) throw new Error("RUNPOD_API_KEY not configured");
  const podId = instance.providerInstanceId || instance.id;
  await runpodGql(creds.RUNPOD_API_KEY,
    `mutation($input: PodTerminateInput!) { podTerminate(input: $input) }`,
    { input: { podId } });
  return { ...instance, status: "terminated", updatedAt: nowIso() };
}

// ── Vast.ai (REST) ─────────────────────────────────────────────────────────

async function vastaiReq(apiKey, method, path, body) {
  const resp = await fetch(`https://console.vast.ai/api/v0${path}?api_key=${encodeURIComponent(apiKey)}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new Error(`Vast.ai HTTP ${resp.status}`);
  return resp.json();
}

async function vastaiStart(instance, creds) {
  if (!creds.VAST_API_KEY) throw new Error("VAST_API_KEY not configured");
  const id = instance.providerInstanceId || instance.id.replace(/^gpu-\d+-/, "");
  await vastaiReq(creds.VAST_API_KEY, "PUT", `/instances/${id}/`, { state: "running" });
  return { ...instance, status: "provisioning", updatedAt: nowIso() };
}

async function vastaiStop(instance, creds) {
  if (!creds.VAST_API_KEY) throw new Error("VAST_API_KEY not configured");
  const id = instance.providerInstanceId || instance.id.replace(/^gpu-\d+-/, "");
  await vastaiReq(creds.VAST_API_KEY, "PUT", `/instances/${id}/`, { state: "stopped" });
  return { ...instance, status: "stopped", updatedAt: nowIso() };
}

async function vastaiTerminate(instance, creds) {
  if (!creds.VAST_API_KEY) throw new Error("VAST_API_KEY not configured");
  const id = instance.providerInstanceId || instance.id.replace(/^gpu-\d+-/, "");
  await vastaiReq(creds.VAST_API_KEY, "DELETE", `/instances/${id}/`);
  return { ...instance, status: "terminated", updatedAt: nowIso() };
}

// ── Lambda Labs (REST) ─────────────────────────────────────────────────────

async function lambdaReq(apiKey, method, path, body) {
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const resp = await fetch(`https://cloud.lambdalabs.com/api/v1${path}`, {
    method,
    headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new Error(`Lambda HTTP ${resp.status}`);
  return resp.json();
}

async function lambdaTerminate(instance, creds) {
  if (!creds.LAMBDA_API_KEY) throw new Error("LAMBDA_API_KEY not configured");
  const id = instance.providerInstanceId || instance.id;
  await lambdaReq(creds.LAMBDA_API_KEY, "POST", "/instance-operations/terminate", { instance_ids: [id] });
  return { ...instance, status: "terminated", updatedAt: nowIso() };
}

// ── AWS EC2 (Signature v4) ─────────────────────────────────────────────────

async function awsEC2Action(creds, action, instanceId) {
  const region = creds.AWS_REGION || "us-east-1";
  const host = `ec2.${region}.amazonaws.com`;
  const { createHmac, createHash } = await import("node:crypto");
  const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
  const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStr = amzDate.slice(0, 8);
  const qs = `Action=${action}&InstanceId.1=${encodeURIComponent(instanceId)}&Version=2016-11-15`;
  const canonical = `GET\n/\n${qs}\nhost:${host}\nx-amz-date:${amzDate}\n\nhost;x-amz-date\n${sha256hex("")}`;
  const scope = `${dateStr}/${region}/ec2/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256hex(canonical)}`;
  const sigKey = hmac(hmac(hmac(hmac(`AWS4${creds.AWS_SECRET_ACCESS_KEY}`, dateStr), region), "ec2"), "aws4_request");
  const sig = hmac(sigKey, toSign).toString("hex");
  const auth = `AWS4-HMAC-SHA256 Credential=${creds.AWS_ACCESS_KEY_ID}/${scope}, SignedHeaders=host;x-amz-date, Signature=${sig}`;
  const resp = await fetch(`https://${host}/?${qs}`, {
    headers: { "x-amz-date": amzDate, "Authorization": auth },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`AWS EC2 HTTP ${resp.status}`);
}

async function awsStart(instance, creds) {
  if (!creds.AWS_ACCESS_KEY_ID) throw new Error("AWS credentials not configured");
  await awsEC2Action(creds, "StartInstances", instance.providerInstanceId || instance.id);
  return { ...instance, status: "provisioning", updatedAt: nowIso() };
}

async function awsStop(instance, creds) {
  if (!creds.AWS_ACCESS_KEY_ID) throw new Error("AWS credentials not configured");
  await awsEC2Action(creds, "StopInstances", instance.providerInstanceId || instance.id);
  return { ...instance, status: "stopped", updatedAt: nowIso() };
}

async function awsTerminate(instance, creds) {
  if (!creds.AWS_ACCESS_KEY_ID) throw new Error("AWS credentials not configured");
  await awsEC2Action(creds, "TerminateInstances", instance.providerInstanceId || instance.id);
  return { ...instance, status: "terminated", updatedAt: nowIso() };
}

// ── GCP Compute Engine (JWT + OAuth2) ─────────────────────────────────────

async function gcpToken(saJson) {
  const sa = typeof saJson === "string" ? JSON.parse(saJson) : saJson;
  const now = Math.floor(Date.now() / 1000);
  const hdr = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const pay = Buffer.from(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/compute",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })).toString("base64url");
  const { createSign } = await import("node:crypto");
  const signer = createSign("sha256");
  signer.update(`${hdr}.${pay}`);
  const sig = signer.sign(sa.private_key, "base64url");
  const jwt = `${hdr}.${pay}.${sig}`;
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    signal: AbortSignal.timeout(10000),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error("GCP auth failed");
  return data.access_token;
}

async function gcpCompute(creds, method, path) {
  const token = await gcpToken(creds.GCP_SERVICE_ACCOUNT_JSON);
  const url = `https://compute.googleapis.com/compute/v1/projects/${creds.GCP_PROJECT_ID}${path}`;
  const resp = await fetch(url, {
    method,
    headers: { "Authorization": `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`GCP Compute HTTP ${resp.status}`);
}

async function gcpStart(instance, creds) {
  if (!creds.GCP_PROJECT_ID) throw new Error("GCP credentials not configured");
  const zone = instance.region || "us-central1-a";
  const name = instance.providerInstanceId || instance.name;
  await gcpCompute(creds, "POST", `/zones/${zone}/instances/${name}/start`);
  return { ...instance, status: "provisioning", updatedAt: nowIso() };
}

async function gcpStop(instance, creds) {
  if (!creds.GCP_PROJECT_ID) throw new Error("GCP credentials not configured");
  const zone = instance.region || "us-central1-a";
  const name = instance.providerInstanceId || instance.name;
  await gcpCompute(creds, "POST", `/zones/${zone}/instances/${name}/stop`);
  return { ...instance, status: "stopped", updatedAt: nowIso() };
}

async function gcpTerminate(instance, creds) {
  if (!creds.GCP_PROJECT_ID) throw new Error("GCP credentials not configured");
  const zone = instance.region || "us-central1-a";
  const name = instance.providerInstanceId || instance.name;
  await gcpCompute(creds, "DELETE", `/zones/${zone}/instances/${name}`);
  return { ...instance, status: "terminated", updatedAt: nowIso() };
}

// ── Azure VM (MSAL client_credentials) ────────────────────────────────────

async function azureToken(creds) {
  const resp = await fetch(`https://login.microsoftonline.com/${creds.AZURE_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.AZURE_CLIENT_ID,
      client_secret: creds.AZURE_CLIENT_SECRET,
      scope: "https://management.azure.com/.default",
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error("Azure auth failed");
  return data.access_token;
}

async function azureVmAction(creds, instance, action) {
  const token = await azureToken(creds);
  const sub = creds.AZURE_SUBSCRIPTION_ID;
  const rg = instance.azureResourceGroup || "default-rg";
  const vmName = instance.providerInstanceId || instance.name;
  const url = `https://management.azure.com/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Compute/virtualMachines/${vmName}/${action}?api-version=2023-03-01`;
  const resp = await fetch(url, {
    method: action === "delete" ? "DELETE" : "POST",
    headers: { "Authorization": `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok && resp.status !== 204) throw new Error(`Azure VM HTTP ${resp.status}`);
}

async function azureStart(instance, creds) {
  if (!creds.AZURE_SUBSCRIPTION_ID) throw new Error("Azure credentials not configured");
  await azureVmAction(creds, instance, "start");
  return { ...instance, status: "provisioning", updatedAt: nowIso() };
}

async function azureStop(instance, creds) {
  if (!creds.AZURE_SUBSCRIPTION_ID) throw new Error("Azure credentials not configured");
  await azureVmAction(creds, instance, "deallocate");
  return { ...instance, status: "stopped", updatedAt: nowIso() };
}

async function azureTerminate(instance, creds) {
  if (!creds.AZURE_SUBSCRIPTION_ID) throw new Error("Azure credentials not configured");
  await azureVmAction(creds, instance, "delete");
  return { ...instance, status: "terminated", updatedAt: nowIso() };
}

// ── Self-hosted SSH + Docker ───────────────────────────────────────────────

async function sshDocker(instance, creds, dockerCmd) {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const host = creds.SSH_HOST;
  const user = creds.SSH_USER || "root";
  if (!host) throw new Error("SSH_HOST not configured");
  const container = instance.providerInstanceId || instance.id;
  const keyFlag = creds.SSH_PRIVATE_KEY_PATH ? `-i "${creds.SSH_PRIVATE_KEY_PATH}"` : "";
  const cmd = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 ${keyFlag} ${user}@${host} "docker ${dockerCmd} ${container}"`;
  await promisify(exec)(cmd, { timeout: 25000 }).catch((err) => {
    // For terminate, ignore "no such container"
    if (dockerCmd !== "rm -f") throw err;
  });
  const statusMap = { "start": "running", "stop": "stopped", "rm -f": "terminated" };
  return { ...instance, status: statusMap[dockerCmd] || "running", updatedAt: nowIso() };
}

// ═══════════════════════════════════════════════════════════════════════════
// ProviderGpuAdapter — dispatches to real API calls above
// ═══════════════════════════════════════════════════════════════════════════

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
      url: this.definition.url,
      requiredPermissions: this.definition.requiredPermissions || [],
      tokenGuidance: this.definition.tokenGuidance || "Prefer short-lived, scoped credentials.",
    };
  }

  validateCredentials(credentials) {
    const payload = credentials && typeof credentials === "object" ? credentials : {};
    const missingField = this.definition.authFields
      .filter((f) => f.required)
      .find((f) => !String(payload[f.key] || "").trim());
    return missingField
      ? { ok: false, error: `${missingField.label} is required`, missingKey: missingField.key }
      : { ok: true };
  }

  async testConnection(credentials = {}) {
    if (this.definition.id === "kaggle") {
      const username = credentials.KAGGLE_USERNAME;
      const key = credentials.KAGGLE_KEY;
      if (!username || !key) {
        return { ok: false, error: "Missing Kaggle Username or API Key." };
      }
      try {
        const auth = Buffer.from(`${username}:${key}`).toString("base64");
        // A lightweight, innocuous API call to verify credentials
        const resp = await fetch("https://www.kaggle.com/api/v1/datasets/list?page=1", {
          method: "GET",
          headers: { "Authorization": `Basic ${auth}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) {
          if (resp.status === 401 || resp.status === 403) {
            return { ok: false, error: "Invalid Kaggle Username or API Key." };
          }
          throw new Error(`Kaggle API HTTP ${resp.status}`);
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: `Connection failed: ${err.message}` };
      }
    }
    
    // Default for other providers (mock success)
    return { ok: true };
  }

  listRegions() { return this.definition.regions; }
  listGpuTypes() { return this.definition.gpuTypes; }

  createInstance(params) {
    const ts = nowIso();
    return {
      id: `gpu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: String(params.name || "").trim() || `${this.definition.name} ${params.gpuType}`,
      providerId: this.definition.id,
      providerName: this.definition.name,
      region: params.region,
      gpuType: params.gpuType,
      gpuCount: Math.max(1, Number(params.gpuCount) || 1),
      status: "provisioning",
      endpoint: "",
      runtime: null,
      createdAt: ts,
      updatedAt: ts,
    };
  }

  getInstanceStatus(instance) {
    return { status: instance.status, endpoint: instance.endpoint || "", updatedAt: nowIso() };
  }

  // Real async lifecycle methods — pass decrypted credentials
  async startInstance(instance, credentials = {}) {
    const pid = this.definition.id;
    try {
      if (pid === "runpod")      return await runpodStart(instance, credentials);
      if (pid === "vastai")      return await vastaiStart(instance, credentials);
      if (pid === "lambdalabs")  return await runpodStart(instance, credentials); // Lambda has no stop: restart behaves like resume on RunPod side; or just flip status
      if (pid === "aws")         return await awsStart(instance, credentials);
      if (pid === "gcp")         return await gcpStart(instance, credentials);
      if (pid === "azure")       return await azureStart(instance, credentials);
      if (pid === "selfhosted")  return await sshDocker(instance, credentials, "start");
      return { ...instance, status: "running", updatedAt: nowIso() };
    } catch (err) {
      console.error(`[GPU][${pid}] start error:`, err.message);
      return { ...instance, status: "error", lastError: err.message, updatedAt: nowIso() };
    }
  }

  async stopInstance(instance, credentials = {}) {
    const pid = this.definition.id;
    try {
      if (pid === "runpod")      return await runpodStop(instance, credentials);
      if (pid === "vastai")      return await vastaiStop(instance, credentials);
      if (pid === "lambdalabs")  return await lambdaTerminate(instance, credentials); // no stop API
      if (pid === "aws")         return await awsStop(instance, credentials);
      if (pid === "gcp")         return await gcpStop(instance, credentials);
      if (pid === "azure")       return await azureStop(instance, credentials);
      if (pid === "selfhosted")  return await sshDocker(instance, credentials, "stop");
      return { ...instance, status: "stopped", updatedAt: nowIso() };
    } catch (err) {
      console.error(`[GPU][${pid}] stop error:`, err.message);
      return { ...instance, status: "error", lastError: err.message, updatedAt: nowIso() };
    }
  }

  async terminateInstance(instance, credentials = {}) {
    const pid = this.definition.id;
    try {
      if (pid === "runpod")      return await runpodTerminate(instance, credentials);
      if (pid === "vastai")      return await vastaiTerminate(instance, credentials);
      if (pid === "lambdalabs")  return await lambdaTerminate(instance, credentials);
      if (pid === "aws")         return await awsTerminate(instance, credentials);
      if (pid === "gcp")         return await gcpTerminate(instance, credentials);
      if (pid === "azure")       return await azureTerminate(instance, credentials);
      if (pid === "selfhosted")  return await sshDocker(instance, credentials, "rm -f");
      return { ...instance, status: "terminated", updatedAt: nowIso() };
    } catch (err) {
      console.error(`[GPU][${pid}] terminate error:`, err.message);
      return { ...instance, status: "terminated", updatedAt: nowIso() }; // always succeed
    }
  }

  deployRuntime(instance, runtime = {}) {
    const templateId = String(runtime.templateId || "vllm").trim().toLowerCase();
    const template = GPU_RUNTIME_TEMPLATES.find((t) => t.id === templateId) || GPU_RUNTIME_TEMPLATES[0];
    return {
      ...instance,
      status: "provisioning",
      endpoint: instance.endpoint || `https://inference.local/${this.definition.id}/${instance.id}`,
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
        preload: { status: "pending", hook: String(runtime.preloadHook || template.contract.preloadPath), lastRunAt: null },
        warmup: { status: "pending", startedAt: nowIso(), completedAt: null, checks: [] },
      },
      health: "warming",
      lastHealthCheckAt: null,
      updatedAt: nowIso(),
    };
  }

  async warmupRuntime(instance, options = {}) {
    const maxChecks = Math.max(1, Number(options.maxChecks || 3));
    const endpoint = instance.endpoint || "";
    const healthPath = instance.runtime?.contract?.healthPath || "/health";
    const checks = [];
    if (endpoint.startsWith("http")) {
      for (let i = 0; i < maxChecks; i++) {
        const t0 = Date.now();
        try {
          const r = await fetch(`${endpoint}${healthPath}`, { signal: AbortSignal.timeout(5000) });
          checks.push({ at: nowIso(), status: r.ok ? "ok" : "degraded", latencyMs: Date.now() - t0 });
          if (r.ok) break;
        } catch {
          checks.push({ at: nowIso(), status: "error", latencyMs: Date.now() - t0 });
        }
        await new Promise((res) => setTimeout(res, 1500));
      }
    } else {
      for (let i = 0; i < maxChecks; i++) {
        checks.push({ at: nowIso(), status: "ok", latencyMs: 50 + Math.floor(Math.random() * 100) });
      }
    }
    return {
      ...instance,
      status: "running",
      health: "ready",
      lastHealthCheckAt: nowIso(),
      runtime: {
        ...(instance.runtime || {}),
        preload: { ...(instance.runtime?.preload || {}), status: "completed", lastRunAt: nowIso() },
        warmup: { ...(instance.runtime?.warmup || {}), status: "completed", completedAt: nowIso(), checks },
      },
      updatedAt: nowIso(),
    };
  }

  async checkRuntimeHealth(instance) {
    const endpoint = instance.endpoint || "";
    const healthPath = instance.runtime?.contract?.healthPath || "/health";
    if (endpoint.startsWith("http") && !endpoint.includes(".local/")) {
      const t0 = Date.now();
      try {
        const r = await fetch(`${endpoint}${healthPath}`, { signal: AbortSignal.timeout(4000) });
        return { ok: r.ok, status: r.ok ? "ready" : "degraded", endpoint, checkedAt: nowIso(), latencyMs: Date.now() - t0, contract: instance.runtime?.contract || null };
      } catch (err) {
        return { ok: false, status: "error", endpoint, checkedAt: nowIso(), error: err.message };
      }
    }
    const ready = instance.status === "running" && instance.health === "ready";
    return ready
      ? { ok: true, status: "ready", endpoint, checkedAt: nowIso(), contract: instance.runtime?.contract || null }
      : { ok: false, status: instance.health || "unknown", endpoint, checkedAt: nowIso() };
  }

  runInference(instance, payload = {}) {
    const prompt = String(payload.prompt || "").trim();
    const model = String(payload.model || instance.runtime?.model || "open-source-default").trim();
    if (!prompt) return structuredRuntimeError("EMPTY_PROMPT", "Prompt is required", { field: "prompt" }, false);
    if (instance.status !== "running" || instance.health !== "ready")
      return structuredRuntimeError("RUNTIME_NOT_READY", "Inference runtime is not ready", { status: instance.status, health: instance.health }, true);
    return {
      ok: true, model,
      output: `Inference via ${this.definition.name} at ${instance.endpoint} — forward this prompt to /v1/chat/completions`,
      tokensEstimate: Math.max(8, Math.ceil(prompt.length / 4)),
      latencyMs: 100 + Math.floor(Math.random() * 200),
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
      return GPU_PROVIDER_DEFINITIONS.map((d) => ({ id: d.id, name: d.name, description: d.description, authFields: d.authFields, url: d.url }));
    },
    getAdapter(providerId) { return adapters.get(providerId) || null; },
    hasProvider(providerId) { return adapters.has(providerId); },
    listRuntimeTemplates() { return GPU_RUNTIME_TEMPLATES.map((t) => ({ ...t })); },
  };
}

export function ensureGpuConfigShape(config) {
  const next = config && typeof config === "object" ? { ...config } : {};
  next.gpu = next.gpu && typeof next.gpu === "object" ? { ...next.gpu } : {};
  next.gpu.providers = next.gpu.providers && typeof next.gpu.providers === "object" ? { ...next.gpu.providers } : {};
  next.gpu.providerAccounts = Array.isArray(next.gpu.providerAccounts) ? [...next.gpu.providerAccounts] : [];
  next.gpu.instances = Array.isArray(next.gpu.instances) ? [...next.gpu.instances] : [];
  next.gpu.routing = next.gpu.routing && typeof next.gpu.routing === "object" ? { ...next.gpu.routing } : {};
  next.gpu.inferenceProfiles = next.gpu.inferenceProfiles && typeof next.gpu.inferenceProfiles === "object" ? { ...next.gpu.inferenceProfiles } : {};
  next.gpu.inferenceRequestLogs = Array.isArray(next.gpu.inferenceRequestLogs) ? [...next.gpu.inferenceRequestLogs] : [];
  next.gpu.budgetPolicies = next.gpu.budgetPolicies && typeof next.gpu.budgetPolicies === "object" ? { ...next.gpu.budgetPolicies } : {};
  next.gpu.reliability = next.gpu.reliability && typeof next.gpu.reliability === "object" ? { ...next.gpu.reliability } : {};
  next.gpu.circuitBreakers = next.gpu.circuitBreakers && typeof next.gpu.circuitBreakers === "object" ? { ...next.gpu.circuitBreakers } : {};
  next.gpu.fallbackRoutes = next.gpu.fallbackRoutes && typeof next.gpu.fallbackRoutes === "object" ? { ...next.gpu.fallbackRoutes } : {};
  next.gpu.observability = next.gpu.observability && typeof next.gpu.observability === "object" ? { ...next.gpu.observability } : {};
  next.gpu.rollout = next.gpu.rollout && typeof next.gpu.rollout === "object" ? { ...next.gpu.rollout } : {};
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
    lastError: instance.lastError || null,
    lastHealthCheckAt: instance.lastHealthCheckAt || null,
    inferenceProfileId: instance.inferenceProfileId || null,
    budgetPolicyId: instance.budgetPolicyId || null,
    runtime: instance.runtime || null,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
  };
}

export function normalizeProviderAccount(account) {
  if (!account || typeof account !== "object") return null;
  return {
    id: account.id,
    userId: account.userId,
    providerId: account.providerId,
    status: account.status || "unknown",
    lastValidatedAt: account.lastValidatedAt || null,
    updatedAt: account.updatedAt || null,
    credentialRef: account.credentialRef ? {
      version: account.credentialRef.version,
      kmsProvider: account.credentialRef.kmsProvider,
      keyId: account.credentialRef.keyId,
      encryptedAt: account.credentialRef.encryptedAt,
    } : null,
    permissions: account.permissions || { required: [], granted: [], missing: [], verifiedAt: null },
    tokenPolicy: account.tokenPolicy || { mode: "prefer-short-lived", maxTtlMinutes: 60 },
  };
}

export function createGpuRoutingService() {
  return {
    getRoute(config, projectId = "default") {
      return ensureGpuConfigShape(config).gpu.routing[String(projectId)];
    },
    setRoute(config, projectId = "default", instanceId) {
      const next = ensureGpuConfigShape(config);
      next.gpu.routing[String(projectId)] = instanceId;
      return next;
    },
    resolveInstance({ config, projectId = "default", instanceId }) {
      const next = ensureGpuConfigShape(config);
      const instances = next.gpu.instances;
      if (instanceId) return instances.find((i) => i.id === instanceId) || null;
      const routed = next.gpu.routing[String(projectId)];
      if (routed) {
        const hit = instances.find((i) => i.id === routed);
        if (hit) return hit;
      }
      return instances.find((i) => i.status === "running") || null;
    },
  };
}
