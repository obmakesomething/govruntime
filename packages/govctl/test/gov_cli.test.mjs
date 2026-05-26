import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gov = path.resolve(__dirname, "../dist/gov.js");

function run(args, cwd, opts = {}) {
  return childProcess.spawnSync(process.execPath, [gov, ...args, "--cwd", cwd], {
    encoding: "utf8",
    ...opts,
  });
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "govruntime-gov-"));
}

test("gov init creates expected case files", () => {
  const cwd = tmp();
  const result = run(["init", "--case", "pipeline3"], cwd);
  assert.equal(result.status, 0, result.stderr);
  for (const file of ["case.yaml", "decisions.yaml", "invariants.yaml", "gates.yaml", "events.jsonl", "state.generated.json", "context_pack.generated.md", "linear_packet.generated.md"]) {
    assert.equal(fs.existsSync(path.join(cwd, ".governance", "cases", "pipeline3", file)), true, file);
  }
});

test("gov record-event appends valid JSONL", () => {
  const cwd = tmp();
  run(["init", "--case", "pipeline3"], cwd);
  const result = run(["record-event", "--case", "pipeline3", "--type", "validator_result", "--message", "validator passed", "--evidence", "validator#sha256:abc"], cwd);
  assert.equal(result.status, 0, result.stderr);
  const lines = fs.readFileSync(path.join(cwd, ".governance", "cases", "pipeline3", "events.jsonl"), "utf8").trim().split("\n");
  const event = JSON.parse(lines.at(-1));
  assert.equal(event.case_id, "pipeline3");
  assert.equal(event.type, "validator_result");
  assert.deepEqual(event.evidence_refs, ["validator#sha256:abc"]);
});

test("gov generate-state produces state and context pack", () => {
  const cwd = tmp();
  run(["init", "--case", "pipeline3"], cwd);
  const result = run(["generate-state", "--case", "pipeline3"], cwd);
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(cwd, ".governance", "cases", "pipeline3", "state.generated.json"), "utf8"));
  assert.equal(state.case_id, "pipeline3");
  assert.match(fs.readFileSync(path.join(cwd, ".governance", "cases", "pipeline3", "context_pack.generated.md"), "utf8"), /Current Case/);
});

test("gov check blocks section_id=all repair", () => {
  const cwd = tmp();
  run(["init", "--case", "pipeline3"], cwd);
  const payload = path.join(cwd, "payload.json");
  fs.writeFileSync(payload, JSON.stringify({ section_id: "all", repair_target: "full report" }));
  const result = run(["check", "--case", "pipeline3", "--before-tool", "repair", "--payload", payload], cwd);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /FORBIDDEN_FULL_REPORT_REPAIR/);
});

test("gov check blocks GPT Pro submit without profile evidence", () => {
  const cwd = tmp();
  run(["init", "--case", "pipeline3"], cwd);
  const payload = path.join(cwd, "payload.json");
  fs.writeFileSync(payload, JSON.stringify({ artifact_hash: "abc" }));
  const result = run(["check", "--case", "pipeline3", "--before-tool", "gpt-pro-submit", "--payload", payload], cwd);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /MISSING_OR_WRONG_GPT_PRO_PROFILE_EVIDENCE/);
});

test("gov check blocks release without human gate", () => {
  const cwd = tmp();
  run(["init", "--case", "pipeline3"], cwd);
  const result = run(["check", "--case", "pipeline3", "--before-tool", "release"], cwd);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /MISSING_HUMAN_GATE/);
});

test("gov check blocks stale artifact as fresh", () => {
  const cwd = tmp();
  run(["init", "--case", "pipeline3"], cwd);
  const manifest = path.join(cwd, "manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ artifact_hash: "fresh-hash" }));
  run(["record-run", "--case", "pipeline3", "--run", "run1", "--manifest", manifest], cwd);
  run(["generate-state", "--case", "pipeline3"], cwd);
  const payload = path.join(cwd, "payload.json");
  fs.writeFileSync(payload, JSON.stringify({ artifact_hash: "old-hash" }));
  const result = run(["check", "--case", "pipeline3", "--before-tool", "review-submit", "--payload", payload], cwd);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /STALE_ARTIFACT_AS_FRESH/);
});

test("gov check blocks deterministic Korean prose replacement", () => {
  const cwd = tmp();
  run(["init", "--case", "pipeline3"], cwd);
  const payload = path.join(cwd, "payload.json");
  fs.writeFileSync(payload, JSON.stringify({ strategy: "deterministic Korean prose replacement" }));
  const result = run(["check", "--case", "pipeline3", "--before-tool", "repair", "--payload", payload], cwd);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /FORBIDDEN_DETERMINISTIC_KOREAN_PROSE_REPLACEMENT/);
});

test("gov trace shows simple stage lineage", () => {
  const cwd = tmp();
  run(["init", "--case", "pipeline3"], cwd);
  const manifest = path.join(cwd, "manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ artifact_hash: "fresh-hash" }));
  run(["record-run", "--case", "pipeline3", "--run", "run1", "--manifest", manifest], cwd);
  const input = path.join(cwd, "input.txt");
  const output = path.join(cwd, "output.txt");
  fs.writeFileSync(input, "prompt with bearer token-secret");
  fs.writeFileSync(output, "section output");
  const recorded = run(["record-stage", "--case", "pipeline3", "--run", "run1", "--section", "intro", "--stage", "provider_raw_output", "--input", input, "--output", output], cwd);
  assert.equal(recorded.status, 0, recorded.stderr);
  const result = run(["trace", "--case", "pipeline3", "--run", "run1", "--section", "intro"], cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /provider_raw_output/);
  const ledger = path.join(cwd, ".governance", "cases", "pipeline3", "runs", "run1", "stage_ledger.jsonl");
  const row = JSON.parse(fs.readFileSync(ledger, "utf8").trim());
  assert.equal(row.case_id, "pipeline3");
  assert.equal(typeof row.input_hash, "string");
  assert.equal(row.input_excerpt.includes("token-secret"), false);
});

test("gov record-stage rejects unsupported stage names", () => {
  const cwd = tmp();
  run(["init", "--case", "pipeline3"], cwd);
  const manifest = path.join(cwd, "manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ artifact_hash: "fresh-hash" }));
  run(["record-run", "--case", "pipeline3", "--run", "run1", "--manifest", manifest], cwd);
  const result = run(["record-stage", "--case", "pipeline3", "--run", "run1", "--section", "intro", "--stage", "random_stage"], cwd);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported stage_name/);
});

test("gov finalize-run blocks missing stage coverage", () => {
  const cwd = tmp();
  run(["init", "--case", "pipeline3"], cwd);
  const manifest = path.join(cwd, "manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ artifact_hash: "fresh-hash" }));
  run(["record-run", "--case", "pipeline3", "--run", "run1", "--manifest", manifest], cwd);
  const payload = path.join(cwd, "stage.json");
  fs.writeFileSync(payload, JSON.stringify({ artifact_hash: "fresh-hash" }));
  run(["record-stage", "--case", "pipeline3", "--run", "run1", "--section", "intro", "--stage", "final_markdown", "--payload", payload], cwd);
  const result = run(["finalize-run", "--case", "pipeline3", "--run", "run1", "--artifact-hash", "fresh-hash"], cwd);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /INSTRUMENTATION_MISSING/);
  assert.match(result.stdout, /provider_raw_output/);
  assert.match(result.stdout, /validator_result/);
});

test("gov finalize-run reads required stage coverage from gates.yaml", () => {
  const cwd = tmp();
  run(["init", "--case", "pipeline3"], cwd);
  const gates = path.join(cwd, ".governance", "cases", "pipeline3", "gates.yaml");
  fs.writeFileSync(gates, [
    "required_stage_coverage:",
    "  per_final_section:",
    "    - final_markdown",
    "machine_gates:",
    "  - id: validator_passed",
    "    status: open",
    "human_gates:",
    "  - id: release_approval",
    "    status: open",
    "",
  ].join("\n"));
  const manifest = path.join(cwd, "manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ artifact_hash: "fresh-hash" }));
  run(["record-run", "--case", "pipeline3", "--run", "run1", "--manifest", manifest], cwd);
  const payload = path.join(cwd, "stage.json");
  fs.writeFileSync(payload, JSON.stringify({ artifact_hash: "fresh-hash", output_hash: "fresh-hash" }));
  run(["record-stage", "--case", "pipeline3", "--run", "run1", "--section", "intro", "--stage", "final_markdown", "--payload", payload], cwd);
  const result = run(["finalize-run", "--case", "pipeline3", "--run", "run1", "--artifact-hash", "fresh-hash"], cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RUN_FINALIZED/);
});

test("gov finalize-run closes eligible machine gates from matching validator and review stages", () => {
  const cwd = tmp();
  run(["init", "--case", "pipeline3"], cwd);
  const manifest = path.join(cwd, "manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ artifact_hash: "fresh-hash" }));
  run(["record-run", "--case", "pipeline3", "--run", "run1", "--manifest", manifest], cwd);

  const provider = path.join(cwd, "provider.json");
  fs.writeFileSync(provider, JSON.stringify({ output_hash: "provider-hash" }));
  assert.equal(run(["record-stage", "--case", "pipeline3", "--run", "run1", "--section", "intro", "--stage", "provider_raw_output", "--payload", provider], cwd).status, 0);

  const final = path.join(cwd, "final.json");
  fs.writeFileSync(final, JSON.stringify({ artifact_hash: "fresh-hash", output_hash: "fresh-hash" }));
  assert.equal(run(["record-stage", "--case", "pipeline3", "--run", "run1", "--section", "intro", "--stage", "final_markdown", "--payload", final], cwd).status, 0);

  const validator = path.join(cwd, "validator.json");
  fs.writeFileSync(validator, JSON.stringify({ artifact_hash: "fresh-hash", validator_passed: true, preview_issues: 0, quality_issue_codes: [] }));
  assert.equal(run(["record-stage", "--case", "pipeline3", "--run", "run1", "--section", "intro", "--stage", "validator_result", "--payload", validator], cwd).status, 0);

  const review = path.join(cwd, "review.json");
  fs.writeFileSync(review, JSON.stringify({
    artifact_hash: "fresh-hash",
    review_passed: true,
    evidence_level: "L4",
    profile_email: "shareoblee001@gmail.com",
    profile_evidence_timestamp_utc: new Date().toISOString(),
  }));
  assert.equal(run(["record-stage", "--case", "pipeline3", "--run", "run1", "--section", "intro", "--stage", "external_review_result", "--payload", review], cwd).status, 0);

  const finalized = run(["finalize-run", "--case", "pipeline3", "--run", "run1", "--artifact-hash", "fresh-hash"], cwd);
  assert.equal(finalized.status, 0, finalized.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(cwd, ".governance", "cases", "pipeline3", "state.generated.json"), "utf8"));
  assert.equal(state.closed_gates.includes("validator_passed"), true);
  assert.equal(state.closed_gates.includes("preview_issues_zero"), true);
  assert.equal(state.closed_gates.includes("gpt_pro_review_passed"), true);
  assert.equal(state.freshness_status.status, "fresh");
});

test("gov finalize-run closes custom machine gates from gates.yaml rules", () => {
  const cwd = tmp();
  run(["init", "--case", "pipeline3"], cwd);
  const gates = path.join(cwd, ".governance", "cases", "pipeline3", "gates.yaml");
  fs.writeFileSync(gates, [
    "required_stage_coverage:",
    "  per_final_section:",
    "    - final_markdown",
    "machine_gates:",
    "  - id: custom_review_green",
    "    status: open",
    "    source_stage: external_review_result",
    "    evidence_level_required: L4",
    "    artifact_hash_required: true",
    "    profile_email_required: shareoblee001@gmail.com",
    "    profile_evidence_max_age_minutes: 60",
    "    pass_if:",
    "      all:",
    "        - field: status",
    "          in: [approved]",
    "human_gates:",
    "  - id: release_approval",
    "    status: open",
    "",
  ].join("\n"));
  const manifest = path.join(cwd, "manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ artifact_hash: "fresh-hash" }));
  run(["record-run", "--case", "pipeline3", "--run", "run1", "--manifest", manifest], cwd);
  const final = path.join(cwd, "final.json");
  fs.writeFileSync(final, JSON.stringify({ artifact_hash: "fresh-hash", output_hash: "fresh-hash" }));
  run(["record-stage", "--case", "pipeline3", "--run", "run1", "--section", "intro", "--stage", "final_markdown", "--payload", final], cwd);
  const review = path.join(cwd, "review.json");
  fs.writeFileSync(review, JSON.stringify({
    artifact_hash: "fresh-hash",
    status: "approved",
    evidence_level: "L4",
    profile_email: "shareoblee001@gmail.com",
    profile_evidence_timestamp_utc: new Date().toISOString(),
  }));
  run(["record-stage", "--case", "pipeline3", "--run", "run1", "--section", "intro", "--stage", "external_review_result", "--payload", review], cwd);
  const finalized = run(["finalize-run", "--case", "pipeline3", "--run", "run1", "--artifact-hash", "fresh-hash"], cwd);
  assert.equal(finalized.status, 0, finalized.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(cwd, ".governance", "cases", "pipeline3", "state.generated.json"), "utf8"));
  assert.equal(state.closed_gates.includes("custom_review_green"), true);
});

test("gov close-gate requires signed L5 human approval artifacts", () => {
  const cwd = tmp();
  run(["init", "--case", "pipeline3"], cwd);
  const bad = path.join(cwd, "bad-approval.json");
  fs.writeFileSync(bad, JSON.stringify({ case_id: "pipeline3", gate_id: "release_approval", evidence_level: "L0" }));
  const blocked = run(["close-gate", "--case", "pipeline3", "--gate", "release_approval", "--approval", bad], cwd);
  assert.equal(blocked.status, 2);
  assert.match(blocked.stdout, /MISSING_HUMAN_GATE/);

  const good = path.join(cwd, "approval.json");
  fs.writeFileSync(good, JSON.stringify({
    case_id: "pipeline3",
    gate_id: "release_approval",
    approved_by: "human-operator",
    signed_at: new Date().toISOString(),
    statement: "Release approved for this governance case.",
    evidence_level: "L5",
    signature: "signed:release_approval:test",
  }));
  const closed = run(["close-gate", "--case", "pipeline3", "--gate", "release_approval", "--approval", good], cwd);
  assert.equal(closed.status, 0, closed.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(cwd, ".governance", "cases", "pipeline3", "state.generated.json"), "utf8"));
  assert.equal(state.closed_gates.includes("release_approval"), true);
});

test("gov sync-linear generates a packet without treating Linear as authority", () => {
  const cwd = tmp();
  run(["init", "--case", "pipeline3"], cwd);
  const result = run(["sync-linear", "--case", "pipeline3"], cwd);
  assert.equal(result.status, 0, result.stderr);
  const packet = fs.readFileSync(path.join(cwd, ".governance", "cases", "pipeline3", "linear_packet.generated.md"), "utf8");
  assert.match(packet, /Linear is not an approval surface/);
});
