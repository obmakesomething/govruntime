/**
 * Branch / Worktree Ledger
 *
 * Enforces: every branch and worktree must have a ledger entry.
 * Naming convention: gov/<case-id>/<ticket-id>/<purpose>
 * Worktree convention: .worktrees/<case-id>-<ticket-id>
 */

import type {
  BranchEntry,
  BranchLedger,
  BranchStatus,
  CaseId,
  TicketId,
} from "../state/types.js";
import { nowISO } from "../state/ids.js";
import { writeBranchLedger } from "../state/writer.js";
import { loadState } from "../state/loader.js";

// ---------------------------------------------------------------------------
// Branch naming
// ---------------------------------------------------------------------------

export function buildBranchName(
  case_id: CaseId,
  ticket_id: TicketId,
  purpose: string
): string {
  const safePurpose = purpose
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return `gov/${case_id}/${ticket_id}/${safePurpose}`;
}

export function buildWorktreePath(
  case_id: CaseId,
  ticket_id: TicketId
): string {
  return `.worktrees/${case_id}-${ticket_id}`;
}

// ---------------------------------------------------------------------------
// Ledger operations
// ---------------------------------------------------------------------------

export function createBranchEntry(
  cwd: string,
  opts: {
    case_id: CaseId;
    ticket_id: TicketId;
    purpose: string;
    branch_type: string;
    reason_created: string[];
    intended_scope: string[];
    forbidden_scope?: string[];
    parent_branch?: string;
    success_criteria?: string[];
    exit_conditions?: BranchEntry["exit_conditions"];
    with_worktree?: boolean;
  }
): BranchEntry {
  const state = loadState(cwd);
  const ledger = state.branch_ledger;

  const branch = buildBranchName(opts.case_id, opts.ticket_id, opts.purpose);
  const worktree = opts.with_worktree
    ? buildWorktreePath(opts.case_id, opts.ticket_id)
    : undefined;

  const entry: BranchEntry = {
    branch,
    worktree,
    case_id: opts.case_id,
    ticket_id: opts.ticket_id,
    branch_type: opts.branch_type,
    status: "active",
    reason_created: opts.reason_created,
    intended_scope: opts.intended_scope,
    forbidden_scope: opts.forbidden_scope ?? [],
    parent_branch: opts.parent_branch ?? "main",
    success_criteria: opts.success_criteria ?? [],
    exit_conditions: opts.exit_conditions ?? {
      merge_when: ["acceptance criteria satisfied", "no unresolved conflicts"],
      abandon_when: ["ticket superseded", "case closed without merge"],
    },
    created_at: nowISO(),
  };

  const updated: BranchLedger = {
    branches: [...ledger.branches, entry],
  };

  writeBranchLedger(cwd, updated);
  return entry;
}

export function updateBranchStatus(
  cwd: string,
  branchName: string,
  status: BranchStatus,
  opts?: { merged_at?: string; abandoned_at?: string }
): BranchEntry | null {
  const state = loadState(cwd);
  const ledger = state.branch_ledger;

  const index = ledger.branches.findIndex((b) => b.branch === branchName);
  if (index === -1) return null;

  const existing = ledger.branches[index];
  if (!existing) return null;

  const updated: BranchEntry = {
    ...existing,
    status,
    merged_at: opts?.merged_at ?? existing.merged_at,
    abandoned_at: opts?.abandoned_at ?? existing.abandoned_at,
  };

  const newBranches = [...ledger.branches];
  newBranches[index] = updated;

  writeBranchLedger(cwd, { branches: newBranches });
  return updated;
}

export function findActiveBranchForTicket(
  ledger: BranchLedger,
  ticket_id: TicketId
): BranchEntry | null {
  return (
    ledger.branches.find(
      (b) => b.ticket_id === ticket_id && b.status === "active"
    ) ?? null
  );
}

export function listBranches(ledger: BranchLedger): BranchEntry[] {
  return [...ledger.branches];
}
