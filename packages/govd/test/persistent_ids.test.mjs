import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const idsModuleUrl = pathToFileURL(path.resolve(__dirname, "../dist/state/ids.js")).href;
const govdModuleUrl = pathToFileURL(path.resolve(__dirname, "../dist/index.js")).href;
const workerSource = `
  import {
    newCaseId,
    newConflictId,
    newDecisionId,
    newDocketEventId,
    newEvidenceId,
    newInvariantId,
    newJudgmentId,
    newSimulationId,
  } from ${JSON.stringify(idsModuleUrl)};

  const cwd = process.env.GOVRUNTIME_TEST_CWD;
  const kind = process.env.GOVRUNTIME_TEST_KIND;
  const label = process.env.GOVRUNTIME_TEST_LABEL;
  if (process.env.GOVRUNTIME_TEST_CLOCK_FLIP === "1") {
    const RealDate = globalThis.Date;
    let calls = 0;
    globalThis.Date = class extends RealDate {
      constructor(...args) {
        if (args.length > 0) {
          super(...args);
          return;
        }
        super(calls++ === 0 ? "2026-07-12T23:59:59.999Z" : "2026-07-13T00:00:00.000Z");
      }
    };
  }
  const allocators = {
    CASE: newCaseId,
    CON: newConflictId,
    DEC: newDecisionId,
    DCK: newDocketEventId,
    EV: newEvidenceId,
    INV: newInvariantId,
    JDG: newJudgmentId,
    SIM: newSimulationId,
  };
  const allocator = allocators[kind];
  if (!cwd || !allocator) throw new Error("missing allocator test input");
  process.stdout.write(kind === "CASE" ? allocator(cwd, label || undefined) : allocator(cwd));
`;

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "govruntime-persistent-ids-"));
}

function allocate(cwd, kind, options = {}) {
  return childProcess.spawnSync(process.execPath, ["--input-type=module", "--eval", workerSource], {
    encoding: "utf8",
    timeout: options.timeoutMs,
    env: {
      ...process.env,
      GOVRUNTIME_TEST_CWD: cwd,
      GOVRUNTIME_TEST_KIND: kind,
      GOVRUNTIME_TEST_CLOCK_FLIP: options.clockFlip ? "1" : "0",
      GOVRUNTIME_TEST_LABEL: options.label ?? "",
    },
  });
}

function allocateOk(cwd, kind) {
  const result = allocate(cwd, kind);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("all persistent entity ID kinds advance across fresh processes", () => {
  const cwd = tmp();
  const date = new Date().toISOString().slice(0, 10);

  for (const kind of ["EV", "DCK", "CON", "JDG", "SIM", "CASE", "DEC", "INV"]) {
    assert.equal(allocateOk(cwd, kind), `${kind}-${date}-001`);
    assert.equal(allocateOk(cwd, kind), `${kind}-${date}-002`);
  }
});

test("labeled case IDs still reserve unique persistent sequences", () => {
  const cwd = tmp();
  const date = new Date().toISOString().slice(0, 10);
  const first = allocate(cwd, "CASE", { label: "FGA KYUL" });
  const second = allocate(cwd, "CASE", { label: "FGA KYUL" });

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout.trim(), `CASE-${date}-001-FGA-KYUL`);
  assert.equal(second.stdout.trim(), `CASE-${date}-002-FGA-KYUL`);
});

test("allocator seeds a missing high-water mark from legacy persisted records", () => {
  const cwd = tmp();
  const date = new Date().toISOString().slice(0, 10);
  const evidencePath = path.join(cwd, ".governance", "evidence", "evidence.jsonl");
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify({ evidence_id: `EV-${date}-007` })}\n`, "utf8");

  assert.equal(allocateOk(cwd, "EV"), `EV-${date}-008`);
});

test("allocator honors a reserved high-water mark even when a crash left a gap", () => {
  const cwd = tmp();
  const date = new Date().toISOString().slice(0, 10);
  const statePath = path.join(cwd, ".governance", "audit", "id-sequences.json");
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    version: "gr.id-sequences.v1",
    sequences: { [`EV-${date}`]: 4 },
  }), "utf8");

  assert.equal(allocateOk(cwd, "EV"), `EV-${date}-005`);
});

test("allocator fails closed when persisted sequence state is malformed", () => {
  const cwd = tmp();
  const statePath = path.join(cwd, ".governance", "audit", "id-sequences.json");
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, "{not-json", "utf8");

  const result = allocate(cwd, "EV");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /malformed governance ID sequence state/i);
});

test("allocator preserves a dead-owner lock and fails closed for verified recovery", () => {
  const cwd = tmp();
  const lockPath = path.join(cwd, ".governance", "audit", ".locks", "id-sequences.lock");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    version: "gr.lock.v1",
    token: "dead-owner",
    pid: 2_147_483_647,
    hostname: os.hostname(),
    created_at: "2026-07-12T00:00:00.000Z",
  }), "utf8");

  const result = allocate(cwd, "EV", { timeoutMs: 2_000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stale governance lock requires verified recovery/i);
  assert.equal(fs.existsSync(lockPath), true);
});

test("allocator preserves a partial lock record and fails closed instead of hanging", () => {
  const cwd = tmp();
  const lockPath = path.join(cwd, ".governance", "audit", ".locks", "id-sequences.lock");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, "{", "utf8");
  const old = new Date(Date.now() - 10_000);
  fs.utimesSync(lockPath, old, old);

  const result = allocate(cwd, "EV", { timeoutMs: 2_000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /malformed governance lock requires verified recovery/i);
  assert.equal(fs.existsSync(lockPath), true);
});

test("one allocation uses one date for both the emitted ID and sequence key", () => {
  const cwd = tmp();
  const result = allocate(cwd, "EV", { clockFlip: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "EV-2026-07-12-001");

  const statePath = path.join(cwd, ".governance", "audit", "id-sequences.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(state.sequences["EV-2026-07-12"], 1);
  assert.equal(state.sequences["EV-2026-07-13"], undefined);
});

test("persistent domain creators use cwd-backed IDs and leave a valid audit chain", async () => {
  const cwd = tmp();
  const {
    admitUserStatement,
    createInvariant,
    detectMissingGovernanceContext,
    judgeCompletion,
    loadState,
    recordDecision,
    recordDocketEvent,
    verifyAuditLedger,
  } = await import(govdModuleUrl);

  const evidence = admitUserStatement(cwd, {
    quote: "operator statement",
    claims: [{ claim: "operator statement", confidence: 1 }],
  });
  const decision = recordDecision(cwd, { title: "Persist IDs" });
  const invariant = createInvariant(cwd, { name: "persistent-ids" });
  const docket = recordDocketEvent(cwd, {
    case_id: "CASE-TEST",
    event_type: "session_started",
    actor: "system",
    reason: "test",
  });
  const conflict = detectMissingGovernanceContext(null, null, cwd)[0];
  const judgment = judgeCompletion(loadState(cwd));

  assert.match(evidence.evidence_id, /^EV-\d{4}-\d{2}-\d{2}-001$/);
  assert.match(decision.decision_id, /^DEC-\d{4}-\d{2}-\d{2}-001$/);
  assert.match(invariant.invariant_id, /^INV-\d{4}-\d{2}-\d{2}-001$/);
  assert.match(docket.event_id, /^DCK-\d{4}-\d{2}-\d{2}-001$/);
  assert.match(conflict.conflict_id, /^CON-\d{4}-\d{2}-\d{2}-001$/);
  assert.match(judgment.judgment_id, /^JDG-\d{4}-\d{2}-\d{2}-001$/);
  assert.equal(verifyAuditLedger(cwd).ok, true);
});
