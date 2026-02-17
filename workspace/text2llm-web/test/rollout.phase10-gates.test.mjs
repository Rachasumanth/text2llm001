import assert from "node:assert/strict";
import test from "node:test";
import { expectOk, requestJson, startTestServer, stopTestServer } from "./helpers.mjs";

test("phase 10 strict rollout: milestone + gate controls", async () => {
  const ctx = await startTestServer();
  try {
    const initial = await requestJson(ctx.baseUrl, "/api/instances/gpu/rollout/status");
    expectOk(initial);
    assert.ok(Array.isArray(initial.json.milestones));
    assert.ok(initial.json.milestones.length >= 4);

    const update = await requestJson(ctx.baseUrl, "/api/instances/gpu/rollout/status", {
      method: "POST",
      body: JSON.stringify({
        milestoneId: "milestone-4",
        status: "completed",
        gates: {
          strictTesting: true,
          securityChecks: true,
          observabilityChecks: true,
          productionReadiness: true,
        },
      }),
    });
    expectOk(update);

    const milestone4 = update.json.milestones.find((item) => item.id === "milestone-4");
    assert.ok(milestone4);
    assert.equal(milestone4.status, "completed");

    const summary = update.json.summary;
    assert.equal(summary.allGatesPassed, true);
    assert.equal(summary.completionPercent, 100);
  } finally {
    await stopTestServer(ctx);
  }
});
