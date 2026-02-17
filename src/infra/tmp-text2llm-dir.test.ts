import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { POSIX_TEXT2LLM_TMP_DIR, resolvePreferredTEXT2LLMTmpDir } from "./tmp-text2llm-dir.js";

describe("resolvePreferredTEXT2LLMTmpDir", () => {
  it("prefers /tmp/text2llm when it already exists and is writable", () => {
    const accessSync = vi.fn();
    const statSync = vi.fn(() => ({ isDirectory: () => true }));
    const tmpdir = vi.fn(() => "/var/fallback");

    const resolved = resolvePreferredTEXT2LLMTmpDir({ accessSync, statSync, tmpdir });

    expect(statSync).toHaveBeenCalledTimes(1);
    expect(accessSync).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(POSIX_TEXT2LLM_TMP_DIR);
    expect(tmpdir).not.toHaveBeenCalled();
  });

  it("prefers /tmp/text2llm when it does not exist but /tmp is writable", () => {
    const accessSync = vi.fn();
    const statSync = vi.fn(() => {
      const err = new Error("missing") as Error & { code?: string };
      err.code = "ENOENT";
      throw err;
    });
    const tmpdir = vi.fn(() => "/var/fallback");

    const resolved = resolvePreferredTEXT2LLMTmpDir({ accessSync, statSync, tmpdir });

    expect(resolved).toBe(POSIX_TEXT2LLM_TMP_DIR);
    expect(accessSync).toHaveBeenCalledWith("/tmp", expect.any(Number));
    expect(tmpdir).not.toHaveBeenCalled();
  });

  it("falls back to os.tmpdir()/text2llm when /tmp/text2llm is not a directory", () => {
    const accessSync = vi.fn();
    const statSync = vi.fn(() => ({ isDirectory: () => false }));
    const tmpdir = vi.fn(() => "/var/fallback");

    const resolved = resolvePreferredTEXT2LLMTmpDir({ accessSync, statSync, tmpdir });

    expect(resolved).toBe(path.join("/var/fallback", "text2llm"));
    expect(tmpdir).toHaveBeenCalledTimes(1);
  });

  it("falls back to os.tmpdir()/text2llm when /tmp is not writable", () => {
    const accessSync = vi.fn((target: string) => {
      if (target === "/tmp") {
        throw new Error("read-only");
      }
    });
    const statSync = vi.fn(() => {
      const err = new Error("missing") as Error & { code?: string };
      err.code = "ENOENT";
      throw err;
    });
    const tmpdir = vi.fn(() => "/var/fallback");

    const resolved = resolvePreferredTEXT2LLMTmpDir({ accessSync, statSync, tmpdir });

    expect(resolved).toBe(path.join("/var/fallback", "text2llm"));
    expect(tmpdir).toHaveBeenCalledTimes(1);
  });
});
