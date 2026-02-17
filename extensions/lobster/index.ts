import type {
  AnyAgentTool,
  Text2llmPluginApi,
  Text2llmPluginToolFactory,
} from "../../src/plugins/types.js";
import { createLobsterTool } from "./src/lobster-tool.js";

export default function register(api: Text2llmPluginApi) {
  api.registerTool(
    ((ctx) => {
      if (ctx.sandboxed) {
        return null;
      }
      return createLobsterTool(api) as AnyAgentTool;
    }) as Text2llmPluginToolFactory,
    { optional: true },
  );
}
