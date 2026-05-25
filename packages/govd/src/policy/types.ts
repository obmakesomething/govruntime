export type PolicyEngineName = "builtin" | "opa";
export type PolicyMode = "enforce" | "advisory";
export type PolicyDecisionKind = "allow" | "warn" | "require_human_review" | "block";

export interface PolicyInput {
  event: {
    hook: "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop" | string;
    platform: "claude_code" | "codex" | "cursor" | "generic" | string;
    tool_name?: string;
    command?: string;
    target_paths: string[];
    diff_paths?: string[];
    destructive_signals: string[];
  };
  actor: {
    type: "agent" | "user" | "hook" | "system";
    agent?: string;
    session_id?: string;
  };
  governance: {
    active_case?: {
      case_id: string;
      status: string;
    };
    active_ticket?: {
      ticket_id: string;
      status: string;
      acceptance_criteria?: string[];
      non_goals?: string[];
      risk_profile?: unknown;
    };
    active_branch?: {
      branch?: string;
      intended_scope: string[];
      forbidden_scope: string[];
    };
  };
  repo: {
    git_head?: string;
    high_risk_paths: string[];
    protected_paths: string[];
  };
  authorization: {
    explicit_scope_expansion: boolean;
    explicit_destructive_action: boolean;
    human_approval_ids: string[];
  };
  policy_context: {
    engine: PolicyEngineName;
    mode: PolicyMode;
    policy_bundle_hash?: string;
    policy_version?: string;
  };
}

export interface PolicyFinding {
  rule: string;
  reason: string;
  path?: string;
  severity?: "low" | "medium" | "high" | "critical";
}

export interface PolicyDecision {
  decision: PolicyDecisionKind;
  deny: PolicyFinding[];
  warn: PolicyFinding[];
  review: PolicyFinding[];
  metadata: {
    engine: PolicyEngineName;
    input_hash: string;
    result_hash: string;
    policy_bundle_hash?: string;
    policy_version?: string;
    evaluated_at: string;
    entrypoint?: string;
    policy_dir?: string;
    data_dir?: string;
    opa_unavailable?: boolean;
    fallback_engine?: PolicyEngineName;
    raw_result?: unknown;
  };
}

export interface PolicyEngine {
  evaluate(input: PolicyInput): PolicyDecision;
}

export interface PolicyConfig {
  engine: PolicyEngineName;
  entrypoint?: string;
  mode: PolicyMode;
  policy_dir?: string;
  data_dir?: string;
  policy_version?: string;
}
