import { appendLedgerRecord } from "../audit/ledger.js";
import { evaluateBuiltinPolicy } from "./builtin.js";
import { evaluateOpaPolicy } from "./opa.js";
import { buildPolicyInput, loadPolicyConfig } from "./normalize.js";
import type { GovernanceState, NormalizedHookEvent } from "../state/types.js";
import type { PolicyConfig, PolicyDecision, PolicyInput } from "./types.js";

export function evaluatePolicy(input: PolicyInput, config: PolicyConfig, cwd: string): PolicyDecision {
  if (config.engine === "opa") return evaluateOpaPolicy(input, config, cwd);
  return evaluateBuiltinPolicy(input);
}

export function evaluatePolicyForEvent(event: NormalizedHookEvent, state: GovernanceState): { input: PolicyInput; decision: PolicyDecision; config: PolicyConfig } {
  const config = loadPolicyConfig(state.cwd);
  const input = buildPolicyInput(event, state, config);
  const decision = evaluatePolicy(input, config, state.cwd);
  appendLedgerRecord(state.cwd, "policy_decision", `policy-${event.session_id}-${Date.now()}`, sanitizePolicyDecisionRecord(input, decision, config), {
    actor: "hook",
    case_id: state.active_case?.case_id,
    ticket_id: state.active_ticket?.ticket_id,
    session_id: event.session_id,
  });
  return { input, decision, config };
}

function sanitizePolicyDecisionRecord(input: PolicyInput, decision: PolicyDecision, config: PolicyConfig): Record<string, unknown> {
  return {
    engine: config.engine,
    mode: config.mode,
    entrypoint: config.entrypoint,
    policy_dir: config.policy_dir,
    data_dir: config.data_dir,
    normalized_decision: decision.decision,
    deny: decision.deny,
    warn: decision.warn,
    review: decision.review,
    metadata: decision.metadata,
    input_summary: {
      hook: input.event.hook,
      platform: input.event.platform,
      tool_name: input.event.tool_name,
      target_paths: input.event.target_paths,
      diff_paths: input.event.diff_paths,
      destructive_signals: input.event.destructive_signals,
      active_case_id: input.governance.active_case?.case_id,
      active_ticket_id: input.governance.active_ticket?.ticket_id,
      branch: input.governance.active_branch?.branch,
      explicit_scope_expansion: input.authorization.explicit_scope_expansion,
      explicit_destructive_action: input.authorization.explicit_destructive_action,
      human_approval_count: input.authorization.human_approval_ids.length,
    },
  };
}
