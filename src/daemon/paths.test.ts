import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGatewayStateDir } from "./paths.js";

describe("resolveGatewayStateDir", () => {
  it("uses the default state dir when no overrides are set", () => {
    const env = { HOME: "/Users/test" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".text2llm"));
  });

  it("appends the profile suffix when set", () => {
    const env = { HOME: "/Users/test", TEXT2LLM_PROFILE: "rescue" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".text2llm-rescue"));
  });

  it("treats default profiles as the base state dir", () => {
    const env = { HOME: "/Users/test", TEXT2LLM_PROFILE: "Default" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".text2llm"));
  });

  it("uses TEXT2LLM_STATE_DIR when provided", () => {
    const env = { HOME: "/Users/test", TEXT2LLM_STATE_DIR: "/var/lib/text2llm" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/var/lib/text2llm"));
  });

  it("expands ~ in TEXT2LLM_STATE_DIR", () => {
    const env = { HOME: "/Users/test", TEXT2LLM_STATE_DIR: "~/text2llm-state" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/Users/test/text2llm-state"));
  });

  it("preserves Windows absolute paths without HOME", () => {
    const env = { TEXT2LLM_STATE_DIR: "C:\\State\\text2llm" };
    expect(resolveGatewayStateDir(env)).toBe("C:\\State\\text2llm");
  });
});
