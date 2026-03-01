import { VERSION } from "../../version.js";

export type ProgramContext = {
  programVersion: string;
  channelOptions: string[];
  messageChannelOptions: string;
  agentChannelOptions: string;
};

let _cachedChannelOptions: string[] | null = null;

export async function resolveChannelOptionsLazy(): Promise<string[]> {
  if (!_cachedChannelOptions) {
    const { resolveCliChannelOptions } = await import("../channel-options.js");
    _cachedChannelOptions = await resolveCliChannelOptions();
  }
  return _cachedChannelOptions;
}

function getChannelOptionsSync(): string[] {
  // After async initialization, this returns the cached value
  return _cachedChannelOptions ?? [];
}

export function createProgramContext(): ProgramContext {
  return {
    programVersion: VERSION,
    get channelOptions() {
      return getChannelOptionsSync();
    },
    get messageChannelOptions() {
      return getChannelOptionsSync().join("|");
    },
    get agentChannelOptions() {
      return ["last", ...getChannelOptionsSync()].join("|");
    },
  };
}
