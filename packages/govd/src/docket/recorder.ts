/**
 * Procedural Docket Recorder
 *
 * Every state change in the governance runtime must be recorded as a docket event.
 * The docket answers: "Why is this work happening?"
 */

import type {
  DocketEvent,
  DocketEventType,
  CaseId,
  TicketId,
  EvidenceId,
  DocketDecision,
} from "../state/types.js";
import { newDocketEventId, nowISO } from "../state/ids.js";
import { appendDocketEvent } from "../state/writer.js";

export interface RecordDocketEventOptions {
  case_id: CaseId;
  ticket_id?: TicketId;
  event_type: DocketEventType;
  actor: DocketEvent["actor"];
  reason: string;
  evidence?: EvidenceId[];
  status_before?: string;
  status_after?: string;
  decision?: DocketDecision;
  affected_branches?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Record a docket event. This is the single entry point for all procedural history.
 * Returns the created DocketEvent for use in audit trails.
 */
export function recordDocketEvent(
  cwd: string,
  opts: RecordDocketEventOptions
): DocketEvent {
  const event: DocketEvent = {
    event_id: newDocketEventId(),
    case_id: opts.case_id,
    ticket_id: opts.ticket_id,
    event_type: opts.event_type,
    actor: opts.actor,
    reason: opts.reason,
    evidence: opts.evidence ?? [],
    status_before: opts.status_before,
    status_after: opts.status_after,
    decision: opts.decision,
    affected_branches: opts.affected_branches,
    metadata: opts.metadata,
    created_at: nowISO(),
  };

  appendDocketEvent(cwd, event);
  return event;
}

// ---------------------------------------------------------------------------
// Convenience recorders for common event types
// ---------------------------------------------------------------------------

export function recordCaseOpened(
  cwd: string,
  case_id: CaseId,
  reason: string,
  evidence: EvidenceId[] = []
): DocketEvent {
  return recordDocketEvent(cwd, {
    case_id,
    event_type: "case_opened",
    actor: "user",
    reason,
    evidence,
    status_after: "OPEN",
  });
}

export function recordTicketIssued(
  cwd: string,
  case_id: CaseId,
  ticket_id: TicketId,
  reason: string,
  evidence: EvidenceId[] = []
): DocketEvent {
  return recordDocketEvent(cwd, {
    case_id,
    ticket_id,
    event_type: "ticket_issued",
    actor: "system",
    reason,
    evidence,
    status_after: "DRAFT",
  });
}

export function recordTicketReissued(
  cwd: string,
  case_id: CaseId,
  old_ticket_id: TicketId,
  new_ticket_id: TicketId,
  reason: string,
  evidence: EvidenceId[] = [],
  affected_branches: string[] = []
): DocketEvent {
  return recordDocketEvent(cwd, {
    case_id,
    ticket_id: new_ticket_id,
    event_type: "ticket_reissued",
    actor: "user",
    reason,
    evidence,
    status_before: old_ticket_id,
    status_after: new_ticket_id,
    decision: {
      type: "reissue",
      rationale: `Ticket ${old_ticket_id} superseded by ${new_ticket_id}`,
    },
    affected_branches,
  });
}

export function recordExecutionBlocked(
  cwd: string,
  case_id: CaseId,
  ticket_id: TicketId | undefined,
  reason: string,
  applied_rules: string[]
): DocketEvent {
  return recordDocketEvent(cwd, {
    case_id,
    ticket_id,
    event_type: "execution_blocked",
    actor: "hook",
    reason,
    evidence: [],
    metadata: { applied_rules },
  });
}

export function recordSessionStarted(
  cwd: string,
  case_id: CaseId,
  ticket_id?: TicketId
): DocketEvent {
  return recordDocketEvent(cwd, {
    case_id,
    ticket_id,
    event_type: "session_started",
    actor: "system",
    reason: "New agent session started",
  });
}
