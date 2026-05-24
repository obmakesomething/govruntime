/**
 * Judgment Engine
 *
 * Applies constitution + statutes + precedents to produce a typed Judgment.
 * Every judgment includes a full decision trace for audit.
 *
 * Phase 1: rule-based judgment
 * Phase 2+: model-assisted judgment with evidence grounding
 */

import type {
  Judgment,
  JudgmentDecision,
  JudgmentOrder,
  GovernanceState,
  Conflict,
  NormalizedHookEvent,
  EvidenceId,
} from "../state/types.js";
import { newJudgmentId, nowISO } from "../state/ids.js";
import { appendJudgmentLog } from "../state/writer.js";
import {
  detectBranchScopeConflict,
  detectMissingGovernanceContext,
  detectPolicyViolation,
} from "../conflict/detector.js";

// ---------------------------------------------------------------------------
// PreToolUse judgment
// ---------------------------------------------------------------------------

export function judgeToolCall(
  event: NormalizedHookEvent,
  state: GovernanceState
): Judgment {
  const { active_case, active_ticket, active_branch, regulations } = state;

  const appliedAuthority: string[] = [];
  const evidenceUsed: EvidenceId[] = [];
  const missingEvidence: string[] = [];
  const orders: JudgmentOrder[] = [];
  let decision: JudgmentDecision = "allow";
  let reason = "Tool call is within governance bounds.";
  let confidence = 0.95;

  // --- Rule 1: No active case → block ---
  const missingCtx = detectMissingGovernanceContext(active_case, active_ticket);
  if (missingCtx.length > 0) {
    const noCase = missingCtx.find((c) => c.type === "procedural_conflict" && !active_case);
    const noTicket = missingCtx.find((c) => c.type === "procedural_conflict" && active_case);

    if (noCase) {
      decision = "warn";
      reason = "No active case. Create a case before executing.";
      appliedAuthority.push("constitution.no_execution_outside_active_case");
      missingEvidence.push("active_case");
      orders.push({ type: "create_case" });
      confidence = 0.99;
    } else if (noTicket) {
      decision = "warn";
      reason = "No active ticket. Issue a ticket before executing.";
      appliedAuthority.push("constitution.no_execution_outside_active_ticket");
      missingEvidence.push("active_ticket");
      orders.push({ type: "create_ticket" });
      confidence = 0.99;
    }
  }

  // --- Rule 2: Branch scope conflict ---
  const targetPath = extractTargetPath(event);
  if (targetPath && active_branch && active_case) {
    const scopeConflict = detectBranchScopeConflict(
      targetPath,
      active_branch,
      active_case
    );
    if (scopeConflict) {
      if (scopeConflict.type === "branch_scope_conflict") {
        decision = "block";
        reason = `Path "${targetPath}" is in the forbidden scope of branch "${active_branch.branch}".`;
        appliedAuthority.push("statute.BRANCH-001.no_forbidden_scope");
        missingEvidence.push("user_authorization_for_scope_expansion");
        orders.push({
          type: "reissue_ticket",
          reason: "Forbidden scope access requires ticket reissue with explicit authorization.",
        });
        confidence = 0.98;
      } else if (scopeConflict.type === "scope_expansion" && decision === "allow") {
        decision = "warn";
        reason = `Path "${targetPath}" is outside the active ticket's intended scope. Proceed with caution.`;
        appliedAuthority.push("statute.SCOPE-001.no_silent_scope_expansion");
        orders.push({ type: "create_discovered_issue", path: targetPath });
        confidence = 0.88;
      }
    }
  }

  // --- Rule 3: High-risk path from repo_policy ---
  if (targetPath && active_case) {
    const policyConflict = detectPolicyViolation(targetPath, regulations);
    if (policyConflict && decision === "allow") {
      decision = "warn";
      reason = `Path "${targetPath}" is classified as high-risk. Explicit authorization required.`;
      appliedAuthority.push("regulation.repo_policy.high_risk_path");
      missingEvidence.push("explicit_user_authorization");
      orders.push({ type: "require_human_review" });
      confidence = 0.95;
    }
  }

  // --- Rule 4: Destructive action check ---
  if (isDestructiveAction(event) && decision === "allow") {
    decision = "require_human_review";
    reason = "Destructive action detected. Explicit authorization required.";
    appliedAuthority.push(
      "constitution.no_destructive_action_without_explicit_authorization"
    );
    missingEvidence.push("explicit_user_authorization");
    confidence = 0.97;
  }

  const judgment: Judgment = {
    judgment_id: newJudgmentId(),
    case_id: active_case?.case_id ?? "NO_ACTIVE_CASE",
    ticket_id: active_ticket?.ticket_id,
    decision,
    reason,
    applied_authority: appliedAuthority,
    evidence_used: evidenceUsed,
    missing_evidence: missingEvidence.length > 0 ? missingEvidence : undefined,
    standard_of_proof: "clear_and_convincing",
    confidence,
    orders,
    recommended_action:
      missingEvidence.length > 0
        ? `Provide: ${missingEvidence.join(", ")}`
        : undefined,
    created_at: nowISO(),
  };

  appendJudgmentLog(state.cwd, judgment);
  return judgment;
}

// ---------------------------------------------------------------------------
// Stop flow judgment (completion check)
// ---------------------------------------------------------------------------

export function judgeCompletion(state: GovernanceState): Judgment {
  const { active_case, active_ticket } = state;
  const orders: JudgmentOrder[] = [];
  const missing: string[] = [];

  if (!active_ticket) {
    return makeQuickJudgment(state, "warn", "No active ticket to evaluate for completion.", []);
  }

  const criteria = active_ticket.acceptance_criteria;
  if (criteria.length === 0) {
    missing.push("acceptance_criteria");
    orders.push({
      type: "continue",
      reason: "Ticket has no acceptance criteria defined.",
    });
  }

  // Phase 1: we can only check structural completeness, not semantic
  // Phase 2+: model evaluates each criterion against evidence
  const decision: JudgmentDecision = missing.length > 0 ? "warn" : "allow";
  const reason =
    missing.length > 0
      ? `Completion check incomplete. Missing: ${missing.join(", ")}.`
      : `Ticket ${active_ticket.ticket_id} appears structurally complete. Verify acceptance criteria manually.`;

  return makeQuickJudgment(state, decision, reason, orders);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuickJudgment(
  state: GovernanceState,
  decision: JudgmentDecision,
  reason: string,
  orders: JudgmentOrder[]
): Judgment {
  const j: Judgment = {
    judgment_id: newJudgmentId(),
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

function extractTargetPath(event: NormalizedHookEvent): string | null {
  const input = event.tool_input ?? {};
  // Common path keys across tools
  for (const key of ["file_path", "path", "target_file", "filename"]) {
    if (typeof input[key] === "string") return input[key] as string;
  }
  return null;
}

const DESTRUCTIVE_TOOLS = new Set([
  "Bash",
  "bash",
  "shell",
  "exec",
  "rm",
  "delete",
  "drop",
  "truncate",
]);

const DESTRUCTIVE_COMMANDS = ["rm ", "rm -", "drop table", "truncate", "sudo rm"];

function isDestructiveAction(event: NormalizedHookEvent): boolean {
  if (event.tool_name && DESTRUCTIVE_TOOLS.has(event.tool_name)) {
    const cmd = String(event.tool_input?.["command"] ?? "").toLowerCase();
    return DESTRUCTIVE_COMMANDS.some((d) => cmd.includes(d));
  }
  return false;
}
