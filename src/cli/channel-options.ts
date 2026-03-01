import { listChannelPluginCatalogEntries } from "../channels/plugins/catalog.js";
import { CHAT_CHANNEL_ORDER } from "../channels/registry.js";
import { isTruthyEnvValue } from "../infra/env.js";

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    resolved.push(value);
  }
  return resolved;
}

export async function resolveCliChannelOptions(): Promise<string[]> {
  const catalog = listChannelPluginCatalogEntries().map((entry) => entry.id);
  const base = dedupe([...CHAT_CHANNEL_ORDER, ...catalog]);
  if (isTruthyEnvValue(process.env.TEXT2LLM_EAGER_CHANNEL_OPTIONS)) {
    // Dynamic imports to avoid pulling in the massive loader chunk (~2 MB)
    // at import time.  ensurePluginRegistryLoaded and listChannelPlugins are
    // only needed in this rarely-hit branch.
    const [{ ensurePluginRegistryLoaded }, { listChannelPlugins }] = await Promise.all([
      import("./plugin-registry.js"),
      import("../channels/plugins/index.js"),
    ]);
    ensurePluginRegistryLoaded();
    const pluginIds = listChannelPlugins().map((plugin) => plugin.id);
    return dedupe([...base, ...pluginIds]);
  }
  return base;
}

export async function formatCliChannelOptions(extra: string[] = []): Promise<string> {
  return [...extra, ...(await resolveCliChannelOptions())].join("|");
}
