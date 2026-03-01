import type { Command } from "commander";
import type { ProgramContext } from "./context.js";
import { defaultRuntime } from "../../runtime.js";
import { getFlagValue, getPositiveIntFlagValue, getVerboseFlag, hasFlag } from "../argv.js";


import { registerSubCliCommands } from "./register.subclis.js";

type CommandRegisterParams = {
  program: Command;
  ctx: ProgramContext;
  argv: string[];
};

type RouteSpec = {
  match: (path: string[]) => boolean;
  loadPlugins?: boolean;
  run: (argv: string[]) => Promise<boolean>;
};

export type CommandRegistration = {
  id: string;
  register: (params: CommandRegisterParams) => void;
  routes?: RouteSpec[];
};

const routeHealth: RouteSpec = {
  match: (path) => path[0] === "health",
  loadPlugins: true,
  run: async (argv) => {
    const json = hasFlag(argv, "--json");
    const verbose = getVerboseFlag(argv, { includeDebug: true });
    const timeoutMs = getPositiveIntFlagValue(argv, "--timeout");
    if (timeoutMs === null) {
      return false;
    }
    const { healthCommand } = await import("../../commands/health.js");
    await healthCommand({ json, timeoutMs, verbose }, defaultRuntime);
    return true;
  },
};

const routeStatus: RouteSpec = {
  match: (path) => path[0] === "status",
  loadPlugins: true,
  run: async (argv) => {
    const json = hasFlag(argv, "--json");
    const deep = hasFlag(argv, "--deep");
    const all = hasFlag(argv, "--all");
    const usage = hasFlag(argv, "--usage");
    const verbose = getVerboseFlag(argv, { includeDebug: true });
    const timeoutMs = getPositiveIntFlagValue(argv, "--timeout");
    if (timeoutMs === null) {
      return false;
    }
    const { statusCommand } = await import("../../commands/status.js");
    await statusCommand({ json, deep, all, usage, timeoutMs, verbose }, defaultRuntime);
    return true;
  },
};

const routeSessions: RouteSpec = {
  match: (path) => path[0] === "sessions",
  run: async (argv) => {
    const json = hasFlag(argv, "--json");
    const store = getFlagValue(argv, "--store");
    if (store === null) {
      return false;
    }
    const active = getFlagValue(argv, "--active");
    if (active === null) {
      return false;
    }
    const { sessionsCommand } = await import("../../commands/sessions.js");
    await sessionsCommand({ json, store, active }, defaultRuntime);
    return true;
  },
};

const routeAgentsList: RouteSpec = {
  match: (path) => path[0] === "agents" && path[1] === "list",
  run: async (argv) => {
    const json = hasFlag(argv, "--json");
    const bindings = hasFlag(argv, "--bindings");
    const { agentsListCommand } = await import("../../commands/agents.js");
    await agentsListCommand({ json, bindings }, defaultRuntime);
    return true;
  },
};

const routeMemoryStatus: RouteSpec = {
  match: (path) => path[0] === "memory" && path[1] === "status",
  run: async (argv) => {
    const agent = getFlagValue(argv, "--agent");
    if (agent === null) {
      return false;
    }
    const json = hasFlag(argv, "--json");
    const deep = hasFlag(argv, "--deep");
    const index = hasFlag(argv, "--index");
    const verbose = hasFlag(argv, "--verbose");
    const { runMemoryStatus } = await import("../memory-cli.js");
    await runMemoryStatus({ agent, json, deep, index, verbose });
    return true;
  },
};

export const commandRegistry: CommandRegistration[] = [
  {
    id: "setup",
    register: ({ program }) => import("./register.setup.js").then(m => m.registerSetupCommand(program)),
  },
  {
    id: "onboard",
    register: ({ program }) => import("./register.onboard.js").then(m => m.registerOnboardCommand(program)),
  },
  {
    id: "configure",
    register: ({ program }) => import("./register.configure.js").then(m => m.registerConfigureCommand(program)),
  },
  {
    id: "config",
    register: ({ program }) => import("../config-cli.js").then(m => Promise.resolve(import("../../config/config.js")).then(cfg => m.registerConfigCli(program, cfg.loadConfig()))),
  },
  {
    id: "maintenance",
    register: ({ program }) => import("./register.maintenance.js").then(m => m.registerMaintenanceCommands(program)),
  },
  {
    id: "message",
    register: ({ program, ctx }) =>
      import("./register.message.js").then((m) => m.registerMessageCommands(program, ctx)),
  },
  {
    id: "memory",
    register: ({ program }) => import("../memory-cli.js").then(m => m.registerMemoryCli(program)),
    routes: [routeMemoryStatus],
  },
  {
    id: "agent",
    register: ({ program, ctx }) =>
      import("./register.agent.js").then(m => m.registerAgentCommands(program, { agentChannelOptions: ctx.agentChannelOptions })),
    routes: [routeAgentsList],
  },
  {
    id: "subclis",
    register: ({ program, argv }) => registerSubCliCommands(program, argv),
  },
  {
    id: "status-health-sessions",
    register: ({ program }) => import("./register.status-health-sessions.js").then(m => m.registerStatusHealthSessionsCommands(program)),
    routes: [routeHealth, routeStatus, routeSessions],
  },
  {
    id: "browser",
    register: ({ program }) => import("../browser-cli.js").then(m => m.registerBrowserCli(program)),
  },
];

export function registerProgramCommands(
  program: Command,
  ctx: ProgramContext,
  argv: string[] = process.argv,
  options?: { primary?: string },
) {
  for (const entry of commandRegistry) {
    if (options?.primary) {
      // Only register the matching command + subclis (for sub-CLI framework)
      if (entry.id !== options.primary && entry.id !== "subclis") {
        continue;
      }
    }
    entry.register({ program, ctx, argv });
  }
}

export function findRoutedCommand(path: string[]): RouteSpec | null {
  for (const entry of commandRegistry) {
    if (!entry.routes) {
      continue;
    }
    for (const route of entry.routes) {
      if (route.match(path)) {
        return route;
      }
    }
  }
  return null;
}
