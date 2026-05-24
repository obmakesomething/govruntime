/**
 * Ticket Engine
 *
 * Issue, reissue, pause, and resume tickets.
 * Enforces immutable revision pattern (T-XXX-001-R1 → R2 → R3).
 */

import type {
  Ticket,
  TicketId,
  CaseId,
  TicketStatus,
  WorkstreamStatus,
  RiskProfile,
  AssignedAgent,
  VerificationPlan,
} from "../state/types.js";
import { nowISO } from "../state/ids.js";
import { writeTicket } from "../state/writer.js";

export interface IssueTicketOptions {
  area: string;        // e.g. "ARCH", "PROC", "HOOK"
  seq: number;         // e.g. 1, 2, 3
  case_id: CaseId;
  title: string;
  objective: string;
  acceptance_criteria: string[];
  non_goals?: string[];
  dependencies?: string[];
  assigned_agent?: Partial<AssignedAgent>;
  risk_profile?: Partial<RiskProfile>;
  verification_plan?: VerificationPlan;
}

function defaultRiskProfile(): RiskProfile {
  return {
    ambiguity: 0.30,
    scope_drift: 0.25,
    implementation_complexity: 0.50,
    verification_strength: 0.60,
    blast_radius: "low",
  };
}

function defaultAssignedAgent(): AssignedAgent {
  return {
    primary: "agent",
    human_review_required: false,
  };
}

export function issueTicket(cwd: string, opts: IssueTicketOptions): Ticket {
  const ticketId: TicketId =
    `T-${opts.area.toUpperCase()}-${String(opts.seq).padStart(3, "0")}-R1`;

  const ticket: Ticket = {
    ticket_id: ticketId,
    revision: 1,
    case_id: opts.case_id,
    status: "DRAFT" as TicketStatus,
    workstream_status: "ACTIVE" as WorkstreamStatus,
    title: opts.title,
    objective: opts.objective,
    acceptance_criteria: opts.acceptance_criteria,
    non_goals: opts.non_goals ?? [],
    dependencies: opts.dependencies ?? [],
    assigned_agent: { ...defaultAssignedAgent(), ...opts.assigned_agent },
    risk_profile: { ...defaultRiskProfile(), ...opts.risk_profile },
    verification_plan: opts.verification_plan ?? { steps: [] },
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  writeTicket(cwd, ticket);
  return ticket;
}

export function reissueTicket(
  cwd: string,
  oldTicket: Ticket,
  opts: {
    reason: string;
    patch?: Partial<
      Pick<
        Ticket,
        | "title"
        | "objective"
        | "acceptance_criteria"
        | "non_goals"
        | "dependencies"
        | "risk_profile"
        | "verification_plan"
      >
    >;
  }
): Ticket {
  // Parse current revision number
  const parts = oldTicket.ticket_id.split("-");
  const revStr = parts[parts.length - 1] ?? "R1";
  const currentRev = parseInt(revStr.replace("R", ""), 10);
  const newRev = currentRev + 1;

  // Build new ticket ID
  const baseParts = parts.slice(0, -1).join("-");
  const newTicketId: TicketId = `${baseParts}-R${newRev}`;

  // Supersede old ticket
  const updatedOld: Ticket = {
    ...oldTicket,
    status: "SUPERSEDED",
    workstream_status: "SUPERSEDED",
    updated_at: nowISO(),
  };
  writeTicket(cwd, updatedOld);

  // Create new revision
  const newTicket: Ticket = {
    ...oldTicket,
    ...(opts.patch ?? {}),
    ticket_id: newTicketId,
    revision: newRev,
    status: "DRAFT",
    workstream_status: "ACTIVE",
    reason_for_reissue: opts.reason,
    supersedes: oldTicket.ticket_id,
    updated_at: nowISO(),
    created_at: nowISO(),
  };
  // Clear closed_at for the new revision
  delete (newTicket as Partial<Ticket>).closed_at;
  writeTicket(cwd, newTicket);
  return newTicket;
}

export function pauseTicket(
  cwd: string,
  ticket: Ticket,
  reason: string
): Ticket {
  const updated: Ticket = {
    ...ticket,
    status: "PAUSED",
    workstream_status: "PAUSED",
    reason_for_reissue: reason,
    updated_at: nowISO(),
  };
  writeTicket(cwd, updated);
  return updated;
}

export function resumeTicket(cwd: string, ticket: Ticket): Ticket {
  const updated: Ticket = {
    ...ticket,
    status: "IN_PROGRESS",
    workstream_status: "ACTIVE",
    updated_at: nowISO(),
  };
  writeTicket(cwd, updated);
  return updated;
}

export function updateTicketStatus(
  cwd: string,
  ticket: Ticket,
  status: TicketStatus,
  workstream_status?: WorkstreamStatus
): Ticket {
  const now = nowISO();
  const updated: Ticket = {
    ...ticket,
    status,
    workstream_status: workstream_status ?? ticket.workstream_status,
    updated_at: now,
  };
  if (status === "DONE" || status === "CANCELLED") {
    updated.closed_at = now;
  }
  writeTicket(cwd, updated);
  return updated;
}
