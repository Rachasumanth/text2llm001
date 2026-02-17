import assert from "node:assert/strict";
import test from "node:test";
import { startTestServer, stopTestServer } from "./helpers.mjs";

function parseSseBlock(block) {
  const lines = String(block || "").split("\n");
  let eventName = "message";
  let dataRaw = "";

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      eventName = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      dataRaw = line.slice(6).trim();
    }
  }

  if (!dataRaw) {
    return null;
  }

  let data = null;
  try {
    data = JSON.parse(dataRaw);
  } catch {
    data = { raw: dataRaw };
  }

  return { event: eventName, data };
}

test("Chat SSE streams progress before completion", async () => {
  const ctx = await startTestServer({ env: { TEXT2LLM_CHAT_TEST_MODE: "1" } });
  try {
    const response = await fetch(`${ctx.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello streaming" }),
    });

    assert.equal(response.ok, true, `Expected 200, got ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    const events = [];
    const startedAt = Date.now();

    while (Date.now() - startedAt < 3000) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";

      for (const block of blocks) {
        const parsed = parseSseBlock(block.trim());
        if (parsed) {
          events.push(parsed);
        }
      }

      if (events.some((event) => event.event === "done")) {
        break;
      }
    }

    const eventNames = events.map((event) => event.event);
    const doneIndex = eventNames.indexOf("done");
    const statusIndex = eventNames.indexOf("status");
    const chunkIndex = eventNames.indexOf("chunk");

    assert.ok(eventNames.includes("session"), "Expected session event");
    assert.ok(statusIndex >= 0, "Expected status event before completion");
    assert.ok(chunkIndex >= 0, "Expected chunk event before completion");
    assert.ok(doneIndex >= 0, "Expected done event");
    assert.ok(statusIndex < doneIndex, "Status must arrive before done");
    assert.ok(chunkIndex < doneIndex, "Chunk must arrive before done");
  } finally {
    await stopTestServer(ctx);
  }
});
