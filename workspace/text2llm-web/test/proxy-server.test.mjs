import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { startProxyServer } from "../proxy-server.mjs";

function json(res) {
  return res.json();
}

async function withUpstream(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withProxy(env, run) {
  const previous = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }

  const server = startProxyServer(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("proxy health endpoint works", async () => {
  await withProxy({ PROXY_SKIP_AUTH: "true" }, async (proxyUrl) => {
    const response = await fetch(`${proxyUrl}/health`);
    assert.equal(response.status, 200);
    const body = await json(response);
    assert.equal(body.ok, true);
    assert.equal(body.service, "text2llm-web-proxy");
  });
});

test("proxy root endpoint returns service metadata", async () => {
  await withProxy({ PROXY_SKIP_AUTH: "true" }, async (proxyUrl) => {
    const response = await fetch(`${proxyUrl}/`);
    assert.equal(response.status, 200);
    const body = await json(response);
    assert.equal(body.ok, true);
    assert.equal(body.service, "text2llm-web-proxy");
    assert.equal(Array.isArray(body.endpoints), true);
  });
});

test("chat proxy returns 400 without provider key", async () => {
  await withProxy({ PROXY_SKIP_AUTH: "true" }, async (proxyUrl) => {
    const response = await fetch(`${proxyUrl}/v1/proxy/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-4.1-mini", messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(response.status, 400);
    const body = await json(response);
    assert.equal(body.error, "missing_x_provider_key");
  });
});

test("chat proxy forwards request to provider", async () => {
  await withUpstream(async (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer test-provider-key");

    let raw = "";
    for await (const chunk of req) {
      raw += String(chunk);
    }
    const payload = JSON.parse(raw);
    assert.equal(payload.model, "gpt-4.1-mini");

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl_test",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    );
  }, async (upstreamUrl) => {
    await withProxy(
      {
        PROXY_SKIP_AUTH: "true",
        PROXY_PROVIDER_OPENAI_CHAT_URL: `${upstreamUrl}/v1/chat/completions`,
      },
      async (proxyUrl) => {
        const response = await fetch(`${proxyUrl}/v1/proxy/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-provider": "openai",
            "x-provider-key": "test-provider-key",
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            messages: [{ role: "user", content: "Say hello" }],
          }),
        });
        assert.equal(response.status, 200);
        const body = await json(response);
        assert.equal(body.choices[0].message.content, "hello");
      },
    );
  });
});

test("chat proxy enforces request-per-minute limit", async () => {
  await withUpstream(async (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
  }, async (upstreamUrl) => {
    await withProxy(
      {
        PROXY_SKIP_AUTH: "true",
        PROXY_RATE_LIMIT_RPM: "1",
        PROXY_PROVIDER_OPENAI_CHAT_URL: `${upstreamUrl}/v1/chat/completions`,
      },
      async (proxyUrl) => {
        const request = () =>
          fetch(`${proxyUrl}/v1/proxy/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-provider": "openai",
              "x-provider-key": "test-provider-key",
              "x-user-id": "rate-limited-user",
            },
            body: JSON.stringify({
              model: "gpt-4.1-mini",
              messages: [{ role: "user", content: "hi" }],
            }),
          });

        const first = await request();
        assert.equal(first.status, 200);

        const second = await request();
        assert.equal(second.status, 429);
        assert.equal(second.headers.get("retry-after") !== null, true);
      },
    );
  });
});
