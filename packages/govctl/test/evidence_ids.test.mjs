import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const govctl = path.resolve(__dirname, "../dist/index.js");

function run(args, cwd) {
  return childProcess.spawnSync(process.execPath, [govctl, ...args, "--cwd", cwd], {
    encoding: "utf8",
  });
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "govruntime-evidence-ids-"));
}

function readEvidence(cwd) {
  const filePath = path.join(cwd, ".governance", "evidence", "evidence.jsonl");
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("govctl evidence admit allocates unique ids across CLI processes", () => {
  const cwd = tmp();
  const first = run(["evidence", "admit", "--quote", "first", "--claim", "first"], cwd);
  assert.equal(first.status, 0, first.stderr);

  const second = run(["evidence", "admit", "--quote", "second", "--claim", "second"], cwd);
  assert.equal(second.status, 0, second.stderr);

  const evidence = readEvidence(cwd);
  assert.equal(evidence.length, 2);
  assert.notEqual(evidence[0].evidence_id, evidence[1].evidence_id);
  assert.match(evidence[0].evidence_id, /^EV-\d{4}-\d{2}-\d{2}-001$/);
  assert.match(evidence[1].evidence_id, /^EV-\d{4}-\d{2}-\d{2}-002$/);
});
