/**
 * PreToolUse Handler
 *
 * Judges every tool call before execution.
 * Checks: scope, policy, destructive actions, missing governance context.
 * Phase 1: warn mode (never hard-blocks except forbidden scope).
 * Phase 3+: full block capability.
 */

import type {
  GovernanceState,
  HookDecision,
  NormalizedHookEvent,
} from "../state/types.js";
import { judgeToolCall } from "../judgment/engine.js";
import { recordExecutionBlocked, recordDocketEvent } from "../docket/recorder.js";
import { appendToolCallLog } from "../state/writer.js";
import { nowISO } from "../state/ids.js";

export function handlePreToolUse(
  event: NormalizedHookEvent,
  state: GovernanceState
): HookDecision {
  const judgment = judgeToolCall(event, state);

  // Log the tool call attempt
  appendToolCallLog(state.cwd, {
    event: "pre_tool_use",
    tool_name: event.tool_name,
    tool_input: event.tool_input,
    judgment_id: judgment.judgment_id,
    decision: judgment.decision,
    reason: judgment.reason,
    created_at: nowISO(),
  });

  // Record docket events for blocks
  if (judgment.decision === "block" || judgment.decision === "warn") {
    if (state.active_case) {
      recordExecutionBlocked(
        state.cwd,
        state.active_case.case_id,
        state.active_ticket?.ticket_id,
        judgment.reason,
        judgment.applied_authority
      );
    }
  }

  return {
    decision: judgment.decision,
    reason: judgment.reason,
    applied_rules: judgment.applied_authority,
    evidence_used: judgment.evidence_used,
    missing_evidence: judgment.missing_evidence,
    recommended_action: judgment.recommended_action,
  };
}
