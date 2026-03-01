/**
 * Test to verify the chat endpoint:
 * 1. Sends a simple message
 * 2. Logs all SSE events with timestamps  
 * 3. Verifies at least one chunk arrives OR an error/timeout is sent
 *
 * Run:  node test-validate.mjs
 * Requires the server to be running on localhost:8787
 */

const BASE = "http://localhost:8787";

async function testChat() {
  console.log("=== Chat Endpoint Test ===\n");
  console.log("Sending POST /api/chat ...\n");
  const startMs = Date.now();

  let response;
  try {
    response = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "say hi in one sentence",
        sessionId: `test-${Date.now()}`,
        history: [],
      }),
    });
  } catch (err) {
    console.error("❌ FAILED to connect to server:", err.message);
    console.error("   Make sure the server is running: npm start");
    process.exit(1);
  }

  if (!response.ok) {
    console.error("❌ HTTP error:", response.status, await response.text());
    process.exit(1);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let chunkCount = 0;
  let errorCount = 0;
  let doneReceived = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      }
      if (!line.startsWith("data: ")) continue;

      try {
        const data = JSON.parse(line.slice(6));
        const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);

        switch (currentEvent) {
          case "chunk":
            chunkCount++;
            console.log(`  [${elapsedSec}s] ✅ CHUNK #${chunkCount}: "${data.text?.slice(0, 80)}"`);
            break;
          case "error":
            errorCount++;
            console.log(`  [${elapsedSec}s] ⚠️  ERROR: ${data.title || data.message}`);
            if (data.hints) data.hints.forEach(h => console.log(`           → ${h}`));
            break;
          case "done":
            doneReceived = true;
            console.log(`  [${elapsedSec}s] 🏁 DONE: code=${data.code}${data.reason ? ` reason=${data.reason}` : ""}`);
            break;
          case "progress":
            console.log(`  [${elapsedSec}s] ⏳ ${data.label} — ${data.detail} [${data.state}]`);
            break;
          case "heartbeat":
            // Only show every 30s to reduce noise
            if (data.elapsedSec % 30 === 0) {
              console.log(`  [${elapsedSec}s] 💓 ${data.text}`);
            }
            break;
          case "status":
            console.log(`  [${elapsedSec}s] 📡 ${data.text}`);
            break;
          default:
            break;
        }
      } catch (_) { /* skip */ }
    }
  }

  const totalSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n=== Results ===`);
  console.log(`  Total time:    ${totalSec}s`);
  console.log(`  Chunks:        ${chunkCount}`);
  console.log(`  Errors:        ${errorCount}`);
  console.log(`  Done received: ${doneReceived}`);
  
  if (chunkCount > 0) {
    console.log(`\n✅ TEST PASSED: Received ${chunkCount} chunk(s) in ${totalSec}s`);
  } else if (errorCount > 0 && doneReceived) {
    console.log(`\n⚠️  TEST PASSED (with error): Server returned structured error and done event`);
  } else {
    console.log(`\n❌ TEST FAILED: No chunks or errors received`);
    process.exit(1);
  }
}

testChat().catch(err => {
  console.error("❌ Unexpected error:", err.message);
  process.exit(1);
});
