/**
 * govctl hook - CLI subcommands to invoke agent hooks.
 */

import type { Command } from "commander";
import type { HookDecision, HookPlatform } from "@govruntime/govd";
import { runClaudeHook } from "../hooks/claude_code_adapter.js";
import { runCodexHook } from "../hooks/codex_adapter.js";
import { normalizeEvent } from "../hooks/normalize.js";
import {
  loadState,
  handleSessionStart,
  handleUserPrompt,
  handlePreToolUse,
  handlePostToolUse,
  handleStop,
} from "@govruntime/govd";

export function registerHook(program: Command): void {
  const hookCmd = program
    .command("hook")
    .description("Invoke agent-specific lifecycle hooks");

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

  hookCmd
    .command("auto [platform]")
    .description("Auto-detect hook payload and route to the shared governance runtime")
    .action(async (platform?: string) => {
      await runAutoHook(normalizePlatform(platform));
    });
}

async function runAutoHook(platform?: HookPlatform): Promise<void> {
  const rawInput = await readStdin();
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawInput) as unknown;
  } catch {
    process.exit(0);
  }

  const event = normalizeEvent(parsed, platform);
  const state = loadState(event.cwd);

  switch (event.hook_event_name) {
    case "SessionStart": {
      const result = handleSessionStart(state);
      writeAllow(event.platform, result.context_pack);
      process.exit(0);
    }
    case "UserPromptSubmit": {
      const result = handleUserPrompt(event, state);
      writeAllow(event.platform, result.context_pack);
      process.exit(0);
    }
    case "PreToolUse": {
      const result = handlePreToolUse(event, state);
      if (result.decision === "block") {
        writeBlock(event.platform, result.reason ?? "Blocked by governance runtime.");
        process.exit(event.platform === "codex" ? 1 : 2);
      }
      if (result.decision === "warn" || result.decision === "require_human_review") {
        writeAllow(event.platform, formatAdvisory(result));
      }
      process.exit(0);
    }
    case "PostToolUse": {
      handlePostToolUse(event, state);
      process.exit(0);
    }
    case "Stop": {
      const result = handleStop(event, state);
      if (result.decision === "block") {
        writeBlock(event.platform, result.reason ?? "Blocked by governance runtime.");
        process.exit(event.platform === "codex" ? 1 : 2);
      }
      if (result.decision === "warn" && result.reason) {
        writeAllow(event.platform, result.reason);
      }
      process.exit(0);
    }
    default:
      process.exit(0);
  }
}

function normalizePlatform(platform?: string): HookPlatform | undefined {
  if (platform === "claude" || platform === "claude_code") return "claude_code";
  if (platform === "codex") return "codex";
  if (platform === "generic") return "generic";
  return undefined;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function writeAllow(platform: HookPlatform, content?: string): void {
  if (!content) return;

  if (platform === "codex") {
    process.stdout.write(JSON.stringify({ system: content }) + "\n");
    return;
  }

  process.stdout.write(JSON.stringify({ type: "context", content }) + "\n");
}

function writeBlock(platform: HookPlatform, message: string): void {
  if (platform === "codex") {
    process.stdout.write(JSON.stringify({ error: message }) + "\n");
    return;
  }

  process.stdout.write(JSON.stringify({ type: "block", message }) + "\n");
}

function formatAdvisory(result: Pick<HookDecision, "reason" | "applied_rules" | "missing_evidence" | "recommended_action">): string {
  const lines = ["**Governance Advisory**", ""];

  if (result.reason) lines.push(result.reason);
  if (result.applied_rules?.length) {
    lines.push("");
    lines.push(`Applied rules: ${result.applied_rules.join(", ")}`);
  }
  if (result.missing_evidence?.length) {
    lines.push(`Missing evidence: ${result.missing_evidence.join(", ")}`);
  }
  if (result.recommended_action) {
    lines.push(`Recommended action: ${result.recommended_action}`);
  }

  return lines.join("\n");
}
