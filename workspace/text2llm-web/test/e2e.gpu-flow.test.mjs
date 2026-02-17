import assert from "node:assert/strict";
import test from "node:test";
import { expectOk, requestJson, startTestServer, stopTestServer } from "./helpers.mjs";

test("GPU e2e: provider configure -> launch -> route -> infer -> stop", async () => {
  const ctx = await startTestServer();
  try {
    const configure = await requestJson(ctx.baseUrl, "/api/instances/gpu/provider/configure", {
      method: "POST",
      body: JSON.stringify({
        providerId: "selfhosted",
        credentials: {
          SSH_HOST: "127.0.0.1",
          SSH_USER: "tester",
          SSH_PRIVATE_KEY: "-----BEGIN TEST KEY-----abc",
        },
      }),
    });
    expectOk(configure);

    const launch = await requestJson(ctx.baseUrl, "/api/instances/gpu/instance/launch", {
      method: "POST",
      body: JSON.stringify({
        providerId: "selfhosted",
        region: "custom",
        gpuType: "T4",
        gpuCount: 1,
        name: "strict-e2e-instance",
        projectId: "strict-e2e",
        runtime: {
          templateId: "vllm",
          model: "strict-model",
        },
      }),
    });
    expectOk(launch);
    const instanceId = launch.json.instance.id;
    assert.ok(instanceId);

    const route = await requestJson(ctx.baseUrl, "/api/instances/gpu/routing", {
      method: "POST",
      body: JSON.stringify({ projectId: "strict-e2e", instanceId }),
    });
    expectOk(route);

    const infer = await requestJson(ctx.baseUrl, "/api/instances/gpu/inference", {
      method: "POST",
      body: JSON.stringify({
        projectId: "strict-e2e",
        prompt: "Write one sentence about reliability testing",
      }),
    });
    expectOk(infer);
    assert.equal(infer.json.routedInstanceId, instanceId);
    assert.equal(typeof infer.json.result.output, "string");

    const stop = await requestJson(ctx.baseUrl, "/api/instances/gpu/instance/action", {
      method: "POST",
      body: JSON.stringify({ instanceId, action: "stop" }),
    });
    expectOk(stop);

    const inferStopped = await requestJson(ctx.baseUrl, "/api/instances/gpu/inference", {
      method: "POST",
      body: JSON.stringify({
        instanceId,
        projectId: "strict-e2e",
        prompt: "Should fail while stopped",
      }),
    });
    assert.equal(inferStopped.response.ok, false);
    assert.equal(inferStopped.response.status, 400);
  } finally {
    await stopTestServer(ctx);
  }
});
