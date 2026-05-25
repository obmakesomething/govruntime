import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendLedgerRecord,
  canonicalJson,
  createAuditCheckpoint,
  headPath,
  ledgerPath,
  readAuditHead,
  verifyAuditLedger,
} from "../dist/index.js";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "govruntime-audit-"));
}

test("canonical JSON uses stable key ordering", () => {
  const a = { b: 2, a: { d: 4, c: 3 }, list: [{ z: 1, y: 2 }] };
  const b = { list: [{ y: 2, z: 1 }], a: { c: 3, d: 4 }, b: 2 };
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test("appendLedgerRecord creates seq 1 from genesis", () => {
  const cwd = tmp();
  const env = appendLedgerRecord(cwd, "audit_event", "rec-1", { ok: true }, { actor: "system" });
  const head = readAuditHead(cwd);
  assert.equal(env.seq, 1);
  assert.equal(env.prev_hash, "sha256:genesis");
  assert.equal(head.last_seq, 1);
  assert.equal(head.last_hash, env.entry_hash);
});

test("multiple appends form a valid hash chain", () => {
  const cwd = tmp();
  const first = appendLedgerRecord(cwd, "audit_event", "rec-1", { n: 1 }, { actor: "system" });
  const second = appendLedgerRecord(cwd, "judgment", "rec-2", { n: 2 }, { actor: "hook" });
  assert.equal(second.seq, 2);
  assert.equal(second.prev_hash, first.entry_hash);
  assert.equal(verifyAuditLedger(cwd).ok, true);
});

test("verify fails when payload is modified", () => {
  const cwd = tmp();
  appendLedgerRecord(cwd, "audit_event", "rec-1", { n: 1 }, { actor: "system" });
  const line = fs.readFileSync(ledgerPath(cwd), "utf8").trim();
  const env = JSON.parse(line);
  env.payload.n = 99;
  fs.writeFileSync(ledgerPath(cwd), JSON.stringify(env) + "\n", "utf8");
  const result = verifyAuditLedger(cwd);
  assert.equal(result.ok, false);
  assert.match(result.failure.reason, /payload hash/i);
});

test("verify fails when a line is deleted", () => {
  const cwd = tmp();
  appendLedgerRecord(cwd, "audit_event", "rec-1", { n: 1 }, { actor: "system" });
  appendLedgerRecord(cwd, "audit_event", "rec-2", { n: 2 }, { actor: "system" });
  const lines = fs.readFileSync(ledgerPath(cwd), "utf8").trim().split("\n");
  fs.writeFileSync(ledgerPath(cwd), lines.slice(1).join("\n") + "\n", "utf8");
  const result = verifyAuditLedger(cwd);
  assert.equal(result.ok, false);
  assert.match(result.failure.reason, /sequence/i);
});

test("verify fails when records are reordered", () => {
  const cwd = tmp();
  appendLedgerRecord(cwd, "audit_event", "rec-1", { n: 1 }, { actor: "system" });
  appendLedgerRecord(cwd, "audit_event", "rec-2", { n: 2 }, { actor: "system" });
  const lines = fs.readFileSync(ledgerPath(cwd), "utf8").trim().split("\n");
  fs.writeFileSync(ledgerPath(cwd), lines.reverse().join("\n") + "\n", "utf8");
  const result = verifyAuditLedger(cwd);
  assert.equal(result.ok, false);
});

test("verify detects head mismatch", () => {
  const cwd = tmp();
  appendLedgerRecord(cwd, "audit_event", "rec-1", { n: 1 }, { actor: "system" });
  const head = readAuditHead(cwd);
  head.last_hash = "sha256:bad";
  fs.writeFileSync(headPath(cwd), JSON.stringify(head, null, 2), "utf8");
  const result = verifyAuditLedger(cwd);
  assert.equal(result.ok, false);
  assert.match(result.failure.reason, /head hash/i);
});

test("checkpoint writes current tip hash", () => {
  const cwd = tmp();
  const env = appendLedgerRecord(cwd, "audit_event", "rec-1", { n: 1 }, { actor: "system" });
  const checkpoint = createAuditCheckpoint(cwd);
  assert.equal(checkpoint.to_seq, 1);
  assert.equal(checkpoint.tip_hash, env.entry_hash);
  assert.equal(checkpoint.signature, null);
  assert.equal(fs.existsSync(path.join(cwd, ".governance", "audit", "checkpoints", "checkpoint-1.json")), true);
});
