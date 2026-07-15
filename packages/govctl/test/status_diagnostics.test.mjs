import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadState } from "../../govd/dist/index.js";

const diagnostics = await import("../dist/commands/diagnostics.js");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const govctl = path.resolve(__dirname, "../dist/index.js");

function makeSourceFixture(files = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "govruntime-status-diagnostics-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(cwd, ".governance", relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, "utf8");
  }
  return cwd;
}

function runGovctl(args, cwd) {
  return childProcess.spawnSync(process.execPath, [govctl, ...args, "--cwd", cwd], {
    encoding: "utf8",
  });
}

test("classifies snapshot consistency from inventory and trace without timing", () => {
  assert.equal(typeof diagnostics.compareSnapshot, "function");
  const inventory = {
    governance_dir_exists: true,
    governance_dir_usable: true,
    files: [{ path: "cases/CASE-ONE.yaml", fingerprint: "sha256:before" }],
    truncated: false,
    error: null,
  };
  const matchingTrace = [
    { path: "current.json", outcome: "missing", fingerprint: null },
    { path: "constitution.yaml", outcome: "missing", fingerprint: null },
    { path: "constitution.json", outcome: "missing", fingerprint: null },
    { path: "cases/CASE-ONE.yaml", outcome: "loaded", fingerprint: "sha256:before" },
    { path: "branches/branch_ledger.yaml", outcome: "missing", fingerprint: null },
    { path: "branches/branch_ledger.json", outcome: "missing", fingerprint: null },
  ];

  assert.equal(diagnostics.compareSnapshot(inventory, matchingTrace), "consistent");
  assert.equal(
    diagnostics.compareSnapshot(inventory, matchingTrace.map((event) =>
      event.path === "cases/CASE-ONE.yaml" ? { ...event, fingerprint: "sha256:after" } : event
    )),
    "changed"
  );
  assert.equal(diagnostics.compareSnapshot(inventory, []), "changed");
  assert.equal(
    diagnostics.compareSnapshot({ ...inventory, files: [] }, []),
    "changed"
  );
  assert.equal(
    diagnostics.compareSnapshot(inventory, [
      ...matchingTrace,
      { path: "cases/new.yaml", outcome: "missing", fingerprint: null },
    ]),
    "changed"
  );
  assert.equal(diagnostics.compareSnapshot({ ...inventory, truncated: true }, matchingTrace), "unknown");
  assert.equal(diagnostics.compareSnapshot({ ...inventory, error: "scan failed" }, matchingTrace), "unknown");
});

test("builds invalid-source diagnostics from the traced loader pass without reparsing", () => {
  assert.equal(typeof diagnostics.captureGovernanceInventory, "function");
  const invalidCase = "{ not valid json\n";
  const cwd = makeSourceFixture({
    "cases/valid.yaml": "case_id: CASE-VALID\nstatus: open\n",
    "cases/invalid.json": invalidCase,
  });
  const inventory = diagnostics.captureGovernanceInventory(cwd);
  const trace = [];
  const state = loadState(cwd, { onSourceRead: (event) => trace.push(event) });
  fs.writeFileSync(
    path.join(cwd, ".governance", "cases", "invalid.json"),
    JSON.stringify({ case_id: "CASE-AFTER-LOAD", status: "open" }),
    "utf8"
  );

  const debug = diagnostics.buildStateDebug(cwd, state, inventory, trace);

  assert.equal(debug.snapshot, "consistent");
  assert.deepEqual(debug.files_read, ["cases/invalid.json", "cases/valid.yaml"]);
  assert.match(debug.ignored_or_unsupported.join("\n"), /cases\/invalid\.json.*read but did not yield state/);
  assert.equal(state.cases.some((item) => item.case_id === "CASE-AFTER-LOAD"), false);
});

test("prints snapshot diagnostics only for debug status while preserving current file lists", () => {
  const cwd = makeSourceFixture({
    "cases/CASE-CLI.yaml": "case_id: CASE-CLI\nstatus: open\n",
    "tickets/T-CLI-R1.yaml": "ticket_id: T-CLI-R1\ncase_id: CASE-CLI\nstatus: in_progress\n",
  });

  const debug = runGovctl(["status", "--debug-state"], cwd);
  assert.equal(debug.status, 0, debug.stderr);
  assert.match(debug.stdout, /Debug State/);
  assert.match(debug.stdout, /Snapshot:\s+consistent/);
  assert.match(debug.stdout, /Files present:/);
  assert.match(debug.stdout, /cases\/CASE-CLI\.yaml/);
  assert.match(debug.stdout, /Files read:/);
  assert.match(debug.stdout, /tickets\/T-CLI-R1\.yaml/);

  const regular = runGovctl(["status"], cwd);
  assert.equal(regular.status, 0, regular.stderr);
  assert.match(regular.stdout, /CASE-CLI/);
  assert.doesNotMatch(regular.stdout, /Debug State|Snapshot:|Files present:|Files read:/);
});
