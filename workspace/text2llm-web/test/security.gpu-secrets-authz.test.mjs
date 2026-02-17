import assert from "node:assert/strict";
import test from "node:test";
import { expectOk, readConfig, requestJson, startTestServer, stopTestServer } from "./helpers.mjs";

test("security: secrets redaction, encrypted persistence, authz boundaries", async () => {
  const ctx = await startTestServer();
  const secretKey = "SUPER_SECRET_AWS_KEY_123456";
  try {
    const configure = await requestJson(ctx.baseUrl, "/api/instances/gpu/provider/configure", {
      method: "POST",
      body: JSON.stringify({
        providerId: "aws",
        credentials: {
          AWS_ACCESS_KEY_ID: "AKIA-STRICT-TEST",
          AWS_SECRET_ACCESS_KEY: secretKey,
        },
      }),
    });
    expectOk(configure);

    const providers = await requestJson(ctx.baseUrl, "/api/instances/gpu/providers");
    expectOk(providers);

    const rawProviders = JSON.stringify(providers.json);
    assert.equal(rawProviders.includes(secretKey), false, "API response should never expose plaintext secret");

    const config = await readConfig(ctx.configPath);
    const asText = JSON.stringify(config);
    assert.equal(asText.includes(secretKey), false, "Config should not store plaintext secret");
    assert.ok(Array.isArray(config.gpu.providerAccounts));
    assert.ok(config.gpu.providerAccounts.length > 0);
    assert.ok(config.gpu.providerAccounts[0].credentialRef?.payload);

    const actionMissing = await requestJson(ctx.baseUrl, "/api/instances/gpu/instance/action", {
      method: "POST",
      body: JSON.stringify({ instanceId: "missing-instance", action: "start" }),
    });
    assert.equal(actionMissing.response.status, 404);

    const routeMissing = await requestJson(ctx.baseUrl, "/api/instances/gpu/routing", {
      method: "POST",
      body: JSON.stringify({ projectId: "security", instanceId: "missing-instance" }),
    });
    assert.equal(routeMissing.response.status, 404);
  } finally {
    await stopTestServer(ctx);
  }
});
