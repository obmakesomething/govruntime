/**
 * Judgment Engine
 *
 * GovRuntime is the policy enforcement point. The judgment flow normalizes
 * hook events into PolicyInput, evaluates the configured policy engine, and
 * converts the result into the existing Judgment shape used by hooks.
 */

import type {
  Judgment,
  JudgmentDecision,
  JudgmentOrder,
  GovernanceState,
  NormalizedHookEvent,
  EvidenceId,
} from "../state/types.js";
import { newJudgmentId, nowISO } from "../state/ids.js";
import { appendJudgmentLog } from "../state/writer.js";
import { validateHookPathLiterals } from "../validation/path_literals.js";
import { evaluatePolicyForEvent } from "../policy/engine.js";
import type { PolicyDecision } from "../policy/types.js";

export function judgeToolCall(event: NormalizedHookEvent, state: GovernanceState): Judgment {
  const { active_case, active_ticket } = state;
  const { decision: policyDecision, config } = evaluatePolicyForEvent(event, state);

  const appliedAuthority = collectAppliedAuthority(policyDecision);
  const evidenceUsed: EvidenceId[] = [];
  const missingEvidence: string[] = [];
  const orders: JudgmentOrder[] = [];
  let decision = mapPolicyDecision(policyDecision, config.mode);
  let reason = formatPolicyReason(policyDecision);
  let confidence = policyDecision.decision === "allow" ? 0.95 : 0.90;

  if (policyDecision.decision === "require_human_review") {
    missingEvidence.push("human_approval");
    orders.push({ type: "require_human_review" });
  }
  if (policyDecision.decision === "block") orders.push({ type: "block", reason });
  if (policyDecision.decision === "warn") orders.push({ type: "continue", reason: "Policy warning emitted in advisory path." });

  const pathFindings = validateHookPathLiterals(event, state);
  const blockingPathFindings = pathFindings.filter((finding) => finding.severity === "error");
  const warningPathFindings = pathFindings.filter((finding) => finding.severity === "warn");
  if (blockingPathFindings.length > 0) {
    decision = "block";
    reason = `Invalid path literal: ${blockingPathFindings[0]?.literal}. ${blockingPathFindings[0]?.reason}`;
    appliedAuthority.push("statute.PATH-001.document_literal_path_validation");
    confidence = 0.97;
  } else if (warningPathFindings.length > 0 && decision === "allow") {
    decision = state.runtime_config.enforcement_mode === "hard-block" ? "block" : "warn";
    reason = `Path literal needs verification: ${warningPathFindings[0]?.literal}. ${warningPathFindings[0]?.reason}`;
    appliedAuthority.push("statute.PATH-001.document_literal_path_validation");
    missingEvidence.push("path_literal_resolution");
    orders.push({ type: "verify_path_literal", path: warningPathFindings[0]?.literal });
    confidence = 0.88;
  }

  const judgment: Judgment = {
    judgment_id: newJudgmentId(state.cwd),
    case_id: active_case?.case_id ?? "NO_ACTIVE_CASE",
    ticket_id: active_ticket?.ticket_id,
    decision,
    reason,
    applied_authority: appliedAuthority.length > 0 ? appliedAuthority : ["policy.allow"],
    evidence_used: evidenceUsed,
    missing_evidence: missingEvidence.length > 0 ? missingEvidence : undefined,
    standard_of_proof: "clear_and_convincing",
    confidence,
    orders,
    recommended_action: deriveRecommendedAction(policyDecision, missingEvidence),
    created_at: nowISO(),
  };

  appendJudgmentLog(state.cwd, judgment);
  return judgment;
}

export function judgeCompletion(state: GovernanceState): Judgment {
  const { active_ticket } = state;
  const orders: JudgmentOrder[] = [];
  const missing: string[] = [];

  if (!active_ticket) return makeQuickJudgment(state, "warn", "No active ticket to evaluate for completion.", []);

  if (active_ticket.acceptance_criteria.length === 0) {
    missing.push("acceptance_criteria");
    orders.push({ type: "continue", reason: "Ticket has no acceptance criteria defined." });
  }

  const decision: JudgmentDecision = missing.length > 0 ? "warn" : "allow";
  const reason = missing.length > 0
    ? `Completion check incomplete. Missing: ${missing.join(", ")}.`
    : `Ticket ${active_ticket.ticket_id} appears structurally complete. Verify acceptance criteria manually.`;

  return makeQuickJudgment(state, decision, reason, orders);
}

function makeQuickJudgment(state: GovernanceState, decision: JudgmentDecision, reason: string, orders: JudgmentOrder[]): Judgment {
  const j: Judgment = {
    judgment_id: newJudgmentId(state.cwd),
    case_id: state.active_case?.case_id ?? "NO_ACTIVE_CASE",
    ticket_id: state.active_ticket?.ticket_id,
    decision,
    reason,
    applied_authority: ["constitution"],
    evidence_used: [],
    standard_of_proof: "plausible_basis",
    confidence: 0.80,
    orders,
    created_at: nowISO(),
  };
  appendJudgmentLog(state.cwd, j);
  return j;
}

function mapPolicyDecision(policyDecision: PolicyDecision, mode: "enforce" | "advisory"): JudgmentDecision {
  if (policyDecision.decision === "require_human_review" && mode === "enforce") return "block";
  return policyDecision.decision;
}

function collectAppliedAuthority(policyDecision: PolicyDecision): string[] {
  return [...policyDecision.deny, ...policyDecision.review, ...policyDecision.warn].map((finding) => finding.rule).filter(Boolean);
}

function formatPolicyReason(policyDecision: PolicyDecision): string {
  const findings = [...policyDecision.deny, ...policyDecision.review, ...policyDecision.warn];
  if (policyDecision.decision === "allow") return "Policy evaluation allowed this tool call.";
  const first = findings[0];
  const prefix = policyDecision.decision === "require_human_review"
    ? "Human review required"
    : policyDecision.decision === "block"
      ? "Policy blocked this tool call"
      : "Policy warning";
  return first ? `${prefix}: ${first.reason}` : `${prefix}.`;
}

function deriveRecommendedAction(policyDecision: PolicyDecision, missingEvidence: string[]): string | undefined {
  if (policyDecision.decision === "allow") return undefined;
  if (missingEvidence.length > 0) return `Provide: ${missingEvidence.join(", ")}`;
  const first = [...policyDecision.deny, ...policyDecision.review, ...policyDecision.warn][0];
  if (!first) return undefined;
  if (first.rule.includes("outside_intended_scope")) return "Reissue the ticket or provide explicit scope expansion approval.";
  if (first.rule.includes("destructive")) return "Provide explicit destructive-action authorization.";
  if (first.rule.includes("high_risk") || first.rule.includes("protected")) return "Provide a human approval id before proceeding.";
  return "Resolve the policy finding before proceeding.";
}
