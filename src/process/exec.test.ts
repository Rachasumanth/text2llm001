import { describe, expect, it } from "vitest";
import { runCommandWithTimeout } from "./exec.js";

describe("runCommandWithTimeout", () => {
  it("passes env overrides to child", async () => {
    const result = await runCommandWithTimeout(
      [process.execPath, "-e", 'process.stdout.write(process.env.TEXT2LLM_TEST_ENV ?? "")'],
      {
        timeoutMs: 5_000,
        env: { TEXT2LLM_TEST_ENV: "ok" },
      },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("ok");
  });

  it("merges custom env with process.env", async () => {
    const previous = process.env.TEXT2LLM_BASE_ENV;
    process.env.TEXT2LLM_BASE_ENV = "base";
    try {
      const result = await runCommandWithTimeout(
        [
          process.execPath,
          "-e",
          'process.stdout.write((process.env.TEXT2LLM_BASE_ENV ?? "") + "|" + (process.env.TEXT2LLM_TEST_ENV ?? ""))',
        ],
        {
          timeoutMs: 5_000,
          env: { TEXT2LLM_TEST_ENV: "ok" },
        },
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("base|ok");
    } finally {
      if (previous === undefined) {
        delete process.env.TEXT2LLM_BASE_ENV;
      } else {
        process.env.TEXT2LLM_BASE_ENV = previous;
      }
    }
  });
});
