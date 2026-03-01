import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../infra/dotenv.js";
import { normalizeEnv } from "../infra/env.js";
import { formatUncaughtError } from "../infra/errors.js";
import { isMainModule } from "../infra/is-main.js";
import { ensureTEXT2LLMCliOnPath } from "../infra/path-env.js";
import { assertSupportedRuntime } from "../infra/runtime-guard.js";
import { installUnhandledRejectionHandler } from "../infra/unhandled-rejections.js";
import { enableConsoleCapture } from "../logging.js";
import { getPrimaryCommand, hasHelpOrVersion } from "./argv.js";
import { tryRouteCli } from "./route.js";

export function rewriteUpdateFlagArgv(argv: string[]): string[] {
  const index = argv.indexOf("--update");
  if (index === -1) {
    return argv;
  }

  const next = [...argv];
  next.splice(index, 1, "update");
  return next;
}

export async function runCli(argv: string[] = process.argv) {
  const normalizedArgv = stripWindowsNodeExec(argv);
  loadDotEnv({ quiet: true });
  normalizeEnv();
  ensureTEXT2LLMCliOnPath();

  // Enforce the minimum supported runtime before doing any work.
  assertSupportedRuntime();

  if (await tryRouteCli(normalizedArgv)) {
    return;
  }

  // Capture all console output into structured logs while keeping stdout/stderr behavior.
  enableConsoleCapture();

  // Compute primary command early so buildProgram only registers the needed command.
  const parseArgv = rewriteUpdateFlagArgv(normalizedArgv);
  const primary = getPrimaryCommand(parseArgv);

  const { buildProgram } = await import("./program.js");
  const program = await buildProgram({ primary: primary || undefined });

  // Global error handlers to prevent silent crashes from unhandled rejections/exceptions.
  // These log the error and exit gracefully instead of crashing without trace.
  installUnhandledRejectionHandler();

  process.on("uncaughtException", (error) => {
    console.error("[text2llm] Uncaught exception:", formatUncaughtError(error));
    process.exit(1);
  });

  // Register the primary subcommand if one exists (for lazy-loading)
  if (primary) {
    const { registerSubCliByName } = await import("./program/register.subclis.js");
    await registerSubCliByName(program, primary);
  }

  let shouldSkipPluginRegistration = !primary && hasHelpOrVersion(parseArgv);

  if (!shouldSkipPluginRegistration && primary) {
    const { commandRegistry, findRoutedCommand } = await import("./program/command-registry.js");
    const { getSubCliEntries } = await import("./program/register.subclis.js");
    const route = findRoutedCommand(parseArgv);
    const isCore =
      commandRegistry.some((c) => c.id === primary || c.routes?.some((r) => r.match([primary]))) ||
      getSubCliEntries().some((e) => e.name === primary);
    if (isCore && !route?.loadPlugins) {
      shouldSkipPluginRegistration = true;
    }
  }

  if (!shouldSkipPluginRegistration) {
    // Register plugin CLI commands before parsing
    const { registerPluginCliCommands } = await import("../plugins/cli.js");
    const { loadConfig } = await import("../config/config.js");
    registerPluginCliCommands(program, loadConfig());
  }

  // Resolve channel options lazily (skip for --help to avoid heavy plugin/catalog loading)
  if (!hasHelpOrVersion(parseArgv)) {
    const { resolveChannelOptionsLazy } = await import("./program/context.js");
    await resolveChannelOptionsLazy();
  }

  await program.parseAsync(parseArgv);
}

function stripWindowsNodeExec(argv: string[]): string[] {
  if (process.platform !== "win32") {
    return argv;
  }
  const stripControlChars = (value: string): string => {
    let out = "";
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code >= 32 && code !== 127) {
        out += value[i];
      }
    }
    return out;
  };
  const normalizeArg = (value: string): string =>
    stripControlChars(value)
      .replace(/^['"]+|['"]+$/g, "")
      .trim();
  const normalizeCandidate = (value: string): string =>
    normalizeArg(value).replace(/^\\\\\\?\\/, "");
  const execPath = normalizeCandidate(process.execPath);
  const execPathLower = execPath.toLowerCase();
  const execBase = path.basename(execPath).toLowerCase();
  const isExecPath = (value: string | undefined): boolean => {
    if (!value) {
      return false;
    }
    const normalized = normalizeCandidate(value);
    if (!normalized) {
      return false;
    }
    const lower = normalized.toLowerCase();
    return (
      lower === execPathLower ||
      path.basename(lower) === execBase ||
      lower.endsWith("\\node.exe") ||
      lower.endsWith("/node.exe") ||
      lower.includes("node.exe") ||
      (path.basename(lower) === "node.exe" && fs.existsSync(normalized))
    );
  };
  const filtered = argv.filter((arg, index) => index === 0 || !isExecPath(arg));
  if (filtered.length < 3) {
    return filtered;
  }
  const cleaned = [...filtered];
  if (isExecPath(cleaned[1])) {
    cleaned.splice(1, 1);
  }
  if (isExecPath(cleaned[2])) {
    cleaned.splice(2, 1);
  }
  return cleaned;
}

export function isCliMainModule(): boolean {
  return isMainModule({ currentFile: fileURLToPath(import.meta.url) });
}
