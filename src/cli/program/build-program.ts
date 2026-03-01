import { Command } from "commander";
import { createProgramContext } from "./context.js";
import { configureProgramHelp } from "./help.js";
import { registerPreActionHooks } from "./preaction.js";

export async function buildProgram(options?: { primary?: string }) {
  const program = new Command();
  const ctx = createProgramContext();
  const argv = process.argv;

  configureProgramHelp(program, ctx);
  registerPreActionHooks(program, ctx.programVersion);

  const { registerProgramCommands } = await import("./command-registry.js");
  registerProgramCommands(program, ctx, argv, { primary: options?.primary });

  return program;
}
