/**
 * UserPromptSubmit Handler
 *
 * On every user prompt:
 * 1. Analyze intent delta
 * 2. Admit evidence (user statement)
 * 3. Detect conflicts (structural)
 * 4. Apply ticket actions (reissue, pause, resume)
 * 5. Record docket events
 * 6. Render updated context pack
 */

import type {
  GovernanceState,
  HookDecision,
  NormalizedHookEvent,
} from "../state/types.js";
import { analyzePrompt } from "../intent/analyzer.js";
import { admitUserStatement } from "../evidence/registry.js";
import { recordDocketEvent } from "../docket/recorder.js";
import { reissueTicket, pauseTicket, resumeTicket } from "../ticket/engine.js";
import { renderContextPack, syncAgentRules } from "../context/pack_renderer.js";
import { appendAuditEvent } from "../state/writer.js";
import { nowISO } from "../state/ids.js";
import { loadState } from "../state/loader.js";

export function handleUserPrompt(
  event: NormalizedHookEvent,
  state: GovernanceState
): HookDecision {
  const prompt = event.prompt ?? "";
  if (prompt.trim().length === 0) {
    return { decision: "allow", context_pack: renderContextPack(state) };
  }

  const { active_case, active_ticket } = state;

  // 1. Analyze intent
  const analysis = analyzePrompt(prompt, active_case, active_ticket);

  // 2. Admit user statement as evidence
  const evidence = admitUserStatement(state.cwd, {
    quote: prompt.slice(0, 500),
    claims: analysis.new_facts.map((f) => ({
      claim: f.fact,
      confidence: f.confidence,
    })),
    case_id: active_case?.case_id,
    ticket_id: active_ticket?.ticket_id,
  });

  const evidenceIds = [evidence.evidence_id];
  const docketEventIds: string[] = [];

  // 3. Apply ticket actions
  // (Re-load state after potential ticket writes)
  let currentState = state;

  for (const action of analysis.ticket_actions) {
    const currentTicket = currentState.active_ticket;
    if (!currentTicket) break;

    if (action.action === "reissue") {
      const newTicket = reissueTicket(state.cwd, currentTicket, {
        reason: action.reason,
      });

      const docketEvent = recordDocketEvent(state.cwd, {
        case_id: active_case?.case_id ?? "NO_ACTIVE_CASE",
        ticket_id: newTicket.ticket_id,
        event_type: "ticket_reissued",
        actor: "user",
        reason: action.reason,
        evidence: evidenceIds,
        status_before: currentTicket.ticket_id,
        status_after: newTicket.ticket_id,
      });
      docketEventIds.push(docketEvent.event_id);

      // Reload state to pick up new ticket
      currentState = loadState(state.cwd);
    }

    if (action.action === "pause") {
      pauseTicket(state.cwd, currentTicket, action.reason);
      const de = recordDocketEvent(state.cwd, {
        case_id: active_case?.case_id ?? "NO_ACTIVE_CASE",
        ticket_id: currentTicket.ticket_id,
        event_type: "ticket_paused",
        actor: "user",
        reason: action.reason,
        evidence: evidenceIds,
      });
      docketEventIds.push(de.event_id);
      currentState = loadState(state.cwd);
    }

    if (action.action === "resume") {
      resumeTicket(state.cwd, currentTicket);
      const de = recordDocketEvent(state.cwd, {
        case_id: active_case?.case_id ?? "NO_ACTIVE_CASE",
        ticket_id: currentTicket.ticket_id,
        event_type: "ticket_resumed",
        actor: "user",
        reason: action.reason,
        evidence: evidenceIds,
      });
      docketEventIds.push(de.event_id);
      currentState = loadState(state.cwd);
    }
  }

  // 4. Record remaining docket events
  for (const de of analysis.docket_events) {
    if (active_case) {
      const recorded = recordDocketEvent(state.cwd, {
        case_id: active_case.case_id,
        ticket_id: currentState.active_ticket?.ticket_id,
        event_type: de.event_type,
        actor: "user",
        reason: de.reason,
        evidence: evidenceIds,
      });
      docketEventIds.push(recorded.event_id);
    }
  }

  // 5. Audit
  appendAuditEvent(state.cwd, {
    event: "user_prompt_analyzed",
    intent_delta: analysis.intent_delta,
    evidence_admitted: evidenceIds,
    docket_events_created: docketEventIds,
    ticket_actions: analysis.ticket_actions,
    created_at: nowISO(),
  });

  // 6. Render updated context pack
  const finalState = loadState(state.cwd);

  // Sync files
  try {
    syncAgentRules(finalState);
  } catch (err) {
    console.error("Failed to sync agent rules during user prompt:", err);
  }

  const contextPack = renderContextPack(finalState);

  return {
    decision: "allow",
    context_pack: contextPack,
    docket_events_created: docketEventIds,
  };
}
