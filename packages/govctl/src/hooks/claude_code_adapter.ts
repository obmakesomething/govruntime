#!/usr/bin/env node
/**
 * Claude Code Hook Adapter
 *
 * Reads JSON from stdin, normalizes it, calls govd handlers, writes response to stdout.
 *
 * Claude Code hook protocol:
 * - Input: JSON on stdin
 * - Output: JSON on stdout
 * - Exit 0: allow (with optional context injection)
 * - Exit 2: block (hard stop — not used in Phase 1 except forbidden scope)
 *
 * Context injection format (for SessionStart / UserPromptSubmit):
 * { "type": "context", "content": "<markdown>" }
 *
 * Block format (for PreToolUse):
 * { "type": "block", "message": "<reason>" }
 */

import {
  loadState,
  handleSessionStart,
  handleUserPrompt,
  handlePreToolUse,
  handlePostToolUse,
  handleStop,
} from "@govruntime/govd";
import { normalizeClaudeCodeEvent } from "./normalize.js";

export async function runClaudeHook(): Promise<void> {
  const rawInput = await readStdin();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawInput) as Record<string, unknown>;
  } catch {
    // Not valid JSON — pass through silently
    process.exit(0);
  }

  const event = normalizeClaudeCodeEvent(parsed);
  const state = loadState(event.cwd);

  switch (event.hook_event_name) {
    case "SessionStart": {
      const result = handleSessionStart(state);
      if (result.context_pack) {
        writeContextInjection(result.context_pack);
      }
      process.exit(0);
      break;
    }

    case "UserPromptSubmit": {
      const result = handleUserPrompt(event, state);
      if (result.context_pack) {
        writeContextInjection(result.context_pack);
      }
      process.exit(0);
      break;
    }

    case "PreToolUse": {
      const result = handlePreToolUse(event, state);

      if (result.decision === "block") {
        // Hard block — exit 2 with message
        writeBlockResponse(
          result.reason ?? "Blocked by governance runtime.",
          result.applied_rules,
          result.recommended_action
        );
        process.exit(2);
      }

      if (result.decision === "warn" || result.decision === "require_human_review") {
        // Advisory — inject context but allow
        const msg = formatAdvisory(result);
        writeContextInjection(msg);
        process.exit(0);
      }

      process.exit(0);
      break;
    }

    case "PostToolUse": {
      handlePostToolUse(event, state);
      process.exit(0);
      break;
    }

    case "Stop": {
      const result = handleStop(event, state);
      if (result.decision === "warn" && result.reason) {
        writeContextInjection(result.reason);
      }
      process.exit(0);
      break;
    }

    default:
      process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function writeContextInjection(content: string): void {
  process.stdout.write(
    JSON.stringify({ type: "context", content }) + "\n"
  );
}

function writeBlockResponse(
  message: string,
  applied_rules?: string[],
  recommended_action?: string
): void {
  const parts = [message];
  if (applied_rules && applied_rules.length > 0) {
    parts.push(`Applied rules: ${applied_rules.join(", ")}`);
  }
  if (recommended_action) {
    parts.push(`Recommended: ${recommended_action}`);
  }
  process.stdout.write(
    JSON.stringify({ type: "block", message: parts.join("\n") }) + "\n"
  );
}

function formatAdvisory(result: {
  decision: string;
  reason?: string;
  applied_rules?: string[];
  missing_evidence?: string[];
  recommended_action?: string;
}): string {
  const lines = ["⚖️ **Governance Advisory**", ""];

  if (result.reason) {
    lines.push(result.reason);
  }

  if (result.applied_rules && result.applied_rules.length > 0) {
    lines.push("");
    lines.push(`**Applied rules:** ${result.applied_rules.join(", ")}`);
  }

  if (result.missing_evidence && result.missing_evidence.length > 0) {
    lines.push(`**Missing evidence:** ${result.missing_evidence.join(", ")}`);
  }

  if (result.recommended_action) {
    lines.push(`**Recommended action:** ${result.recommended_action}`);
  }

  return lines.join("\n");
}

// Run directly if invoked as a script
const isMain = process.argv[1] && (
  process.argv[1].endsWith("claude_code_adapter.js") || 
  process.argv[1].endsWith("claude_code_adapter.ts")
);
if (isMain) {
  runClaudeHook().catch((err: unknown) => {
    console.error("govruntime hook error:", err);
    process.exit(0);
  });
}
