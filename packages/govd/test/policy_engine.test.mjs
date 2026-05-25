import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateBuiltinPolicy,
  evaluatePolicy,
  normalizeOpaValue,
} from "../dist/index.js";

function input(overrides = {}) {
  return {
    event: {
      hook: "PreToolUse",
      platform: "codex",
      tool_name: "Read",
      target_paths: ["src/app.ts"],
      destructive_signals: [],
      ...overrides.event,
    },
    actor: { type: "hook", session_id: "s1" },
    governance: {
      active_case: { case_id: "C-1", status: "OPEN" },
      active_ticket: { ticket_id: "T-1", status: "IN_PROGRESS", acceptance_criteria: [], non_goals: [] },
      active_branch: { branch: "codex/test", intended_scope: ["src/**"], forbidden_scope: ["secrets/**"] },
      ...overrides.governance,
    },
    repo: { high_risk_paths: ["infra/**"], protected_paths: ["prod/**"], ...overrides.repo },
    authorization: {
      explicit_scope_expansion: false,
      explicit_destructive_action: false,
      human_approval_ids: [],
      ...overrides.authorization,
    },
    policy_context: { engine: "builtin", mode: "enforce", ...overrides.policy_context },
  };
}

test("builtin allows approved path", () => {
  assert.equal(evaluateBuiltinPolicy(input()).decision, "allow");
});

test("builtin blocks forbidden path", () => {
  const decision = evaluateBuiltinPolicy(input({ event: { target_paths: ["secrets/key.txt"] } }));
  assert.equal(decision.decision, "block");
  assert.equal(decision.deny[0].rule, "scope.forbidden_scope");
});

test("builtin blocks outside intended scope in enforce mode", () => {
  const decision = evaluateBuiltinPolicy(input({ event: { target_paths: ["docs/readme.md"] } }));
  assert.equal(decision.decision, "block");
  assert.equal(decision.deny[0].rule, "scope.outside_intended_scope");
});

test("builtin warns outside intended scope in advisory mode", () => {
  const decision = evaluateBuiltinPolicy(input({ event: { target_paths: ["docs/readme.md"] }, policy_context: { mode: "advisory" } }));
  assert.equal(decision.decision, "warn");
});

test("builtin blocks destructive command without explicit authorization", () => {
  const decision = evaluateBuiltinPolicy(input({ event: { destructive_signals: ["rm_rf"] } }));
  assert.equal(decision.decision, "block");
  assert.equal(decision.deny[0].rule, "destructive.requires_explicit_authorization");
});

test("builtin allows destructive command with explicit authorization", () => {
  const decision = evaluateBuiltinPolicy(input({ event: { destructive_signals: ["rm_rf"] }, authorization: { explicit_destructive_action: true } }));
  assert.equal(decision.decision, "allow");
});

test("builtin requires review for high-risk path without approval", () => {
  const decision = evaluateBuiltinPolicy(input({ event: { target_paths: ["infra/main.tf"] }, governance: { active_branch: { branch: "codex/test", intended_scope: ["infra/**"], forbidden_scope: [] } } }));
  assert.equal(decision.decision, "require_human_review");
});

test("OPA missing fails closed in enforce mode", () => {
  const oldPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const decision = evaluatePolicy(input({ policy_context: { engine: "opa", mode: "enforce" } }), { engine: "opa", mode: "enforce" }, process.cwd());
    assert.equal(decision.decision, "block");
    assert.equal(decision.deny[0].rule, "policy.opa_unavailable");
  } finally {
    process.env.PATH = oldPath;
  }
});

test("OPA missing may fallback and warn in advisory mode", () => {
  const oldPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const decision = evaluatePolicy(input({ policy_context: { engine: "opa", mode: "advisory" } }), { engine: "opa", mode: "advisory" }, process.cwd());
    assert.equal(decision.decision, "warn");
    assert.equal(decision.warn[0].rule, "policy.opa_unavailable");
  } finally {
    process.env.PATH = oldPath;
  }
});

test("OPA result deny normalizes to block", () => {
  const decision = normalizeOpaValue(input(), { deny: [{ rule: "x", reason: "no" }], warn: [], review: [] });
  assert.equal(decision.decision, "block");
});

test("OPA result review normalizes to require_human_review", () => {
  const decision = normalizeOpaValue(input(), { deny: [], warn: [], review: [{ rule: "x", reason: "review" }] });
  assert.equal(decision.decision, "require_human_review");
});

test("OPA result warn normalizes to warn", () => {
  const decision = normalizeOpaValue(input(), { deny: [], warn: [{ rule: "x", reason: "warn" }], review: [] });
  assert.equal(decision.decision, "warn");
});
