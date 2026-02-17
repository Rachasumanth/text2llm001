import assert from "node:assert/strict";
import test from "node:test";
import { expectOk, requestJson, startTestServer, stopTestServer } from "./helpers.mjs";

test("storage phases end-to-end: providers, project, policy, replication, sync, restore", async () => {
  const ctx = await startTestServer();
  try {
    const initial = await requestJson(ctx.baseUrl, "/api/instances/storage/state");
    expectOk(initial);
    assert.ok(Array.isArray(initial.json.providers));
    assert.ok(initial.json.providers.length >= 4);

    const configureS3 = await requestJson(ctx.baseUrl, "/api/instances/storage/provider/configure", {
      method: "POST",
      body: JSON.stringify({
        providerId: "s3",
        credentials: {
          accessKeyId: "AKIA_STORAGE_TEST",
          secretAccessKey: "STORAGE_SECRET_TEST",
          bucket: "text2llm-artifacts",
          region: "us-east-1",
        },
      }),
    });
    expectOk(configureS3);

    const project = await requestJson(ctx.baseUrl, "/api/instances/storage/project", {
      method: "POST",
      body: JSON.stringify({
        projectName: "medical-1b",
        defaultProviderId: "s3",
        rootPath: "Text2LLM/medical-1b",
      }),
    });
    expectOk(project);
    assert.equal(project.json.project.defaultProviderId, "s3");

    const policy = await requestJson(ctx.baseUrl, "/api/instances/storage/policies", {
      method: "POST",
      body: JSON.stringify({
        syncMode: "steps",
        syncEverySteps: 200,
        syncEveryMinutes: 10,
        retentionKeepLast: 2,
      }),
    });
    expectOk(policy);
    assert.equal(policy.json.policies.retentionKeepLast, 2);

    const replication = await requestJson(ctx.baseUrl, "/api/instances/storage/replication", {
      method: "POST",
      body: JSON.stringify({
        enabled: true,
        primaryProviderId: "s3",
        backupProviderId: "local",
      }),
    });
    expectOk(replication);
    assert.equal(replication.json.replication.enabled, true);

    const sync1 = await requestJson(ctx.baseUrl, "/api/instances/storage/checkpoint/sync", {
      method: "POST",
      body: JSON.stringify({ step: 200, sizeBytes: 256 * 1024 * 1024 }),
    });
    expectOk(sync1);

    const sync2 = await requestJson(ctx.baseUrl, "/api/instances/storage/checkpoint/sync", {
      method: "POST",
      body: JSON.stringify({ step: 400, sizeBytes: 256 * 1024 * 1024 }),
    });
    expectOk(sync2);

    const sync3 = await requestJson(ctx.baseUrl, "/api/instances/storage/checkpoint/sync", {
      method: "POST",
      body: JSON.stringify({ step: 600, sizeBytes: 256 * 1024 * 1024 }),
    });
    expectOk(sync3);

    const restore = await requestJson(ctx.baseUrl, "/api/instances/storage/restore/latest", {
      method: "POST",
      body: JSON.stringify({ providerId: "s3" }),
    });
    expectOk(restore);
    assert.equal(restore.json.restore.providerId, "s3");

    const finalState = await requestJson(ctx.baseUrl, "/api/instances/storage/state");
    expectOk(finalState);

    const checkpointContainer = finalState.json.project.containers.checkpoints;
    assert.ok(Number(checkpointContainer.artifactCount) >= 1);
    assert.ok(Number(checkpointContainer.artifactCount) <= 2, "retention should cap checkpoints at keepLast");
    assert.ok(Array.isArray(finalState.json.syncJobs));
    assert.ok(finalState.json.syncJobs.length >= 1);
    assert.ok(Array.isArray(finalState.json.restoreJobs));
    assert.ok(finalState.json.restoreJobs.length >= 1);
  } finally {
    await stopTestServer(ctx);
  }
});
