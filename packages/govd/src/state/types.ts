/**
 * @govruntime/govd — Core Type Definitions
 *
 * All entities in the AI Legal Governance Runtime are defined here.
 * These types map directly to the YAML/JSONL structures in .governance/.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export type ISODateString = string; // ISO 8601
export type EvidenceId = string;    // EV-YYYY-MM-DD-NNN
export type CaseId = string;        // CASE-YYYY-MM-DD-XXX
export type TicketId = string;      // T-XXX-NNN-RN
export type PrecedentId = string;   // P-NNN
export type ConflictId = string;    // CON-YYYY-MM-DD-NNN
export type JudgmentId = string;    // JDG-YYYY-MM-DD-NNN
export type DocketEventId = string; // DCK-YYYY-MM-DD-NNN
export type SimulationId = string;  // SIM-YYYY-MM-DD-NNN

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type EvidenceType =
  | "user_statement"
  | "tool_output"
  | "test_result"
  | "file_diff"
  | "repo_state"
  | "policy_document"
  | "prior_decision"
  | "precedent_reference"
  | "simulation_result"
  | "model_inference";

export type EvidenceTier = 1 | 2 | 3 | 4 | 5 | 6;

export type EvidenceAdmissibility = "admissible" | "inadmissible" | "pending";

export interface EvidenceClaim {
  claim: string;
  confidence: number; // 0.0–1.0
}

export interface EvidenceSource {
  turn_id?: string;
  speaker?: string;
  quote?: string;
  tool?: string;
  command?: string;
  exit_code?: number;
  file_path?: string;
  url?: string;
}

export interface Evidence {
  evidence_id: EvidenceId;
  type: EvidenceType;
  tier: EvidenceTier;
  source: EvidenceSource;
  claims: EvidenceClaim[];
  admissibility: EvidenceAdmissibility;
  scope: string; // e.g. "current_project", "current_ticket"
  case_id?: CaseId;
  ticket_id?: TicketId;
  created_at: ISODateString;
}

// ---------------------------------------------------------------------------
// Precedent
// ---------------------------------------------------------------------------

export type PrecedentStatus = "active" | "overruled" | "limited" | "pending";

export interface Precedent {
  precedent_id: PrecedentId;
  case_id: CaseId;
  status: PrecedentStatus;
  issue: string[];
  holding: string[];
  material_facts: string[];
  rule: string[];
  applies_when: string[];
  overridable_by: string[];
  created_at: ISODateString;
  overruled_at?: ISODateString;
  overruled_by?: PrecedentId;
}

// ---------------------------------------------------------------------------
// Case
// ---------------------------------------------------------------------------

export type CaseStatus =
  | "DRAFT"
  | "OPEN"
  | "UNDER_REVIEW"
  | "UNDER_JUDGMENT"
  | "JUDGED"
  | "ENFORCING"
  | "CLOSED"
  | "STAYED"
  | "APPEALED"
  | "REOPENED"
  | "SUPERSEDED";

export interface CaseJudgment {
  decision: string;
  rationale: string[];
  orders: Array<{ type: string; [key: string]: unknown }>;
}

export interface Case {
  case_id: CaseId;
  status: CaseStatus;
  title: string;
  opened_at: ISODateString;
  closed_at?: ISODateString;
  issue: string[];
  claims: {
    user_claims: string[];
    agent_claims?: string[];
  };
  evidence: EvidenceId[];
  applicable_law: {
    constitution: string[];
    statutes: string[];
  };
  precedents: PrecedentId[];
  judgment?: CaseJudgment;
  related_tickets: TicketId[];
  tags: string[];
}

// ---------------------------------------------------------------------------
// Ticket
// ---------------------------------------------------------------------------

export type TicketStatus =
  | "DRAFT"
  | "ANALYZED"
  | "SIMULATING"
  | "READY"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "VERIFYING"
  | "DONE"
  | "BLOCKED_BY_CONFLICT"
  | "BLOCKED_BY_AMBIGUITY"
  | "BLOCKED_BY_POLICY"
  | "NEEDS_REISSUE"
  | "SUPERSEDED"
  | "PAUSED"
  | "CANCELLED";

export type WorkstreamStatus =
  | "ACTIVE"
  | "PAUSED"
  | "STAYED"
  | "BLOCKED"
  | "SUPERSEDED"
  | "ABANDONED"
  | "MERGED"
  | "SPLIT"
  | "DEFERRED"
  | "OVERRULED"
  | "DONE";

export interface RiskProfile {
  ambiguity: number;
  scope_drift: number;
  implementation_complexity: number;
  verification_strength: number;
  blast_radius: "low" | "medium" | "high" | "critical";
}

export interface VerificationPlan {
  steps: string[];
}

export interface AssignedAgent {
  primary: string;
  reviewer?: string;
  human_review_required: boolean;
}

export interface Ticket {
  ticket_id: TicketId;
  revision: number;
  case_id: CaseId;
  status: TicketStatus;
  workstream_status: WorkstreamStatus;
  title: string;
  objective: string;
  reason_for_reissue?: string;
  supersedes?: TicketId;
  acceptance_criteria: string[];
  non_goals: string[];
  dependencies: string[];
  assigned_agent: AssignedAgent;
  risk_profile: RiskProfile;
  verification_plan: VerificationPlan;
  created_at: ISODateString;
  updated_at: ISODateString;
  closed_at?: ISODateString;
}

// ---------------------------------------------------------------------------
// Docket
// ---------------------------------------------------------------------------

export type DocketEventType =
  | "case_opened"
  | "case_reframed"
  | "issue_framed"
  | "evidence_admitted"
  | "ticket_issued"
  | "ticket_reissued"
  | "ticket_split"
  | "ticket_merged"
  | "ticket_superseded"
  | "ticket_paused"
  | "ticket_resumed"
  | "workstream_deepened"
  | "workstream_deferred"
  | "branch_created"
  | "branch_abandoned"
  | "branch_merged"
  | "worktree_created"
  | "worktree_removed"
  | "conflict_detected"
  | "conflict_resolved"
  | "judgment_rendered"
  | "precedent_created"
  | "appeal_requested"
  | "human_review_required"
  | "execution_blocked"
  | "execution_allowed"
  | "simulation_run"
  | "session_started"
  | "session_ended";

export interface DocketDecision {
  type: string;
  rationale: string;
}

export interface DocketEvent {
  event_id: DocketEventId;
  case_id: CaseId;
  ticket_id?: TicketId;
  event_type: DocketEventType;
  actor: "user" | "agent" | "system" | "hook";
  reason: string;
  evidence: EvidenceId[];
  status_before?: string;
  status_after?: string;
  decision?: DocketDecision;
  affected_branches?: string[];
  metadata?: Record<string, unknown>;
  created_at: ISODateString;
}

// ---------------------------------------------------------------------------
// Branch / Worktree Ledger
// ---------------------------------------------------------------------------

export type BranchStatus =
  | "active"
  | "merged"
  | "abandoned"
  | "blocked"
  | "paused";

export interface BranchExitConditions {
  merge_when: string[];
  abandon_when: string[];
}

export interface BranchEntry {
  branch: string; // gov/<case-id>/<ticket-id>/<purpose>
  worktree?: string; // .worktrees/<case-id>-<ticket-id>
  case_id: CaseId;
  ticket_id: TicketId;
  branch_type: string;
  status: BranchStatus;
  reason_created: string[];
  intended_scope: string[];
  forbidden_scope: string[];
  parent_branch: string;
  success_criteria: string[];
  exit_conditions: BranchExitConditions;
  created_at: ISODateString;
  merged_at?: ISODateString;
  abandoned_at?: ISODateString;
}

export interface BranchLedger {
  branches: BranchEntry[];
}

// ---------------------------------------------------------------------------
// Conflict
// ---------------------------------------------------------------------------

export type ConflictType =
  | "direct_contradiction"
  | "priority_shift"
  | "scope_expansion"
  | "scope_reduction"
  | "evidence_conflict"
  | "policy_violation"
  | "precedent_override"
  | "branch_scope_conflict"
  | "procedural_conflict";

export type ConflictStatus = "open" | "resolved" | "deferred" | "appealed";

export interface Conflict {
  conflict_id: ConflictId;
  case_id: CaseId;
  ticket_id?: TicketId;
  type: ConflictType;
  old_state: string;
  new_state: string;
  status: ConflictStatus;
  resolution?: string;
  requires_user_confirmation: boolean;
  evidence: EvidenceId[];
  docket_event?: DocketEventId;
  created_at: ISODateString;
  resolved_at?: ISODateString;
}

// ---------------------------------------------------------------------------
// Judgment
// ---------------------------------------------------------------------------

export type JudgmentDecision =
  | "allow"
  | "block"
  | "warn"
  | "require_evidence"
  | "require_human_review"
  | "create_ticket"
  | "reissue_ticket"
  | "pause_ticket"
  | "resume_ticket"
  | "create_precedent"
  | "create_docket_event"
  | "run_simulation";

export interface JudgmentOrder {
  type: string;
  [key: string]: unknown;
}

export interface Judgment {
  judgment_id: JudgmentId;
  case_id: CaseId;
  ticket_id?: TicketId;
  decision: JudgmentDecision;
  reason: string;
  applied_authority: string[];
  evidence_used: EvidenceId[];
  missing_evidence?: string[];
  standard_of_proof: string;
  confidence: number;
  orders: JudgmentOrder[];
  recommended_action?: string;
  created_at: ISODateString;
}

// ---------------------------------------------------------------------------
// Intent Delta
// ---------------------------------------------------------------------------

export type IntentDeltaType =
  | "continue"
  | "refine"
  | "correct"
  | "pivot"
  | "new_task"
  | "cancel"
  | "deepen"
  | "pause"
  | "resume";

export interface IntentDelta {
  type: IntentDeltaType;
  summary: string;
  confidence: number;
}

export interface PromptAnalysis {
  event_type: "user_message_analyzed";
  intent_delta: IntentDelta;
  desired_action: {
    mode: string;
    expected_output: string;
  };
  new_facts: Array<{
    fact: string;
    source: string;
    confidence: number;
  }>;
  conflicts: Conflict[];
  ticket_actions: Array<{
    action: "issue" | "reissue" | "pause" | "resume" | "cancel";
    ticket_id?: TicketId;
    new_ticket_id?: TicketId;
    reason: string;
  }>;
  docket_events: Array<{
    event_type: DocketEventType;
    reason: string;
  }>;
  next_best_action: string;
}

// ---------------------------------------------------------------------------
// Hook Events (Normalized)
// ---------------------------------------------------------------------------

export type HookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "Stop";

export type HookPlatform = "claude_code" | "codex" | "generic";

export interface NormalizedHookEvent {
  platform: HookPlatform;
  hook_event_name: HookEventName;
  session_id: string;
  cwd: string;
  transcript_path?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  last_assistant_message?: string;
  metadata: Record<string, unknown>;
  raw: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Hook Responses
// ---------------------------------------------------------------------------

export interface HookDecision {
  decision: JudgmentDecision | "allow" | "block" | "warn" | "require_human_review";
  reason?: string;
  applied_rules?: string[];
  evidence_used?: EvidenceId[];
  missing_evidence?: string[];
  recommended_action?: string;
  context_pack?: string;
  docket_events_created?: DocketEventId[];
}

// ---------------------------------------------------------------------------
// Governance State
// ---------------------------------------------------------------------------

export interface GovernanceState {
  cwd: string;
  governance_dir: string;
  constitution: ConstitutionConfig | null;
  statutes: Record<string, unknown>;
  regulations: Record<string, unknown>;
  cases: Case[];
  tickets: Ticket[];
  precedents: Precedent[];
  branch_ledger: BranchLedger;
  active_case: Case | null;
  active_ticket: Ticket | null;
  active_branch: BranchEntry | null;
}

// ---------------------------------------------------------------------------
// Constitution
// ---------------------------------------------------------------------------

export interface StandardOfProof {
  required: string;
  threshold: number;
}

export interface ConstitutionConfig {
  version: string;
  mission: string[];
  non_negotiables: string[];
  authority_hierarchy: string[];
  standard_of_proof: {
    casual_answer: StandardOfProof;
    design_decision: StandardOfProof;
    code_change: StandardOfProof;
    destructive_action: StandardOfProof;
    policy_override: StandardOfProof;
  };
}
