/**
 * Stop Handler
 *
 * Before the agent stops, verify:
 * 1. Active ticket has acceptance criteria
 * 2. Docket was updated
 * 3. No unresolved high-risk conflicts
 *
 * Phase 1: advisory (never hard-blocks stop)
 * Phase 3+: can emit continuation prompt
 */

import type {
  GovernanceState,
  HookDecision,
  NormalizedHookEvent,
} from "../state/types.js";
import { judgeCompletion } from "../judgment/engine.js";
import { recordDocketEvent } from "../docket/recorder.js";
import { readJsonlFile, govPath } from "../state/loader.js";
import type { DocketEvent } from "../state/types.js";
import { appendAuditEvent } from "../state/writer.js";
import { nowISO } from "../state/ids.js";

export function handleStop(
  event: NormalizedHookEvent,
  state: GovernanceState
): HookDecision {
  const { active_case, active_ticket } = state;

  const judgment = judgeCompletion(state);
  const issues: string[] = [];

  // Check 1: acceptance criteria defined
  if (!active_ticket) {
    issues.push("No active ticket — cannot verify completion.");
  } else if (active_ticket.acceptance_criteria.length === 0) {
    issues.push(
      `Ticket ${active_ticket.ticket_id} has no acceptance criteria. Cannot confirm completion.`
    );
  }

  // Check 2: docket has been updated this session
  if (active_case) {
    const docketPath = govPath(state.cwd, "docket", "docket_events.jsonl");
    const events = readJsonlFile<DocketEvent>(docketPath);
    const sessionEvents = events.filter(
      (e) =>
        e.case_id === active_case.case_id &&
        e.event_type !== "session_started"
    );
    if (sessionEvents.length === 0) {
      issues.push("Docket has not been updated. Record procedural events before stopping.");
    }
  }

  // Check 3: branch ledger entry exists for active ticket
  if (active_ticket && !state.active_branch) {
    issues.push(
      `No branch ledger entry for ticket ${active_ticket.ticket_id}. Run \`govctl branch create\`.`
    );
  }

  // Record docket event
  if (active_case) {
    recordDocketEvent(state.cwd, {
      case_id: active_case.case_id,
      ticket_id: active_ticket?.ticket_id,
      event_type: issues.length === 0 ? "execution_allowed" : "execution_blocked",
      actor: "hook",
      reason:
        issues.length === 0
          ? "Stop evaluation passed."
          : `Stop evaluation found ${issues.length} issue(s): ${issues[0]}`,
      evidence: [],
    });
  }

  appendAuditEvent(state.cwd, {
    event: "stop_evaluated",
    issues,
    judgment_id: judgment.judgment_id,
    decision: issues.length === 0 ? "allow" : "warn",
    created_at: nowISO(),
  });

  if (issues.length === 0) {
    return {
      decision: "allow",
      reason: "Stop evaluation passed. All governance checks satisfied.",
    };
  }

  // Phase 1: advisory warning (not hard block)
  return {
    decision: "warn",
    reason: `⚖️ Governance Stop Check — ${issues.length} advisory issue(s):\n${issues.map((i, n) => `  ${n + 1}. ${i}`).join("\n")}\n\nReview and address before marking complete.`,
  };
}
