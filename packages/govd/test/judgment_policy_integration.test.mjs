import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  handlePreToolUse,
  loadState,
  readLedger,
  verifyAuditLedger,
} from "../dist/index.js";

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "govruntime-judgment-"));
  for (const dir of ["cases", "tickets", "branches", "audit", "docket", "evidence", "statutes", "regulations"]) {
    fs.mkdirSync(path.join(cwd, ".governance", dir), { recursive: true });
  }
  fs.writeFileSync(path.join(cwd, ".governance", "constitution.yaml"), "version: '0.1'\nmission: []\nnon_negotiables: []\nauthority_hierarchy: []\nstandard_of_proof:\n  casual_answer: { required: plausible_basis, threshold: 0.5 }\n  design_decision: { required: evidence_supported, threshold: 0.7 }\n  code_change: { required: clear_and_convincing, threshold: 0.8 }\n  destructive_action: { required: explicit_authorization, threshold: 0.95 }\n  policy_override: { required: human_approval, threshold: 1 }\n", "utf8");
  fs.writeFileSync(path.join(cwd, ".governance", "policy.yaml"), "engine: builtin\nmode: enforce\n", "utf8");
  fs.writeFileSync(path.join(cwd, ".governance", "cases", "C-1.yaml"), "case_id: C-1\nstatus: OPEN\ntitle: Test\nopened_at: '2026-05-25T00:00:00.000Z'\nissue: [Test]\nclaims: { user_claims: [] }\nevidence: []\napplicable_law: { constitution: [], statutes: [] }\nprecedents: []\nrelated_tickets: []\ntags: []\n", "utf8");
  fs.writeFileSync(path.join(cwd, ".governance", "tickets", "T-1.yaml"), "ticket_id: T-1\nrevision: 1\ncase_id: C-1\nstatus: IN_PROGRESS\nworkstream_status: ACTIVE\ntitle: Test\nobjective: Test objective\nacceptance_criteria: [Done]\nnon_goals: []\ndependencies: []\nassigned_agent: { primary: codex, human_review_required: false }\nrisk_profile: { ambiguity: 0, scope_drift: 0, implementation_complexity: 0, verification_strength: 1, blast_radius: low }\nverification_plan: { steps: [] }\ncreated_at: '2026-05-25T00:00:00.000Z'\nupdated_at: '2026-05-25T00:00:00.000Z'\n", "utf8");
  fs.writeFileSync(path.join(cwd, ".governance", "branches", "branch_ledger.yaml"), "branches:\n  - branch: codex/test\n    case_id: C-1\n    ticket_id: T-1\n    branch_type: feature\n    status: active\n    reason_created: [test]\n    intended_scope: ['src/**']\n    forbidden_scope: ['secrets/**']\n    parent_branch: main\n    success_criteria: []\n    exit_conditions: { merge_when: [], abandon_when: [] }\n    created_at: '2026-05-25T00:00:00.000Z'\n", "utf8");
  return cwd;
}

test("policy decision and judgment are recorded in audit ledger", () => {
  const cwd = fixture();
  const state = loadState(cwd);
  const result = handlePreToolUse({
    platform: "codex",
    hook_event_name: "PreToolUse",
    session_id: "s1",
    cwd,
    tool_name: "Read",
    tool_input: { file_path: "secrets/key.txt" },
    metadata: {},
    raw: {},
  }, state);

  assert.equal(result.decision, "block");
  const ledger = readLedger(cwd);
  assert.equal(ledger.some((entry) => entry.stream === "policy_decision"), true);
  assert.equal(ledger.some((entry) => entry.stream === "judgment"), true);
  assert.equal(verifyAuditLedger(cwd).ok, true);
});
