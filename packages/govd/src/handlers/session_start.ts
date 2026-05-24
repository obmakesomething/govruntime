/**
 * SessionStart Handler
 *
 * On session start:
 * 1. Load governance state
 * 2. Record session start in docket
 * 3. Render and return procedural context pack
 */

import type { GovernanceState, HookDecision } from "../state/types.js";
import { renderContextPack, syncAgentRules } from "../context/pack_renderer.js";
import { recordSessionStarted } from "../docket/recorder.js";
import { appendAuditEvent } from "../state/writer.js";
import { nowISO } from "../state/ids.js";

export function handleSessionStart(state: GovernanceState): HookDecision {
  // Record in docket
  if (state.active_case) {
    recordSessionStarted(
      state.cwd,
      state.active_case.case_id,
      state.active_ticket?.ticket_id
    );
  }

  // Audit
  appendAuditEvent(state.cwd, {
    event: "session_started",
    case_id: state.active_case?.case_id,
    ticket_id: state.active_ticket?.ticket_id,
    branch: state.active_branch?.branch,
    created_at: nowISO(),
  });

  // Sync files
  try {
    syncAgentRules(state);
  } catch (err) {
    console.error("Failed to sync agent rules during session start:", err);
  }

  const contextPack = renderContextPack(state);

  return {
    decision: "allow",
    context_pack: contextPack,
  };
}
