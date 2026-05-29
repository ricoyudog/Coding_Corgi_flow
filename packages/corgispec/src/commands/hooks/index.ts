import { Command } from "commander";
import { createHookSessionStartCommand } from "./session-start.js";
import { createHookPostCompactCommand } from "./post-compact.js";
import { createHookPreWriteCommand } from "./pre-write.js";
import { createHookPreBashCommand } from "./pre-bash.js";
import { createHookPostWriteCommand } from "./post-write.js";
import { createHookStopCheckCommand } from "./stop-check.js";

export function createHookCommand(): Command {
  const cmd = new Command("hook");

  cmd.description("Hook CLI subcommands for AI platform integration");

  cmd.addCommand(createHookSessionStartCommand());
  cmd.addCommand(createHookPostCompactCommand());
  cmd.addCommand(createHookPreWriteCommand());
  cmd.addCommand(createHookPreBashCommand());
  cmd.addCommand(createHookPostWriteCommand());
  cmd.addCommand(createHookStopCheckCommand());

  return cmd;
}
