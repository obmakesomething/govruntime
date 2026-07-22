import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const govctl = path.resolve(__dirname, "../dist/index.js");
const govdModuleUrl = pathToFileURL(path.resolve(__dirname, "../../govd/dist/index.js")).href;

function run(args, cwd) {
  return childProcess.spawnSync(process.execPath, [govctl, ...args, "--cwd", cwd], {
    encoding: "utf8",
    timeout: 10_000,
  });
}

function runAsync(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(process.execPath, [govctl, ...args, "--cwd", cwd], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`govctl timed out: ${args.join(" ")}`));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function runPausedAtBranchLedgerRename(args, cwd, readyPath, releasePath) {
  const ledgerPath = governancePath(cwd, "branches", "branch_ledger.yaml");
  const code = `
    import fs from "node:fs";
    import path from "node:path";
    import { syncBuiltinESMExports } from "node:module";
    const target = path.resolve(${JSON.stringify(ledgerPath)});
    const readyPath = ${JSON.stringify(readyPath)};
    const originalRename = fs.renameSync.bind(fs);
    let paused = false;
    fs.renameSync = (from, to) => {
      if (!paused && path.resolve(to) === target) {
        paused = true;
        fs.writeFileSync(readyPath, "ready\\n", "utf8");
        const sleeper = new Int32Array(new SharedArrayBuffer(4));
        while (!fs.existsSync(${JSON.stringify(releasePath)})) Atomics.wait(sleeper, 0, 0, 10);
      }
      return originalRename(from, to);
    };
    syncBuiltinESMExports();
    process.argv = ${JSON.stringify([process.execPath, govctl, ...args, "--cwd", cwd])};
    await import(${JSON.stringify(pathToFileURL(govctl).href)} + "?paused=" + Date.now());
  `;
  const child = childProcess.spawn(process.execPath, ["--input-type=module", "--eval", code], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return captureChild(child, `paused govctl ${args.join(" ")}`);
}

function runObservedBranchCreate(args, cwd, lockAttemptPath, ledgerWritePath) {
  const ledgerPath = governancePath(cwd, "branches", "branch_ledger.yaml");
  const lockPath = governancePath(cwd, "branches", ".locks", "branch-ledger.lock");
  const code = `
    import fs from "node:fs";
    import path from "node:path";
    import { syncBuiltinESMExports } from "node:module";
    const ledgerTarget = path.resolve(${JSON.stringify(ledgerPath)});
    const lockTarget = path.resolve(${JSON.stringify(lockPath)});
    const originalOpen = fs.openSync.bind(fs);
    const originalRename = fs.renameSync.bind(fs);
    fs.openSync = (filePath, ...rest) => {
      if (typeof filePath === "string" && path.resolve(filePath) === lockTarget) {
        fs.writeFileSync(${JSON.stringify(lockAttemptPath)}, "attempted\\n", "utf8");
      }
      return originalOpen(filePath, ...rest);
    };
    fs.renameSync = (from, to) => {
      const result = originalRename(from, to);
      if (typeof to === "string" && path.resolve(to) === ledgerTarget) {
        fs.writeFileSync(${JSON.stringify(ledgerWritePath)}, "written\\n", "utf8");
      }
      return result;
    };
    syncBuiltinESMExports();
    process.argv = ${JSON.stringify([process.execPath, govctl, ...args, "--cwd", cwd])};
    await import(${JSON.stringify(pathToFileURL(govctl).href)} + "?observed=" + Date.now());
  `;
  const child = childProcess.spawn(process.execPath, ["--input-type=module", "--eval", code], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return captureChild(child, `observed govctl ${args.join(" ")}`);
}

function captureChild(child, label) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${label} timed out`));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

async function waitForFile(filePath, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForEither(firstPath, secondPath, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (fs.existsSync(firstPath)) return firstPath;
    if (fs.existsSync(secondPath)) return secondPath;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${firstPath} or ${secondPath}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function expectOk(result, label) {
  assert.equal(result.status, 0, `${label}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

function readYaml(filePath) {
  return yaml.load(fs.readFileSync(filePath, "utf8"));
}

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function governancePath(cwd, ...parts) {
  return path.join(cwd, ".governance", ...parts);
}

function snapshotMutationFiles(cwd) {
  const paths = [
    governancePath(cwd, "branches", "branch_ledger.yaml"),
    governancePath(cwd, "docket", "docket_events.jsonl"),
    governancePath(cwd, "audit", "ledger.jsonl"),
    governancePath(cwd, "audit", "head.json"),
    governancePath(cwd, "audit", "id-sequences.json"),
    path.join(cwd, ".cursorrules"),
    path.join(cwd, ".clinerules"),
    path.join(cwd, ".github", "copilot-instructions.md"),
    path.join(cwd, "CLAUDE.md"),
  ];
  return Object.fromEntries(paths.map((filePath) => [filePath, fs.readFileSync(filePath, "utf8")]));
}

function assertSnapshotUnchanged(before) {
  for (const [filePath, content] of Object.entries(before)) {
    assert.equal(fs.readFileSync(filePath, "utf8"), content, filePath);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function abandonArgs(oldBranch, reason, successorBranch) {
  return [
    "branch",
    "abandon",
    oldBranch,
    "--reason",
    reason,
    "--successor",
    successorBranch,
  ];
}

function abandonmentEvents(cwd, branch) {
  return readJsonl(governancePath(cwd, "docket", "docket_events.jsonl")).filter(
    (event) => event.event_type === "branch_abandoned" && event.affected_branches?.includes(branch),
  );
}

function matchingAuditRecords(cwd, eventId) {
  return readJsonl(governancePath(cwd, "audit", "ledger.jsonl")).filter(
    (entry) => entry.stream === "docket" && entry.record_id === eventId,
  );
}

function setup(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "govruntime-branch-abandon-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  expectOk(run(["init"], cwd), "init");
  expectOk(
    run(["case", "create", "--title", "Branch abandon contract", "--label", "BRANCH"], cwd),
    "case create",
  );
  expectOk(
    run([
      "ticket",
      "create",
      "--title",
      "Branch abandon contract",
      "--objective",
      "Close a superseded branch without losing history",
      "--area",
      "BRANCH",
      "--seq",
      "1",
    ], cwd),
    "ticket create",
  );
  expectOk(run(["branch", "create", "--purpose", "old-attempt"], cwd), "old branch create");
  expectOk(run(["branch", "create", "--purpose", "successor-attempt"], cwd), "successor branch create");

  const ledger = readYaml(governancePath(cwd, "branches", "branch_ledger.yaml"));
  const oldBranch = ledger.branches.find((entry) => entry.branch.endsWith("/old-attempt")).branch;
  const successorBranch = ledger.branches.find((entry) => entry.branch.endsWith("/successor-attempt")).branch;
  return { cwd, oldBranch, successorBranch };
}

test("branch abandon records one transition, syncs posture, and exact retry is byte-idempotent", (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const docketPath = governancePath(cwd, "docket", "docket_events.jsonl");
  const auditPath = governancePath(cwd, "audit", "ledger.jsonl");
  const docketCountBefore = readJsonl(docketPath).length;
  const auditCountBefore = readJsonl(auditPath).length;
  const reason = "Superseded by the corrected implementation branch";

  const abandoned = run([
    "branch",
    "abandon",
    oldBranch,
    "--reason",
    reason,
    "--successor",
    successorBranch,
  ], cwd);
  expectOk(abandoned, "branch abandon");

  const ledger = readYaml(governancePath(cwd, "branches", "branch_ledger.yaml"));
  const oldEntry = ledger.branches.find((entry) => entry.branch === oldBranch);
  const successorEntry = ledger.branches.find((entry) => entry.branch === successorBranch);
  assert.equal(oldEntry.status, "abandoned");
  assert.match(oldEntry.abandoned_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(successorEntry.status, "active");

  const docket = readJsonl(docketPath);
  assert.equal(docket.length, docketCountBefore + 1);
  const event = docket.at(-1);
  assert.equal(event.event_type, "branch_abandoned");
  assert.equal(event.reason, reason);
  assert.equal(event.status_before, "active");
  assert.equal(event.status_after, "abandoned");
  assert.deepEqual(event.affected_branches, [oldBranch]);
  assert.equal(event.metadata.successor_branch, successorBranch);

  const audit = readJsonl(auditPath);
  assert.equal(audit.length, auditCountBefore + 1);
  assert.equal(audit.at(-1).stream, "docket");
  assert.equal(audit.at(-1).record_id, event.event_id);

  const activeList = run(["branch", "list", "--status", "active"], cwd);
  expectOk(activeList, "active branch list");
  assert.doesNotMatch(activeList.stdout, new RegExp(escapeRegExp(oldBranch)));
  assert.match(activeList.stdout, new RegExp(escapeRegExp(successorBranch)));

  const status = run(["status"], cwd);
  expectOk(status, "status");
  assert.match(status.stdout, new RegExp(escapeRegExp(successorBranch)));
  assert.ok(
    fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8").includes(`**Branch**: \`${successorBranch}\``),
    "synced agent posture should point at the successor branch",
  );

  const afterFirst = snapshotMutationFiles(cwd);
  const retry = run([
    "branch",
    "abandon",
    oldBranch,
    "--reason",
    reason,
    "--successor",
    successorBranch,
  ], cwd);
  expectOk(retry, "exact abandon retry");
  assert.match(retry.stdout, /already abandoned/i);
  assertSnapshotUnchanged(afterFirst);

  const conflictingRetry = run([
    "branch",
    "abandon",
    oldBranch,
    "--reason",
    "A different reason",
    "--successor",
    successorBranch,
  ], cwd);
  assert.equal(conflictingRetry.status, 1, conflictingRetry.stderr);
  assert.match(`${conflictingRetry.stdout}\n${conflictingRetry.stderr}`, /conflict/i);
  assertSnapshotUnchanged(afterFirst);
});

test("branch abandon rejects missing targets and invalid successors with zero mutation", (t) => {
  const { cwd, oldBranch } = setup(t);
  const before = snapshotMutationFiles(cwd);

  const missing = run([
    "branch",
    "abandon",
    "gov/CASE-MISSING/T-MISSING-R1/missing",
    "--reason",
    "Missing target must fail",
  ], cwd);
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(`${missing.stdout}\n${missing.stderr}`, /not found/i);
  assertSnapshotUnchanged(before);

  const selfSuccessor = run([
    "branch",
    "abandon",
    oldBranch,
    "--reason",
    "Self successor must fail",
    "--successor",
    oldBranch,
  ], cwd);
  assert.equal(selfSuccessor.status, 1, selfSuccessor.stderr);
  assert.match(`${selfSuccessor.stdout}\n${selfSuccessor.stderr}`, /successor/i);
  assertSnapshotUnchanged(before);

  const missingSuccessor = run([
    "branch",
    "abandon",
    oldBranch,
    "--reason",
    "Missing successor must fail",
    "--successor",
    "gov/CASE-MISSING/T-MISSING-R1/missing-successor",
  ], cwd);
  assert.equal(missingSuccessor.status, 1, missingSuccessor.stderr);
  assert.match(`${missingSuccessor.stdout}\n${missingSuccessor.stderr}`, /successor/i);
  assertSnapshotUnchanged(before);
});

test("branch abandon rejects duplicate ledger identities before writing", (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const ledgerPath = governancePath(cwd, "branches", "branch_ledger.yaml");
  const ledger = readYaml(ledgerPath);
  const duplicate = { ...ledger.branches.find((entry) => entry.branch === oldBranch) };
  ledger.branches.push(duplicate);
  fs.writeFileSync(ledgerPath, yaml.dump(ledger, { indent: 2, lineWidth: 120, noRefs: true }));
  const before = snapshotMutationFiles(cwd);

  const result = run([
    "branch",
    "abandon",
    oldBranch,
    "--reason",
    "Duplicate identity must fail",
    "--successor",
    successorBranch,
  ], cwd);
  assert.equal(result.status, 1, result.stderr);
  assert.match(`${result.stdout}\n${result.stderr}`, /duplicate/i);
  assertSnapshotUnchanged(before);
});

test("concurrent exact abandon requests serialize to one event", async (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const reason = "Concurrent retry must remain idempotent";
  const args = [
    "branch",
    "abandon",
    oldBranch,
    "--reason",
    reason,
    "--successor",
    successorBranch,
  ];
  const docketPath = governancePath(cwd, "docket", "docket_events.jsonl");
  const auditPath = governancePath(cwd, "audit", "ledger.jsonl");
  const docketCountBefore = readJsonl(docketPath).length;
  const auditCountBefore = readJsonl(auditPath).length;

  const results = await Promise.all([runAsync(args, cwd), runAsync(args, cwd)]);
  for (const result of results) {
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  const combined = results.map((result) => result.stdout).join("\n");
  assert.equal((combined.match(/Branch Abandoned/g) ?? []).length, 1);
  assert.equal((combined.match(/already abandoned/gi) ?? []).length, 1);

  const events = readJsonl(docketPath).filter(
    (event) => event.event_type === "branch_abandoned" && event.affected_branches?.includes(oldBranch),
  );
  assert.equal(events.length, 1);
  assert.equal(readJsonl(docketPath).length, docketCountBefore + 1);
  assert.equal(readJsonl(auditPath).length, auditCountBefore + 1);
});

test("branch abandon fails closed on a corrupt docket with zero mutation", (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const docketPath = governancePath(cwd, "docket", "docket_events.jsonl");
  fs.appendFileSync(docketPath, '{"broken":\n', "utf8");
  const before = snapshotMutationFiles(cwd);

  const result = run(abandonArgs(oldBranch, "Corrupt history must fail closed", successorBranch), cwd);

  assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /docket.*(?:invalid|parse|corrupt)|(?:invalid|parse|corrupt).*docket/i);
  assertSnapshotUnchanged(before);
});

test("branch abandon recovers a ledger-only partial transition", (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const reason = "Recover the transition after the branch ledger write";
  const ledgerPath = governancePath(cwd, "branches", "branch_ledger.yaml");
  const ledger = readYaml(ledgerPath);
  const target = ledger.branches.find((entry) => entry.branch === oldBranch);
  target.status = "abandoned";
  target.abandoned_at = new Date().toISOString();
  fs.writeFileSync(ledgerPath, yaml.dump(ledger, { indent: 2, lineWidth: 120, noRefs: true }));
  const docketCountBefore = readJsonl(governancePath(cwd, "docket", "docket_events.jsonl")).length;
  const auditCountBefore = readJsonl(governancePath(cwd, "audit", "ledger.jsonl")).length;

  const result = run(abandonArgs(oldBranch, reason, successorBranch), cwd);

  expectOk(result, "ledger-only recovery");
  const events = abandonmentEvents(cwd, oldBranch);
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, reason);
  assert.equal(events[0].metadata.successor_branch, successorBranch);
  assert.equal(matchingAuditRecords(cwd, events[0].event_id).length, 1);
  assert.equal(readJsonl(governancePath(cwd, "docket", "docket_events.jsonl")).length, docketCountBefore + 1);
  assert.equal(readJsonl(governancePath(cwd, "audit", "ledger.jsonl")).length, auditCountBefore + 1);
  assert.ok(fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8").includes(`**Branch**: \`${successorBranch}\``));
});

test("branch abandon completes an active branch with an existing exact docket and audit", async (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const reason = "Recover the branch ledger after event persistence";
  const { recordDocketEvent } = await import(govdModuleUrl);
  const event = recordDocketEvent(cwd, {
    case_id: readYaml(governancePath(cwd, "branches", "branch_ledger.yaml")).branches[0].case_id,
    ticket_id: readYaml(governancePath(cwd, "branches", "branch_ledger.yaml")).branches[0].ticket_id,
    event_type: "branch_abandoned",
    actor: "system",
    reason,
    status_before: "active",
    status_after: "abandoned",
    affected_branches: [oldBranch],
    metadata: { successor_branch: successorBranch },
  });
  const beforeDocketCount = readJsonl(governancePath(cwd, "docket", "docket_events.jsonl")).length;
  const beforeAuditCount = readJsonl(governancePath(cwd, "audit", "ledger.jsonl")).length;

  const result = run(abandonArgs(oldBranch, reason, successorBranch), cwd);

  expectOk(result, "event-first recovery");
  const target = readYaml(governancePath(cwd, "branches", "branch_ledger.yaml")).branches.find(
    (entry) => entry.branch === oldBranch,
  );
  assert.equal(target.status, "abandoned");
  assert.match(target.abandoned_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(abandonmentEvents(cwd, oldBranch).length, 1);
  assert.equal(matchingAuditRecords(cwd, event.event_id).length, 1);
  assert.equal(readJsonl(governancePath(cwd, "docket", "docket_events.jsonl")).length, beforeDocketCount);
  assert.equal(readJsonl(governancePath(cwd, "audit", "ledger.jsonl")).length, beforeAuditCount);
});

test("branch abandon repairs an exact docket event missing its audit mirror", (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const reason = "Recover the missing audit mirror";
  const ledger = readYaml(governancePath(cwd, "branches", "branch_ledger.yaml"));
  const target = ledger.branches.find((entry) => entry.branch === oldBranch);
  const event = {
    event_id: "DCK-2026-01-01-999",
    case_id: target.case_id,
    ticket_id: target.ticket_id,
    event_type: "branch_abandoned",
    actor: "system",
    reason,
    evidence: [],
    status_before: "active",
    status_after: "abandoned",
    affected_branches: [oldBranch],
    metadata: { successor_branch: successorBranch },
    created_at: "2026-01-01T00:00:00.000Z",
  };
  fs.appendFileSync(
    governancePath(cwd, "docket", "docket_events.jsonl"),
    JSON.stringify(event) + "\n",
    "utf8",
  );
  target.status = "abandoned";
  target.abandoned_at = event.created_at;
  fs.writeFileSync(
    governancePath(cwd, "branches", "branch_ledger.yaml"),
    yaml.dump(ledger, { indent: 2, lineWidth: 120, noRefs: true }),
    "utf8",
  );
  assert.equal(matchingAuditRecords(cwd, event.event_id).length, 0);

  const result = run(abandonArgs(oldBranch, reason, successorBranch), cwd);

  expectOk(result, "missing audit recovery");
  assert.equal(abandonmentEvents(cwd, oldBranch).length, 1);
  assert.equal(matchingAuditRecords(cwd, event.event_id).length, 1);
  const repairedAudit = matchingAuditRecords(cwd, event.event_id)[0];
  assert.deepEqual(repairedAudit.payload, abandonmentEvents(cwd, oldBranch)[0]);
  assert.notEqual(repairedAudit.created_at, event.created_at, "audit recovery must retain its actual append time");
  assert.equal(
    readYaml(governancePath(cwd, "branches", "branch_ledger.yaml")).branches.find(
      (entry) => entry.branch === oldBranch,
    ).status,
    "abandoned",
  );
});

test("branch abandon fails closed when the audit head is invalid", (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const headPath = governancePath(cwd, "audit", "head.json");
  const head = JSON.parse(fs.readFileSync(headPath, "utf8"));
  head.last_hash = "sha256:tampered-review-head";
  fs.writeFileSync(headPath, JSON.stringify(head, null, 2) + "\n", "utf8");
  const before = snapshotMutationFiles(cwd);

  const result = run(abandonArgs(oldBranch, "Invalid audit must not be extended", successorBranch), cwd);

  assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /audit.*(?:invalid|mismatch)|(?:invalid|mismatch).*audit/i);
  assertSnapshotUnchanged(before);
});

test("branch abandon reports a posture target failure and exact retry repairs it", (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const reason = "Retry a partial posture synchronization";
  const cursorPath = path.join(cwd, ".cursorrules");
  const docketCountBefore = readJsonl(governancePath(cwd, "docket", "docket_events.jsonl")).length;
  const auditCountBefore = readJsonl(governancePath(cwd, "audit", "ledger.jsonl")).length;
  fs.rmSync(cursorPath);
  fs.mkdirSync(cursorPath);

  const first = run(abandonArgs(oldBranch, reason, successorBranch), cwd);

  assert.equal(first.status, 1, `stdout:\n${first.stdout}\nstderr:\n${first.stderr}`);
  assert.match(`${first.stdout}\n${first.stderr}`, /agent rules|posture|\.cursorrules/i);
  assert.equal(fs.statSync(cursorPath).isDirectory(), true);
  assert.equal(abandonmentEvents(cwd, oldBranch).length, 1);

  fs.rmSync(cursorPath, { recursive: true });
  fs.writeFileSync(cursorPath, "manual prefix\n", "utf8");
  const retry = run(abandonArgs(oldBranch, reason, successorBranch), cwd);

  expectOk(retry, "posture recovery retry");
  for (const targetPath of [
    cursorPath,
    path.join(cwd, ".clinerules"),
    path.join(cwd, ".github", "copilot-instructions.md"),
    path.join(cwd, "CLAUDE.md"),
  ]) {
    assert.ok(fs.readFileSync(targetPath, "utf8").includes(`**Branch**: \`${successorBranch}\``), targetPath);
  }
  assert.equal(abandonmentEvents(cwd, oldBranch).length, 1);
  assert.equal(readJsonl(governancePath(cwd, "docket", "docket_events.jsonl")).length, docketCountBefore + 1);
  assert.equal(readJsonl(governancePath(cwd, "audit", "ledger.jsonl")).length, auditCountBefore + 1);
});

test("exact retry repairs stale posture without duplicating docket or audit", (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const reason = "Validate and reconcile all persisted components";
  expectOk(run(abandonArgs(oldBranch, reason, successorBranch), cwd), "initial abandon");
  const event = abandonmentEvents(cwd, oldBranch)[0];
  const docketCount = readJsonl(governancePath(cwd, "docket", "docket_events.jsonl")).length;
  const auditCount = readJsonl(governancePath(cwd, "audit", "ledger.jsonl")).length;
  const claudePath = path.join(cwd, "CLAUDE.md");
  const stale = fs.readFileSync(claudePath, "utf8").replace(
    `**Branch**: \`${successorBranch}\``,
    `**Branch**: \`${oldBranch}\``,
  );
  fs.writeFileSync(claudePath, stale, "utf8");

  const retry = run(abandonArgs(oldBranch, reason, successorBranch), cwd);

  expectOk(retry, "stale posture retry");
  assert.ok(fs.readFileSync(claudePath, "utf8").includes(`**Branch**: \`${successorBranch}\``));
  assert.equal(abandonmentEvents(cwd, oldBranch).length, 1);
  assert.equal(matchingAuditRecords(cwd, event.event_id).length, 1);
  assert.equal(readJsonl(governancePath(cwd, "docket", "docket_events.jsonl")).length, docketCount);
  assert.equal(readJsonl(governancePath(cwd, "audit", "ledger.jsonl")).length, auditCount);
});

test("exact retry rejects a conflicting audit mirror with zero mutation", async (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const reason = "Reject conflicting audit mirrors";
  expectOk(run(abandonArgs(oldBranch, reason, successorBranch), cwd), "initial abandon");
  const event = abandonmentEvents(cwd, oldBranch)[0];
  const { appendLedgerRecord } = await import(govdModuleUrl);
  appendLedgerRecord(cwd, "docket", event.event_id, { ...event, reason: "Conflicting audit payload" }, {
    actor: event.actor,
    case_id: event.case_id,
    ticket_id: event.ticket_id,
    created_at: event.created_at,
  });
  const before = snapshotMutationFiles(cwd);

  const retry = run(abandonArgs(oldBranch, reason, successorBranch), cwd);

  assert.equal(retry.status, 1, `stdout:\n${retry.stdout}\nstderr:\n${retry.stderr}`);
  assert.match(`${retry.stdout}\n${retry.stderr}`, /audit.*(?:conflict|duplicate)|(?:conflict|duplicate).*audit/i);
  assertSnapshotUnchanged(before);
});

test("branch abandon repairs an audit head exactly one valid entry behind", async (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const reason = "Recover the audit head after the ledger append";
  const headPath = governancePath(cwd, "audit", "head.json");
  const oldHead = fs.readFileSync(headPath, "utf8");
  const { recordDocketEvent } = await import(govdModuleUrl);
  const ledger = readYaml(governancePath(cwd, "branches", "branch_ledger.yaml"));
  const target = ledger.branches.find((entry) => entry.branch === oldBranch);
  const event = recordDocketEvent(cwd, {
    case_id: target.case_id,
    ticket_id: target.ticket_id,
    event_type: "branch_abandoned",
    actor: "system",
    reason,
    status_before: "active",
    status_after: "abandoned",
    affected_branches: [oldBranch],
    metadata: { successor_branch: successorBranch },
  });
  const expectedHead = fs.readFileSync(headPath, "utf8");
  const docketCount = readJsonl(governancePath(cwd, "docket", "docket_events.jsonl")).length;
  const auditCount = readJsonl(governancePath(cwd, "audit", "ledger.jsonl")).length;
  fs.writeFileSync(headPath, oldHead, "utf8");

  const result = run(abandonArgs(oldBranch, reason, successorBranch), cwd);

  expectOk(result, "one-entry-behind audit head recovery");
  assert.equal(fs.readFileSync(headPath, "utf8"), expectedHead);
  assert.equal(abandonmentEvents(cwd, oldBranch).length, 1);
  assert.equal(matchingAuditRecords(cwd, event.event_id).length, 1);
  assert.equal(readJsonl(governancePath(cwd, "docket", "docket_events.jsonl")).length, docketCount);
  assert.equal(readJsonl(governancePath(cwd, "audit", "ledger.jsonl")).length, auditCount);
});

test("branch abandon does not repair a one-entry-behind audit head with tampered prefix metadata", (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const audit = readJsonl(governancePath(cwd, "audit", "ledger.jsonl"));
  const prefix = audit.at(-2);
  const headPath = governancePath(cwd, "audit", "head.json");
  fs.writeFileSync(headPath, JSON.stringify({
    version: "gr.audit.head.v1",
    last_seq: prefix.seq,
    last_hash: prefix.entry_hash,
    updated_at: "2026-01-01T00:00:00.000Z",
  }, null, 2) + "\n", "utf8");
  assert.notEqual(prefix.created_at, "2026-01-01T00:00:00.000Z");
  const before = snapshotMutationFiles(cwd);

  const result = run(abandonArgs(oldBranch, "Tampered old head must fail closed", successorBranch), cwd);

  assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /audit.*(?:invalid|mismatch)|(?:invalid|mismatch).*audit/i);
  assertSnapshotUnchanged(before);
});

test("branch abandon leaves a recoverable old head untouched when the pending audit entry conflicts", async (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const reason = "Do not mutate a recoverable head before conflict preflight";
  expectOk(run(abandonArgs(oldBranch, reason, successorBranch), cwd), "initial abandon");
  const event = abandonmentEvents(cwd, oldBranch)[0];
  const headPath = governancePath(cwd, "audit", "head.json");
  const prefixHead = fs.readFileSync(headPath, "utf8");
  const { appendLedgerRecord } = await import(govdModuleUrl);
  appendLedgerRecord(cwd, "docket", event.event_id, { ...event, reason: "Conflicting pending mirror" }, {
    actor: event.actor,
    case_id: event.case_id,
    ticket_id: event.ticket_id,
  });
  fs.writeFileSync(headPath, prefixHead, "utf8");
  const before = snapshotMutationFiles(cwd);

  const retry = run(abandonArgs(oldBranch, reason, successorBranch), cwd);

  assert.equal(retry.status, 1, `stdout:\n${retry.stdout}\nstderr:\n${retry.stderr}`);
  assert.match(`${retry.stdout}\n${retry.stderr}`, /audit.*(?:conflict|duplicate)|(?:conflict|duplicate).*audit/i);
  assertSnapshotUnchanged(before);
});

test("branch create respects a live abandon lock and preserves both ledger mutations", async (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const reason = "Serialize branch create with branch abandon";
  const readyPath = path.join(cwd, "paused-ledger-rename.ready");
  const releasePath = path.join(cwd, "paused-ledger-rename.release");
  const lockAttemptPath = path.join(cwd, "create-lock-attempt.ready");
  const ledgerWritePath = path.join(cwd, "create-ledger-write.ready");
  const pausedAbandon = runPausedAtBranchLedgerRename(
    abandonArgs(oldBranch, reason, successorBranch),
    cwd,
    readyPath,
    releasePath,
  );
  await waitForFile(readyPath);
  const concurrentCreate = runObservedBranchCreate(
    ["branch", "create", "--purpose", "cross-command-create"],
    cwd,
    lockAttemptPath,
    ledgerWritePath,
  );
  await waitForEither(lockAttemptPath, ledgerWritePath);
  fs.writeFileSync(releasePath, "release\n", "utf8");
  const [abandoned, created] = await Promise.all([pausedAbandon, concurrentCreate]);

  assert.equal(abandoned.status, 0, `stdout:\n${abandoned.stdout}\nstderr:\n${abandoned.stderr}`);
  assert.equal(created.status, 0, `stdout:\n${created.stdout}\nstderr:\n${created.stderr}`);
  assert.equal(fs.existsSync(lockAttemptPath), true, "branch create must attempt the shared live lock");
  const finalLedger = readYaml(governancePath(cwd, "branches", "branch_ledger.yaml"));
  assert.equal(finalLedger.branches.find((entry) => entry.branch === oldBranch).status, "abandoned");
  assert.ok(
    finalLedger.branches.some((entry) => entry.branch.endsWith("/cross-command-create")),
    "the create mutation must not be overwritten by the paused abandon write",
  );
  assert.equal(abandonmentEvents(cwd, oldBranch).length, 1);
});

test("exact retry repairs R1 after its recorded R2 successor is abandoned", async (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const reason = "R1 is superseded by R2";
  const auditPath = governancePath(cwd, "audit", "ledger.jsonl");
  const headPath = governancePath(cwd, "audit", "head.json");
  const auditBefore = fs.readFileSync(auditPath, "utf8");
  const headBefore = fs.readFileSync(headPath, "utf8");
  const { recordDocketEvent } = await import(govdModuleUrl);
  const ledgerPath = governancePath(cwd, "branches", "branch_ledger.yaml");
  const ledger = readYaml(ledgerPath);
  const r1 = ledger.branches.find((entry) => entry.branch === oldBranch);
  const r1Event = recordDocketEvent(cwd, {
    case_id: r1.case_id,
    ticket_id: r1.ticket_id,
    event_type: "branch_abandoned",
    actor: "system",
    reason,
    status_before: "active",
    status_after: "abandoned",
    affected_branches: [oldBranch],
    metadata: { successor_branch: successorBranch },
  });
  fs.writeFileSync(auditPath, auditBefore, "utf8");
  fs.writeFileSync(headPath, headBefore, "utf8");
  r1.status = "abandoned";
  r1.abandoned_at = r1Event.created_at;
  fs.writeFileSync(ledgerPath, yaml.dump(ledger, { indent: 2, lineWidth: 120, noRefs: true }), "utf8");
  expectOk(
    run(["branch", "abandon", successorBranch, "--reason", "R2 is no longer viable"], cwd),
    "abandon R2",
  );
  assert.equal(matchingAuditRecords(cwd, r1Event.event_id).length, 0);

  const retry = run(abandonArgs(oldBranch, reason, successorBranch), cwd);

  expectOk(retry, "retry R1 after R2 abandonment");
  const finalLedger = readYaml(ledgerPath);
  assert.equal(finalLedger.branches.find((entry) => entry.branch === oldBranch).status, "abandoned");
  assert.equal(finalLedger.branches.find((entry) => entry.branch === successorBranch).status, "abandoned");
  assert.equal(abandonmentEvents(cwd, oldBranch).length, 1);
  assert.equal(matchingAuditRecords(cwd, r1Event.event_id).length, 1);
});

test("a new abandon transition still requires an active successor", (t) => {
  const { cwd, oldBranch, successorBranch } = setup(t);
  const ledgerPath = governancePath(cwd, "branches", "branch_ledger.yaml");
  const ledger = readYaml(ledgerPath);
  const successor = ledger.branches.find((entry) => entry.branch === successorBranch);
  successor.status = "merged";
  successor.merged_at = new Date().toISOString();
  fs.writeFileSync(ledgerPath, yaml.dump(ledger, { indent: 2, lineWidth: 120, noRefs: true }), "utf8");
  const before = snapshotMutationFiles(cwd);

  const result = run(abandonArgs(oldBranch, "Do not start with an inactive successor", successorBranch), cwd);

  assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /successor.*active/i);
  assertSnapshotUnchanged(before);
});
