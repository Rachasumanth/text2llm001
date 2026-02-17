import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "text2llm", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "text2llm", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "text2llm", "status"])).toBe(false);
  });

  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "text2llm", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "text2llm", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "text2llm", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });

  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "text2llm", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "text2llm"])).toBeNull();
  });

  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "text2llm", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "text2llm", "--", "--json"], "--json")).toBe(false);
  });

  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "text2llm", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "text2llm", "status", "--timeout=2500"], "--timeout")).toBe(
      "2500",
    );
    expect(getFlagValue(["node", "text2llm", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "text2llm", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "text2llm", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "text2llm", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "text2llm", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "text2llm", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "text2llm", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "text2llm", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "text2llm", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "text2llm", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });

  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "text2llm",
      rawArgs: ["node", "text2llm", "status"],
    });
    expect(nodeArgv).toEqual(["node", "text2llm", "status"]);

    const versionedNodeArgv = buildParseArgv({
      programName: "text2llm",
      rawArgs: ["node-22", "text2llm", "status"],
    });
    expect(versionedNodeArgv).toEqual(["node-22", "text2llm", "status"]);

    const versionedNodeWindowsArgv = buildParseArgv({
      programName: "text2llm",
      rawArgs: ["node-22.2.0.exe", "text2llm", "status"],
    });
    expect(versionedNodeWindowsArgv).toEqual(["node-22.2.0.exe", "text2llm", "status"]);

    const versionedNodePatchlessArgv = buildParseArgv({
      programName: "text2llm",
      rawArgs: ["node-22.2", "text2llm", "status"],
    });
    expect(versionedNodePatchlessArgv).toEqual(["node-22.2", "text2llm", "status"]);

    const versionedNodeWindowsPatchlessArgv = buildParseArgv({
      programName: "text2llm",
      rawArgs: ["node-22.2.exe", "text2llm", "status"],
    });
    expect(versionedNodeWindowsPatchlessArgv).toEqual(["node-22.2.exe", "text2llm", "status"]);

    const versionedNodeWithPathArgv = buildParseArgv({
      programName: "text2llm",
      rawArgs: ["/usr/bin/node-22.2.0", "text2llm", "status"],
    });
    expect(versionedNodeWithPathArgv).toEqual(["/usr/bin/node-22.2.0", "text2llm", "status"]);

    const nodejsArgv = buildParseArgv({
      programName: "text2llm",
      rawArgs: ["nodejs", "text2llm", "status"],
    });
    expect(nodejsArgv).toEqual(["nodejs", "text2llm", "status"]);

    const nonVersionedNodeArgv = buildParseArgv({
      programName: "text2llm",
      rawArgs: ["node-dev", "text2llm", "status"],
    });
    expect(nonVersionedNodeArgv).toEqual(["node", "text2llm", "node-dev", "text2llm", "status"]);

    const directArgv = buildParseArgv({
      programName: "text2llm",
      rawArgs: ["text2llm", "status"],
    });
    expect(directArgv).toEqual(["node", "text2llm", "status"]);

    const bunArgv = buildParseArgv({
      programName: "text2llm",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "text2llm",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "text2llm", "status"]);
  });

  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "text2llm", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "text2llm", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "text2llm", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "text2llm", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "text2llm", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "text2llm", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "text2llm", "message", "send"])).toBe(true);
  });

  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});
