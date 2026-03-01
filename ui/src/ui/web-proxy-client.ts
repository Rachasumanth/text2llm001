export type WebProxyChatRequest = {
  provider: string;
  providerKey: string;
  payload: Record<string, unknown>;
  accessToken?: string;
};

export type WebProxyClientOptions = {
  baseUrl: string;
};

const STORAGE_KEYS = {
  provider: "text2llm.web.proxy.provider",
  providerKey: "text2llm.web.proxy.key",
  model: "text2llm.web.proxy.model",
  accessToken: "text2llm.web.supabase.access_token",
};

function trimTrailingSlash(input: string) {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

export class WebProxyClient {
  private readonly baseUrl: string;

  constructor(options: WebProxyClientOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl.trim());
  }

  async health(): Promise<{ ok: boolean; [key: string]: unknown }> {
    const response = await fetch(`${this.baseUrl}/health`, { method: "GET" });
    if (!response.ok) {
      throw new Error(`proxy health failed: ${response.status}`);
    }
    return (await response.json()) as { ok: boolean; [key: string]: unknown };
  }

  async chatCompletions(request: WebProxyChatRequest) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Provider": request.provider,
      "X-Provider-Key": request.providerKey,
    };
    if (request.accessToken?.trim()) {
      headers.Authorization = `Bearer ${request.accessToken.trim()}`;
    }

    const response = await fetch(`${this.baseUrl}/v1/proxy/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(request.payload),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `proxy request failed: ${response.status}`);
    }

    return response;
  }
}

export function createWebProxyClientFromEnv(): WebProxyClient | null {
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const baseUrl = viteEnv?.VITE_TEXT2LLM_WEB_PROXY_URL?.trim();
  if (!baseUrl) {
    return null;
  }
  return new WebProxyClient({ baseUrl });
}

export function getWebProxyClient() {
  return createWebProxyClientFromEnv();
}

export function isWebProxyConfigured() {
  return createWebProxyClientFromEnv() !== null;
}

function readStorageValue(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const value = window.localStorage.getItem(key);
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export function getWebProxyRuntimeConfig() {
  return {
    provider: readStorageValue(STORAGE_KEYS.provider) ?? "",
    providerKey: readStorageValue(STORAGE_KEYS.providerKey),
    model: readStorageValue(STORAGE_KEYS.model) ?? "",
    accessToken: readStorageValue(STORAGE_KEYS.accessToken),
  };
}
