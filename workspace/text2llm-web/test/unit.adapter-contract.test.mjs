import assert from "node:assert/strict";
import test from "node:test";
import { createGpuAdapterRegistry, GPU_PROVIDER_DEFINITIONS } from "../gpu-phase2.mjs";

test("adapter registry exposes full Phase 2+6 contract for all providers", () => {
  const registry = createGpuAdapterRegistry();
  const requiredMethods = [
    "validateCredentials",
    "listRegions",
    "listGpuTypes",
    "createInstance",
    "getInstanceStatus",
    "startInstance",
    "stopInstance",
    "terminateInstance",
    "deployRuntime",
    "warmupRuntime",
    "checkRuntimeHealth",
    "runInference",
  ];

  for (const provider of GPU_PROVIDER_DEFINITIONS) {
    const adapter = registry.getAdapter(provider.id);
    assert.ok(adapter, `Adapter missing for provider ${provider.id}`);

    for (const method of requiredMethods) {
      assert.equal(typeof adapter[method], "function", `${provider.id} missing method ${method}`);
    }

    const info = adapter.getProviderInfo();
    assert.ok(Array.isArray(info.requiredPermissions), `${provider.id} must expose required permissions`);
    assert.equal(typeof info.tokenGuidance, "string", `${provider.id} must expose token guidance`);

    const invalid = adapter.validateCredentials({});
    assert.equal(invalid.ok, false, `${provider.id} should reject empty credentials`);

    const credentials = {};
    for (const field of provider.authFields) {
      credentials[field.key] = "placeholder";
    }

    const valid = adapter.validateCredentials(credentials);
    assert.equal(valid.ok, true, `${provider.id} should accept full credential payload`);

    const seed = adapter.createInstance({
      region: provider.regions[0],
      gpuType: provider.gpuTypes[0],
      gpuCount: 1,
      name: `${provider.id}-unit`,
    });
    const deployed = adapter.deployRuntime(seed, { templateId: "vllm", model: "unit-model" });
    assert.equal(deployed.status, "provisioning");
    assert.ok(deployed.runtime?.contract?.healthPath);

    const ready = adapter.warmupRuntime(deployed, { maxChecks: 2 });
    assert.equal(ready.status, "running");
    assert.equal(ready.health, "ready");

    const health = adapter.checkRuntimeHealth(ready);
    assert.equal(health.ok, true);

    const inference = adapter.runInference(ready, { prompt: "hello" });
    assert.equal(inference.ok, true);
    assert.equal(typeof inference.output, "string");
  }
});
