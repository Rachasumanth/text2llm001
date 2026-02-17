import assert from "node:assert/strict";
import test from "node:test";
import { expectOk, requestJson, startTestServer, stopTestServer } from "./helpers.mjs";

async function readSseEvents(response) {
  assert.equal(response.ok, true, `Expected 200 from SSE endpoint, got ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    raw += decoder.decode(value, { stream: true });
  }

  const events = [];
  const blocks = raw.split("\n\n").map((block) => block.trim()).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n");
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
      continue;
    }

    let data = null;
    try {
      data = JSON.parse(dataRaw);
    } catch {
      data = { raw: dataRaw };
    }

    events.push({ event: eventName, data });
  }

  return events;
}

test("Chat e2e: qwen finetune requires approval then starts Kaggle workflow", async () => {
  const ctx = await startTestServer();
  try {
    // Configure dummy Kaggle credentials (real API won't be reachable in tests)
    const configure = await requestJson(ctx.baseUrl, "/api/instances/gpu/provider/configure", {
      method: "POST",
      body: JSON.stringify({
        providerId: "kaggle",
        credentials: {
          KAGGLE_USERNAME: "qa-user",
          KAGGLE_KEY: "qa-key",
        },
      }),
    });
    expectOk(configure);

    // Step 1: Send finetune intent message → should get clarification + plan
    const initial = await fetch(`${ctx.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "finetune qwen model to make a maths sir ai",
      }),
    });

    const initialEvents = await readSseEvents(initial);
    const sessionEvent = initialEvents.find((item) => item.event === "session");
    assert.ok(sessionEvent?.data?.sessionId, "Expected session id in initial response");

    const initialChunk = initialEvents.find((item) => item.event === "chunk");
    assert.ok(initialChunk?.data?.text?.includes("Clarifications to confirm:"));
    assert.ok(initialChunk?.data?.text?.includes("Proposed execution plan:"));
    assert.ok(initialChunk?.data?.text?.includes("Reply with 'approve plan'"));

    // Step 2: Send approval → should attempt Kaggle push (may fail with API error in test env)
    const approval = await fetch(`${ctx.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionEvent.data.sessionId,
        message: "approve plan",
      }),
    });

    const approvalEvents = await readSseEvents(approval);
    const approvalStatus = approvalEvents.find(
      (item) => item.event === "status" && item?.data?.text?.includes("Approval received"),
    );
    assert.ok(approvalStatus, "Expected approval status event");

    // In CI/test env without real Kaggle creds, the push will fail.
    // We check that the workflow either started successfully OR reported a clear error.
    const doneEvent = approvalEvents.find((item) => item.event === "done");
    assert.ok(doneEvent, "Expected a done event");

    if (doneEvent.data.workflow === "started") {
      // Real Kaggle push succeeded (unlikely in test but valid)
      assert.ok(doneEvent.data.jobId, "Expected jobId on success");
      assert.ok(doneEvent.data.kernelUrl, "Expected kernelUrl on success");

      // Verify finetune status endpoint works
      const statusResp = await requestJson(
        ctx.baseUrl,
        `/api/finetune/status?jobId=${encodeURIComponent(doneEvent.data.jobId)}`,
      );
      expectOk(statusResp);
      assert.ok(statusResp.json.job, "Expected job in status response");
      assert.equal(statusResp.json.job.id, doneEvent.data.jobId);

      // Verify logs endpoint
      const logsResp = await requestJson(
        ctx.baseUrl,
        `/api/finetune/logs?jobId=${encodeURIComponent(doneEvent.data.jobId)}`,
      );
      expectOk(logsResp);
      assert.ok(Array.isArray(logsResp.json.logs), "Expected logs array");
    } else {
      // Kaggle API error (expected in test env) — verify error is properly reported
      assert.equal(doneEvent.data.workflow, "failed");
      assert.equal(doneEvent.data.code, 1);
      const errorEvent = approvalEvents.find((item) => item.event === "error");
      assert.ok(errorEvent?.data?.message, "Expected error message");
      assert.ok(errorEvent?.data?.recovery?.suggestions, "Expected recovery suggestions");
    }

    // Step 3: Verify finetune status list endpoint works
    const allJobs = await requestJson(ctx.baseUrl, "/api/finetune/status");
    expectOk(allJobs);
    assert.ok(Array.isArray(allJobs.json.jobs), "Expected jobs array");
  } finally {
    await stopTestServer(ctx);
  }
});

test("Chat e2e: qwen computer-use finetune returns domain-relevant clarifications", async () => {
  const ctx = await startTestServer();
  try {
    const initial = await fetch(`${ctx.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "finetune qwen model for computer use assistant",
      }),
    });

    const initialEvents = await readSseEvents(initial);
    const initialChunk = initialEvents.find((item) => item.event === "chunk");
    assert.ok(initialChunk?.data?.text?.includes("Custom Assistant AI") || initialChunk?.data?.text?.includes("Computer Use Assistant"));
    assert.ok(initialChunk?.data?.text?.includes("Target scope:"));
    assert.ok(initialChunk?.data?.text?.includes("computer use assistant"));
    assert.ok(initialChunk?.data?.text?.includes("Success criteria:"));
    assert.ok(initialChunk?.data?.text?.includes("Safety/permissions:"));
  } finally {
    await stopTestServer(ctx);
  }
});

test("Finetune API: /api/finetune/start without credentials returns error", async () => {
  const ctx = await startTestServer();
  try {
    // Don't configure Kaggle credentials
    const resp = await requestJson(ctx.baseUrl, "/api/finetune/start", {
      method: "POST",
      body: JSON.stringify({
        baseModel: "unsloth/Qwen2.5-7B-Instruct-bnb-4bit",
        persona: "Math Tutor AI",
      }),
    });
    // Should return 400 with credentials error
    assert.equal(resp.response.status, 400);
    assert.ok(resp.json.error.includes("Kaggle credentials"));
  } finally {
    await stopTestServer(ctx);
  }
});

test("Finetune API: /api/finetune/status with unknown jobId returns 404", async () => {
  const ctx = await startTestServer();
  try {
    const resp = await requestJson(
      ctx.baseUrl,
      "/api/finetune/status?jobId=nonexistent-job-123",
    );
    assert.equal(resp.response.status, 404);
    assert.ok(resp.json.error.includes("not found"));
  } finally {
    await stopTestServer(ctx);
  }
});

test("Finetune API: /api/finetune/logs without jobId returns 400", async () => {
  const ctx = await startTestServer();
  try {
    const resp = await requestJson(ctx.baseUrl, "/api/finetune/logs");
    assert.equal(resp.response.status, 400);
    assert.ok(resp.json.error.includes("jobId required"));
  } finally {
    await stopTestServer(ctx);
  }
});
