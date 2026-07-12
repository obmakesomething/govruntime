import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const govctl = path.resolve(__dirname, "../dist/index.js");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "govruntime-id-concurrency-"));
}

function run(args, cwd) {
  return childProcess.spawnSync(process.execPath, [govctl, ...args, "--cwd", cwd], {
    encoding: "utf8",
  });
}

function runAsync(args, cwd) {
  return new Promise((resolve) => {
    const child = childProcess.spawn(process.execPath, [govctl, ...args, "--cwd", cwd], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("parallel evidence CLI processes allocate unique IDs and preserve the audit chain", async () => {
  const cwd = tmp();
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    runAsync(["evidence", "admit", "--quote", `parallel-${index}`, "--claim", `parallel-${index}`], cwd)));

  for (const result of results) assert.equal(result.status, 0, result.stderr);

  const evidencePath = path.join(cwd, ".governance", "evidence", "evidence.jsonl");
  const evidence = fs.readFileSync(evidencePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const ids = evidence.map((record) => record.evidence_id);
  assert.equal(ids.length, 8);
  assert.equal(new Set(ids).size, 8);
  assert.deepEqual(
    ids.map((id) => Number.parseInt(id.slice(-3), 10)).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );

  const verify = run(["audit", "verify"], cwd);
  assert.equal(verify.status, 0, verify.stdout + verify.stderr);
  assert.match(verify.stdout, /Audit ledger verified: 8 entries/);
});

test("case create does not overwrite a prior case with the same label", () => {
  const cwd = tmp();
  const first = run(["case", "create", "--title", "First case", "--label", "SAME"], cwd);
  const second = run(["case", "create", "--title", "Second case", "--label", "SAME"], cwd);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);

  const casesPath = path.join(cwd, ".governance", "cases");
  const caseFiles = fs.readdirSync(casesPath).filter((name) => name.endsWith(".yaml")).sort();
  assert.equal(caseFiles.length, 2);
  assert.match(caseFiles[0], /^CASE-\d{4}-\d{2}-\d{2}-001-SAME\.yaml$/);
  assert.match(caseFiles[1], /^CASE-\d{4}-\d{2}-\d{2}-002-SAME\.yaml$/);
});
