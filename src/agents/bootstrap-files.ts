import type { TEXT2LLMConfig } from "../config/config.js";
import type { EmbeddedContextFile } from "./pi-embedded-helpers.js";
import { applyBootstrapHookOverrides } from "./bootstrap-hooks.js";
import { buildBootstrapContextFiles, resolveBootstrapMaxChars } from "./pi-embedded-helpers.js";
import {
  filterBootstrapFilesForSession,
  loadWorkspaceBootstrapFiles,
  type WorkspaceBootstrapFile,
} from "./workspace.js";

export function makeBootstrapWarn(params: {
  sessionLabel: string;
  warn?: (message: string) => void;
}): ((message: string) => void) | undefined {
  if (!params.warn) {
    return undefined;
  }
  return (message: string) => params.warn?.(`${message} (sessionKey=${params.sessionLabel})`);
}

export async function resolveBootstrapFilesForRun(params: {
  workspaceDir: string;
  config?: TEXT2LLMConfig;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
}): Promise<WorkspaceBootstrapFile[]> {
  const sessionKey = params.sessionKey ?? params.sessionId;
  const bootstrapFiles = filterBootstrapFilesForSession(
    await loadWorkspaceBootstrapFiles(params.workspaceDir),
    sessionKey,
  );
  return applyBootstrapHookOverrides({
    files: bootstrapFiles,
    workspaceDir: params.workspaceDir,
    config: params.config,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    agentId: params.agentId,
  });
}

export async function resolveBootstrapContextForRun(params: {
  workspaceDir: string;
  config?: TEXT2LLMConfig;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  warn?: (message: string) => void;
}): Promise<{
  bootstrapFiles: WorkspaceBootstrapFile[];
  contextFiles: EmbeddedContextFile[];
}> {
  const bootstrapFiles = await resolveBootstrapFilesForRun(params);
  const contextFiles = buildBootstrapContextFiles(bootstrapFiles, {
    maxChars: resolveBootstrapMaxChars(params.config),
    warn: params.warn,
  });

  const storeResources = params.config?.storeResourcesByProject?.["default"] || [];
  if (storeResources.length > 0) {
    const lines = [
      "# Saved Store Resources",
      "The following resources have been added to this workspace from the text2llm store:",
      "",
    ];
    for (const res of storeResources) {
      lines.push(`## ${res.name || res.id}`);
      lines.push(`- **Type:** ${res.type}`);
      lines.push(`- **Source:** ${res.source}`);
      if (res.author) lines.push(`- **Author:** ${res.author}`);
      if (res.url) lines.push(`- **URL:** ${res.url}`);
      if (res.description) lines.push(`- **Description:** ${res.description}`);
      lines.push("");
    }
    contextFiles.push({
      path: "STORE_RESOURCES.md",
      content: lines.join("\n"),
    });
  }

  return { bootstrapFiles, contextFiles };
}
