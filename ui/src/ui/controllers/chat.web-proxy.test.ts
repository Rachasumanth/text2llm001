import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sendChatMessage, type ChatState } from "./chat.ts";

function createState(): ChatState {
  return {
    client: null,
    connected: false,
    sessionKey: "main",
    chatLoading: false,
    chatMessages: [],
    chatThinkingLevel: null,
    chatSending: false,
    chatMessage: "",
    chatAttachments: [],
    chatRunId: null,
    chatStream: null,
    chatStreamStartedAt: null,
    lastError: null,
  };
}

describe("chat controller web proxy fallback", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("VITE_TEXT2LLM_WEB_PROXY_URL", "http://localhost:8790");
    window.localStorage.setItem("text2llm.web.proxy.key", "sk-test");
    window.localStorage.setItem("text2llm.web.proxy.provider", "openai");
    window.localStorage.setItem("text2llm.web.proxy.model", "gpt-4.1-mini");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    window.localStorage.clear();
  });

  it("sends message through web proxy when gateway is unavailable", async () => {
    globalThis.fetch = vi.fn(async (url, _init) => {
      if (String(url).endsWith("/v1/proxy/chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "hello from proxy" } }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const state = createState();
    const runId = await sendChatMessage(state, "hello");

    expect(runId).toBeTruthy();
    expect(state.chatMessages).toHaveLength(2);
    expect((state.chatMessages[1] as { content: Array<{ text: string }> }).content[0].text).toBe(
      "hello from proxy",
    );
    expect(state.lastError).toBeNull();
  });
});
