/**
 * PostToolUse Handler
 *
 * Records tool outputs as evidence.
 * Detects conflicts introduced by tool results.
 * Updates audit trail.
 */

import type {
  GovernanceState,
  HookDecision,
  NormalizedHookEvent,
} from "../state/types.js";
import { admitToolOutput } from "../evidence/registry.js";
import { recordDocketEvent } from "../docket/recorder.js";
import { appendAuditEvent } from "../state/writer.js";
import { nowISO } from "../state/ids.js";

export function handlePostToolUse(
  event: NormalizedHookEvent,
  state: GovernanceState
): HookDecision {
  const { active_case, active_ticket } = state;
  const toolName = event.tool_name ?? "unknown_tool";
  const output = event.tool_output ?? {};

  // Derive a summary of the tool output
  const exitCode = typeof output["exit_code"] === "number" ? output["exit_code"] : undefined;
  const outputSummary = deriveOutputSummary(toolName, output, exitCode);

  // Admit as evidence
  const evidence = admitToolOutput(state.cwd, {
    tool: toolName,
    command: String(event.tool_input?.["command"] ?? ""),
    exit_code: exitCode,
    output_summary: outputSummary,
    case_id: active_case?.case_id,
    ticket_id: active_ticket?.ticket_id,
  });

  // Record docket event for significant tool results
  if (active_case && isSignificantResult(toolName, exitCode)) {
    recordDocketEvent(state.cwd, {
      case_id: active_case.case_id,
      ticket_id: active_ticket?.ticket_id,
      event_type: "execution_allowed",
      actor: "hook",
      reason: `Tool ${toolName} executed. ${outputSummary}`,
      evidence: [evidence.evidence_id],
      status_after: exitCode === 0 ? "success" : "failure",
    });
  }

  // Audit
  appendAuditEvent(state.cwd, {
    event: "post_tool_use",
    tool_name: toolName,
    evidence_id: evidence.evidence_id,
    exit_code: exitCode,
    created_at: nowISO(),
  });

  return { decision: "allow" };
}

function deriveOutputSummary(
  toolName: string,
  output: Record<string, unknown>,
  exitCode?: number
): string {
  if (toolName === "Bash" || toolName === "bash") {
    if (exitCode === 0) return "Bash command succeeded.";
    if (exitCode !== undefined && exitCode !== 0)
      return `Bash command failed with exit code ${exitCode}.`;
  }

  if (typeof output["content"] === "string") {
    return output["content"].slice(0, 200);
  }

  if (typeof output["result"] === "string") {
    return output["result"].slice(0, 200);
  }

  return `Tool ${toolName} executed.`;
}

function isSignificantResult(toolName: string, exitCode?: number): boolean {
  const significantTools = new Set(["Bash", "bash", "test", "npm", "git"]);
  if (significantTools.has(toolName)) return true;
  if (exitCode !== undefined && exitCode !== 0) return true;
  return false;
}
