import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "text2llm",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "text2llm", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "text2llm", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "text2llm", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "text2llm", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "text2llm", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "text2llm", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (dev first)", () => {
    const res = parseCliProfileArgs(["node", "text2llm", "--dev", "--profile", "work", "status"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (profile first)", () => {
    const res = parseCliProfileArgs(["node", "text2llm", "--profile", "work", "--dev", "status"]);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".text2llm-dev");
    expect(env.TEXT2LLM_PROFILE).toBe("dev");
    expect(env.TEXT2LLM_STATE_DIR).toBe(expectedStateDir);
    expect(env.TEXT2LLM_CONFIG_PATH).toBe(path.join(expectedStateDir, "text2llm.json"));
    expect(env.TEXT2LLM_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      TEXT2LLM_STATE_DIR: "/custom",
      TEXT2LLM_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.TEXT2LLM_STATE_DIR).toBe("/custom");
    expect(env.TEXT2LLM_GATEWAY_PORT).toBe("19099");
    expect(env.TEXT2LLM_CONFIG_PATH).toBe(path.join("/custom", "text2llm.json"));
  });

  it("uses TEXT2LLM_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      TEXT2LLM_HOME: "/srv/text2llm-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/text2llm-home");
    expect(env.TEXT2LLM_STATE_DIR).toBe(path.join(resolvedHome, ".text2llm-work"));
    expect(env.TEXT2LLM_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".text2llm-work", "text2llm.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it("returns command unchanged when no profile is set", () => {
    expect(formatCliCommand("text2llm doctor --fix", {})).toBe("text2llm doctor --fix");
  });

  it("returns command unchanged when profile is default", () => {
    expect(formatCliCommand("text2llm doctor --fix", { TEXT2LLM_PROFILE: "default" })).toBe(
      "text2llm doctor --fix",
    );
  });

  it("returns command unchanged when profile is Default (case-insensitive)", () => {
    expect(formatCliCommand("text2llm doctor --fix", { TEXT2LLM_PROFILE: "Default" })).toBe(
      "text2llm doctor --fix",
    );
  });

  it("returns command unchanged when profile is invalid", () => {
    expect(formatCliCommand("text2llm doctor --fix", { TEXT2LLM_PROFILE: "bad profile" })).toBe(
      "text2llm doctor --fix",
    );
  });

  it("returns command unchanged when --profile is already present", () => {
    expect(
      formatCliCommand("text2llm --profile work doctor --fix", { TEXT2LLM_PROFILE: "work" }),
    ).toBe("text2llm --profile work doctor --fix");
  });

  it("returns command unchanged when --dev is already present", () => {
    expect(formatCliCommand("text2llm --dev doctor", { TEXT2LLM_PROFILE: "dev" })).toBe(
      "text2llm --dev doctor",
    );
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("text2llm doctor --fix", { TEXT2LLM_PROFILE: "work" })).toBe(
      "text2llm --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("text2llm doctor --fix", { TEXT2LLM_PROFILE: "  jbTEXT2LLM  " })).toBe(
      "text2llm --profile jbTEXT2LLM doctor --fix",
    );
  });

  it("handles command with no args after text2llm", () => {
    expect(formatCliCommand("text2llm", { TEXT2LLM_PROFILE: "test" })).toBe(
      "text2llm --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm text2llm doctor", { TEXT2LLM_PROFILE: "work" })).toBe(
      "pnpm text2llm --profile work doctor",
    );
  });
});
