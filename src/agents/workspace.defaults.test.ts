import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("DEFAULT_AGENT_WORKSPACE_DIR", () => {
  it("uses TEXT2LLM_HOME at module import time", async () => {
    const home = path.join(path.sep, "srv", "text2llm-home");
    vi.stubEnv("TEXT2LLM_HOME", home);
    vi.stubEnv("HOME", path.join(path.sep, "home", "other"));
    vi.resetModules();

    const mod = await import("./workspace.js");
    expect(mod.DEFAULT_AGENT_WORKSPACE_DIR).toBe(
      path.join(path.resolve(home), ".text2llm", "workspace"),
    );
  });
});
