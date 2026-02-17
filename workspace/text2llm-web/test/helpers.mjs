import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const APP_ROOT = path.resolve(process.cwd());

export async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function createTempConfigFile() {
  const root = await mkdtemp(path.join(os.tmpdir(), "text2llm-web-test-"));
  const configPath = path.join(root, "text2llm.json");
  await writeFile(configPath, JSON.stringify({}, null, 2), "utf8");
  return { root, configPath };
}

export async function startTestServer(options = {}) {
  const { root, configPath } = await createTempConfigFile();
  const port = await getFreePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      TEXT2LLM_WEB_PORT: String(port),
      TEXT2LLM_CONFIG_PATH: configPath,
      ...(options.env || {}),
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  await waitForHealth(port);

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    child,
    configPath,
    tempRoot: root,
    getStderr: () => stderr,
  };
}

export async function stopTestServer(ctx) {
  if (!ctx) {
    return;
  }

  if (ctx.child && !ctx.child.killed) {
    ctx.child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (!ctx.child.killed) {
      ctx.child.kill("SIGKILL");
    }
  }

  if (ctx.tempRoot) {
    await rm(ctx.tempRoot, { recursive: true, force: true });
  }
}

export async function waitForHealth(port, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server failed to become healthy before timeout");
}

export async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  return { response, json };
}

export async function readConfig(configPath) {
  const raw = await readFile(configPath, "utf8");
  return JSON.parse(raw);
}

export function expectOk(result) {
  assert.equal(result.response.ok, true, JSON.stringify(result.json, null, 2));
  assert.equal(result.json.ok, true, JSON.stringify(result.json, null, 2));
}
