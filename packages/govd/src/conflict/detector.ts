/**
 * Conflict Detector
 *
 * Detects conflicts between new claims and existing governance state.
 * Phase 1: structural checks (scope expansion, policy violation).
 * Phase 2+: full semantic conflict analysis.
 */

import type {
  Conflict,
  ConflictType,
  Case,
  Ticket,
  BranchEntry,
  EvidenceId,
  ConflictId,
} from "../state/types.js";
import { newConflictId, nowISO } from "../state/ids.js";

// ---------------------------------------------------------------------------
// Branch scope conflict detection
// ---------------------------------------------------------------------------

export function detectBranchScopeConflict(
  targetPath: string,
  activeBranch: BranchEntry | null,
  activeCase: Case | null,
  cwd: string = process.cwd(),
): Conflict | null {
  if (!activeBranch || !activeCase) return null;

  const { intended_scope, forbidden_scope } = activeBranch;

  // Check forbidden scope
  for (const pattern of forbidden_scope) {
    if (matchesGlob(targetPath, pattern)) {
      return makeConflict({
        case_id: activeCase.case_id,
        ticket_id: activeBranch.ticket_id,
        type: "branch_scope_conflict",
        old_state: `Branch intended_scope: ${intended_scope.join(", ")}`,
        new_state: `Tool targets forbidden path: ${targetPath}`,
        requires_user_confirmation: true,
        evidence: [],
      }, cwd);
    }
  }

  // Check if path is outside intended scope
  if (intended_scope.length > 0) {
    const inScope = intended_scope.some((pattern) =>
      matchesGlob(targetPath, pattern)
    );
    if (!inScope) {
      return makeConflict({
        case_id: activeCase.case_id,
        ticket_id: activeBranch.ticket_id,
        type: "scope_expansion",
        old_state: `Branch intended_scope: ${intended_scope.join(", ")}`,
        new_state: `Tool targets out-of-scope path: ${targetPath}`,
        requires_user_confirmation: false, // warn only in Phase 1
        evidence: [],
      }, cwd);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Policy violation detection
// ---------------------------------------------------------------------------

export function detectPolicyViolation(
  targetPath: string,
  regulations: Record<string, unknown>,
  cwd: string = process.cwd(),
): Conflict | null {
  const repoPolicy = regulations["repo_policy"] as
    | {
        rules?: Array<{
          applies_to?: { paths?: string[] };
          risk_level?: string;
          required_review?: string;
        }>;
      }
    | undefined;

  if (!repoPolicy?.rules) return null;

  for (const rule of repoPolicy.rules) {
    const paths = rule.applies_to?.paths ?? [];
    const matchesPolicy = paths.some((p) => matchesGlob(targetPath, p));
    if (matchesPolicy && rule.risk_level === "high") {
      return makeConflict({
        case_id: "UNKNOWN", // will be filled by caller
        type: "policy_violation",
        old_state: `Path "${targetPath}" is classified as high-risk by repo_policy.`,
        new_state: `Agent attempted to edit high-risk path without explicit authorization.`,
        requires_user_confirmation: true,
        evidence: [],
      }, cwd);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// No-active-case / no-active-ticket conflict
// ---------------------------------------------------------------------------

export function detectMissingGovernanceContext(
  activeCase: Case | null,
  activeTicket: Ticket | null,
  cwd: string = process.cwd(),
): Conflict[] {
  const conflicts: Conflict[] = [];
  const caseId = activeCase?.case_id ?? "NO_ACTIVE_CASE";

  if (!activeCase) {
    conflicts.push(
      makeConflict({
        case_id: caseId,
        type: "procedural_conflict",
        old_state: "No active case exists.",
        new_state: "Agent attempting to execute without an active case.",
        requires_user_confirmation: false,
        evidence: [],
      }, cwd)
    );
  }

  if (activeCase && !activeTicket) {
    conflicts.push(
      makeConflict({
        case_id: caseId,
        type: "procedural_conflict",
        old_state: "No active ticket exists for the current case.",
        new_state: "Agent attempting to execute without an active ticket.",
        requires_user_confirmation: false,
        evidence: [],
      }, cwd)
    );
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MakeConflictOpts {
  case_id: string;
  ticket_id?: string;
  type: ConflictType;
  old_state: string;
  new_state: string;
  requires_user_confirmation: boolean;
  evidence: EvidenceId[];
}

function makeConflict(opts: MakeConflictOpts, cwd: string): Conflict {
  return {
    conflict_id: newConflictId(cwd) as ConflictId,
    case_id: opts.case_id,
    ticket_id: opts.ticket_id,
    type: opts.type,
    old_state: opts.old_state,
    new_state: opts.new_state,
    status: "open",
    requires_user_confirmation: opts.requires_user_confirmation,
    evidence: opts.evidence,
    created_at: nowISO(),
  };
}

/**
 * Simple glob matcher supporting ** and * patterns.
 */
export function matchesGlob(filePath: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "DOUBLE_STAR")
    .replace(/\*/g, "[^/]*")
    .replace(/DOUBLE_STAR/g, ".*");
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(filePath);
}
