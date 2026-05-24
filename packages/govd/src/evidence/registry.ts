/**
 * Evidence Registry
 *
 * Handles admission, tier assignment, and persistence of evidence.
 *
 * Evidence Tier Map (from constitution):
 *   Tier 1: user_statement
 *   Tier 2: tool_output, test_result, file_diff, repo_state
 *   Tier 3: policy_document
 *   Tier 4: prior_decision, precedent_reference
 *   Tier 5: simulation_result
 *   Tier 6: model_inference
 */

import type {
  Evidence,
  EvidenceType,
  EvidenceTier,
  EvidenceSource,
  EvidenceClaim,
  CaseId,
  TicketId,
} from "../state/types.js";
import { newEvidenceId, nowISO } from "../state/ids.js";
import { appendEvidence } from "../state/writer.js";

const TIER_MAP: Record<EvidenceType, EvidenceTier> = {
  user_statement: 1,
  tool_output: 2,
  test_result: 2,
  file_diff: 2,
  repo_state: 2,
  policy_document: 3,
  prior_decision: 4,
  precedent_reference: 4,
  simulation_result: 5,
  model_inference: 6,
};

export interface AdmitEvidenceOptions {
  type: EvidenceType;
  source: EvidenceSource;
  claims: EvidenceClaim[];
  scope?: string;
  case_id?: CaseId;
  ticket_id?: TicketId;
}

/**
 * Admit evidence into the registry.
 * Automatically assigns tier and admissibility.
 * Writes to evidence.jsonl.
 */
export function admitEvidence(
  cwd: string,
  opts: AdmitEvidenceOptions
): Evidence {
  const evidence: Evidence = {
    evidence_id: newEvidenceId(),
    type: opts.type,
    tier: TIER_MAP[opts.type],
    source: opts.source,
    claims: opts.claims,
    admissibility: "admissible",
    scope: opts.scope ?? "current_project",
    case_id: opts.case_id,
    ticket_id: opts.ticket_id,
    created_at: nowISO(),
  };

  appendEvidence(cwd, evidence);
  return evidence;
}

/**
 * Admit evidence from a user statement (most common case).
 */
export function admitUserStatement(
  cwd: string,
  opts: {
    quote: string;
    turn_id?: string;
    claims: EvidenceClaim[];
    case_id?: CaseId;
    ticket_id?: TicketId;
  }
): Evidence {
  return admitEvidence(cwd, {
    type: "user_statement",
    source: {
      speaker: "user",
      quote: opts.quote,
      turn_id: opts.turn_id,
    },
    claims: opts.claims,
    case_id: opts.case_id,
    ticket_id: opts.ticket_id,
  });
}

/**
 * Admit a tool output as evidence.
 */
export function admitToolOutput(
  cwd: string,
  opts: {
    tool: string;
    command?: string;
    exit_code?: number;
    output_summary: string;
    case_id?: CaseId;
    ticket_id?: TicketId;
  }
): Evidence {
  return admitEvidence(cwd, {
    type: "tool_output",
    source: {
      tool: opts.tool,
      command: opts.command,
      exit_code: opts.exit_code,
    },
    claims: [
      {
        claim: opts.output_summary,
        confidence: opts.exit_code === 0 ? 1.0 : 0.9,
      },
    ],
    case_id: opts.case_id,
    ticket_id: opts.ticket_id,
  });
}

/**
 * Returns the tier for a given evidence type.
 */
export function evidenceTier(type: EvidenceType): EvidenceTier {
  return TIER_MAP[type];
}
