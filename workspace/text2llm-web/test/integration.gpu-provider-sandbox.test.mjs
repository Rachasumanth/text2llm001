import assert from "node:assert/strict";
import test from "node:test";
import { expectOk, requestJson, startTestServer, stopTestServer } from "./helpers.mjs";

test("provider sandbox integration: configure, validate, capabilities, reliability APIs", async () => {
  const ctx = await startTestServer();
  try {
    const providers = await requestJson(ctx.baseUrl, "/api/instances/gpu/providers");
    expectOk(providers);
    assert.ok(Array.isArray(providers.json.providers));
    assert.ok(providers.json.providers.length > 0);

    const aws = providers.json.providers.find((provider) => provider.id === "aws");
    assert.ok(aws, "AWS provider should be present");

    const configure = await requestJson(ctx.baseUrl, "/api/instances/gpu/provider/configure", {
      method: "POST",
      body: JSON.stringify({
        providerId: "aws",
        credentials: {
          AWS_ACCESS_KEY_ID: "AKIA_TEST_000000",
          AWS_SECRET_ACCESS_KEY: "SECRET_TEST_000000",
        },
      }),
    });
    expectOk(configure);
    assert.equal(configure.json.security.encryptedAtRest, true);

    const validate = await requestJson(ctx.baseUrl, "/api/instances/gpu/provider/test", {
      method: "POST",
      body: JSON.stringify({ providerId: "aws" }),
    });
    expectOk(validate);
    assert.equal(validate.json.validation.ok, true);
    assert.ok(Array.isArray(validate.json.permissions.required));

    const capabilities = await requestJson(ctx.baseUrl, "/api/instances/gpu/provider/aws/capabilities");
    expectOk(capabilities);
    assert.ok(Array.isArray(capabilities.json.runtimeTemplates));
    assert.ok(capabilities.json.runtimeTemplates.length >= 3);

    const reliability = await requestJson(ctx.baseUrl, "/api/instances/gpu/reliability");
    expectOk(reliability);
    assert.ok(reliability.json.reliability.retryPolicy.maxRetries >= 1);

    const updateReliability = await requestJson(ctx.baseUrl, "/api/instances/gpu/reliability", {
      method: "POST",
      body: JSON.stringify({
        inferenceTimeoutMs: 12000,
        maxQueueDepthPerInstance: 3,
        retryPolicy: { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 500 },
        circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 10000 },
      }),
    });
    expectOk(updateReliability);
    assert.equal(updateReliability.json.reliability.inferenceTimeoutMs, 12000);
  } finally {
    await stopTestServer(ctx);
  }
});
