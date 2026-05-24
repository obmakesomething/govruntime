/**
 * govctl hook — CLI subcommands to invoke agent hooks
 */

import type { Command } from "commander";
import { runClaudeHook } from "../hooks/claude_code_adapter.js";
import { runCodexHook } from "../hooks/codex_adapter.js";

export function registerHook(program: Command): void {
  const hookCmd = program
    .command("hook")
    .description("Invoke agent-specific hooks");

  hookCmd
    .command("claude")
    .description("Invoke Claude Code lifecycle hook handler")
    .action(async () => {
      await runClaudeHook();
    });

  hookCmd
    .command("codex")
    .description("Invoke Codex lifecycle hook handler")
    .action(async () => {
      await runCodexHook();
    });
}
