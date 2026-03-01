import { runEmbeddedPiAgent } from "./src/agents/pi-embedded-runner/run.js";

async function main() {
  console.log("Starting agent...");
  try {
    const res = await runEmbeddedPiAgent({
      runId: "test-run",
      workspaceDir: process.cwd(),
      sessionKey: "test-session",
      sessionId: "test-session",
      agentDir: ".text2llm/agents/main",
      prompt: "What is 2+2? Reply only with the number.",
      provider: "google-gemini-cli",
      model: "gemini-2.5-pro",
    });
    console.log("Result:");
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

main().catch(console.error);
