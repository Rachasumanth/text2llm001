import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { WebProxyClient } from "./web-proxy-client.ts";

describe("WebProxyClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls health endpoint", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;

    const client = new WebProxyClient({ baseUrl: "http://localhost:8790/" });
    const body = await client.health();

    expect(body.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith("http://localhost:8790/health", {
      method: "GET",
    });
  });

  it("sends chat completion request", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: "chatcmpl_test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;

    const client = new WebProxyClient({ baseUrl: "http://localhost:8790" });
    const response = await client.chatCompletions({
      provider: "openai",
      providerKey: "sk-test",
      payload: { model: "gpt-4.1-mini", messages: [{ role: "user", content: "hello" }] },
      accessToken: "supabase-token",
    });

    expect(response.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const [url, init] = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(url).toBe("http://localhost:8790/v1/proxy/chat/completions");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Provider"]).toBe("openai");
    expect(headers["X-Provider-Key"]).toBe("sk-test");
    expect(headers.Authorization).toBe("Bearer supabase-token");
  });
});
