import { requestJson } from "./test/helpers.mjs";

async function main() {
  const baseUrl = "http://localhost:8787";
  const configure = await requestJson(baseUrl, "/api/instances/gpu/provider/configure", {
    method: "POST",
    body: JSON.stringify({
      providerId: "selfhosted",
      credentials: { SSH_HOST: "127.0.0.1", SSH_USER: "tester", SSH_PRIVATE_KEY: "key" },
    }),
  });
  console.log("Config:", configure.json);

  const launch = await requestJson(baseUrl, "/api/instances/gpu/instance/launch", {
    method: "POST",
    body: JSON.stringify({
      providerId: "selfhosted",
      region: "custom",
      gpuType: "T4",
      gpuCount: 1,
      name: "test-launch",
      projectId: "default",
      runtime: { templateId: "vllm", model: "model" },
    }),
  });
  console.log("Launch error payload:", JSON.stringify(launch.json, null, 2));
}

main().catch(console.error);
