import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadState,
  readAllYamlFiles,
  validateDocumentPathLiterals,
  validateHookPathLiterals,
} from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const govctl = path.resolve(__dirname, "../../govctl/dist/index.js");

function runGovctl(args, cwd) {
  return childProcess.spawnSync(process.execPath, [govctl, ...args, "--cwd", cwd], {
    encoding: "utf8",
  });
}

function readDebugList(stdout, heading) {
  const lines = stdout.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return [];
  const values = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s{4}- (.+)$/.exec(line);
    if (match) {
      values.push(match[1]);
      continue;
    }
    if (line.trim().endsWith(":")) break;
  }
  return values;
}

function makeSourceFixture(files = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "govruntime-source-fixture-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(cwd, ".governance", relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, "utf8");
  }
  return cwd;
}

function makeGovernanceFixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "govruntime-fixture-"));
  fs.mkdirSync(path.join(cwd, ".governance", "statutes"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "app.ts"), "export const ok = true;\n", "utf8");
  fs.writeFileSync(
    path.join(cwd, ".governance", "constitution.yaml"),
    [
      "version: '0.1'",
      "runtime:",
      "  namespace: '@govruntime'",
      "  product_mode: development",
      "  enforcement_mode: advisory",
      "  path_validation:",
      "    enabled: true",
      "    check_tool_inputs: true",
      "    check_document_literals: true",
      "",
    ].join("\n"),
    "utf8"
  );
  return cwd;
}

test("loads runtime config from a .governance fixture", () => {
  const cwd = makeGovernanceFixture();
  const state = loadState(cwd);

  assert.equal(state.runtime_config.namespace, "@govruntime");
  assert.equal(state.runtime_config.product_mode, "development");
  assert.equal(state.runtime_config.enforcement_mode, "advisory");
  assert.equal(state.runtime_config.path_validation.enabled, true);
});

test("loads pre-alpha JSON governance state", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "govruntime-json-fixture-"));
  fs.mkdirSync(path.join(cwd, ".governance", "cases"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".governance", "tickets"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".governance", "branches"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".governance", "constitution.json"), JSON.stringify({ version: "0.1" }));
  fs.writeFileSync(path.join(cwd, ".governance", "current.json"), JSON.stringify({
    active_case_id: "CASE-2026-05-24-001",
    active_ticket_id: "T-GOV-001-R1",
    active_branch: "codex/int/20260524-governance-runtime",
  }));
  fs.writeFileSync(path.join(cwd, ".governance", "cases", "CASE-2026-05-24-001.json"), JSON.stringify({
    case_id: "CASE-2026-05-24-001",
    status: "open",
    title: "Apply governance runtime",
    issue: "Can repo-local governance state be loaded?",
    active_ticket_id: "T-GOV-001-R1",
    created_at: "2026-05-24T00:00:00.000Z",
  }));
  fs.writeFileSync(path.join(cwd, ".governance", "tickets", "T-GOV-001-R1.json"), JSON.stringify({
    ticket_id: "T-GOV-001-R1",
    case_id: "CASE-2026-05-24-001",
    status: "in_progress",
    title: "Create governance runtime MVP",
    objective: "Load old JSON state",
    acceptance_criteria: ["status shows active ticket"],
    validation_plan: ["govctl status"],
    created_at: "2026-05-24T00:00:00.000Z",
  }));
  fs.writeFileSync(path.join(cwd, ".governance", "branches", "branch_ledger.json"), JSON.stringify({
    branches: [{
      branch: "codex/int/20260524-governance-runtime",
      worktree: cwd,
      case_id: "CASE-2026-05-24-001",
      ticket_id: "T-GOV-001-R1",
      branch_type: "verification_governance_mvp",
      status: "active",
      reason_created: ["legacy JSON fixture"],
      intended_scope: [".governance/**"],
      forbidden_scope: ["src/**"],
      exit_conditions: ["govctl status works"],
      created_at: "2026-05-24T00:00:00.000Z",
    }],
  }));

  const state = loadState(cwd);
  assert.equal(state.active_case?.case_id, "CASE-2026-05-24-001");
  assert.equal(state.active_ticket?.ticket_id, "T-GOV-001-R1");
  assert.equal(state.active_ticket?.status, "IN_PROGRESS");
  assert.equal(state.active_branch?.branch, "codex/int/20260524-governance-runtime");
  assert.deepEqual(state.active_branch?.exit_conditions.merge_when, ["govctl status works"]);

  const status = runGovctl(["status", "--debug-state"], cwd);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Debug State/);
  assert.match(status.stdout, /Format:\s+pre-alpha-json/);
  assert.match(status.stdout, /Active:\s+case=CASE-2026-05-24-001 ticket=T-GOV-001-R1 branch=codex\/int\/20260524-governance-runtime/);
  assert.match(status.stdout, /Counts:\s+cases=1 tickets=1 branches=1/);
  assert.match(status.stdout, /Files read:/);
  assert.match(status.stdout, /constitution\.json/);
  assert.match(status.stdout, /current\.json/);
  assert.match(status.stdout, /cases\/CASE-2026-05-24-001\.json/);
  assert.match(status.stdout, /tickets\/T-GOV-001-R1\.json/);

  const regularStatus = runGovctl(["status"], cwd);
  assert.equal(regularStatus.status, 0, regularStatus.stderr);
  assert.doesNotMatch(regularStatus.stdout, /Debug State/);
});

test("ignores malformed branch ledger shapes and preserves valid entries", () => {
  const invalidShapeCwd = makeSourceFixture({
    "branches/branch_ledger.json": JSON.stringify({ branches: { branch: "not-an-array" } }),
  });
  assert.deepEqual(loadState(invalidShapeCwd).branch_ledger.branches, []);

  const mixedEntriesCwd = makeSourceFixture({
    "branches/branch_ledger.json": JSON.stringify({
      branches: [
        null,
        "not-a-record",
        {
          branch: "codex/fix/valid-entry",
          ticket_id: "T-VALID-R1",
          case_id: "CASE-VALID",
          status: "active",
        },
      ],
    }),
  });
  assert.deepEqual(
    loadState(mixedEntriesCwd).branch_ledger.branches.map((entry) => entry.branch),
    ["codex/fix/valid-entry"]
  );
});

test("falls back from invalid selectors with stable ID tie-breakers", () => {
  const timestamp = "2026-07-15T00:00:00.000Z";
  const cwd = makeSourceFixture({
    "current.json": JSON.stringify({
      active_case_id: "CASE-MISSING",
      active_ticket_id: "T-MISSING-R1",
    }),
    "cases/a-case.json": JSON.stringify({
      case_id: "CASE-Z",
      status: "open",
      opened_at: timestamp,
    }),
    "cases/z-case.json": JSON.stringify({
      case_id: "CASE-A",
      status: "open",
      opened_at: timestamp,
    }),
    "tickets/a-ticket.json": JSON.stringify({
      ticket_id: "T-Z-R1",
      case_id: "CASE-A",
      status: "in_progress",
      updated_at: timestamp,
    }),
    "tickets/z-ticket.json": JSON.stringify({
      ticket_id: "T-A-R1",
      case_id: "CASE-A",
      status: "in_progress",
      updated_at: timestamp,
    }),
  });

  const state = loadState(cwd);
  assert.equal(state.active_case?.case_id, "CASE-A");
  assert.equal(state.active_ticket?.ticket_id, "T-A-R1");
});

test("rejects terminal current selectors and preserves active relationships", () => {
  const cwd = makeSourceFixture({
    "current.json": JSON.stringify({
      active_case_id: "CASE-CLOSED",
      active_ticket_id: "T-DONE-R1",
      active_branch: "codex/fix/paused",
    }),
    "cases/closed.json": JSON.stringify({
      case_id: "CASE-CLOSED",
      status: "closed",
      opened_at: "2026-07-15T02:00:00.000Z",
    }),
    "cases/open.yaml": [
      "case_id: CASE-OPEN",
      "status: open",
      "opened_at: 2026-07-15T01:00:00.000Z",
      "",
    ].join("\n"),
    "tickets/done.json": JSON.stringify({
      ticket_id: "T-DONE-R1",
      case_id: "CASE-CLOSED",
      status: "done",
      updated_at: "2026-07-15T02:00:00.000Z",
    }),
    "tickets/active.yaml": [
      "ticket_id: T-ACTIVE-R1",
      "case_id: CASE-OPEN",
      "status: in_progress",
      "updated_at: 2026-07-15T01:00:00.000Z",
      "",
    ].join("\n"),
    "branches/branch_ledger.json": JSON.stringify({
      branches: [
        {
          branch: "codex/fix/paused",
          case_id: "CASE-CLOSED",
          ticket_id: "T-DONE-R1",
          status: "paused",
        },
        {
          branch: "codex/fix/wrong-case",
          case_id: "CASE-CLOSED",
          ticket_id: "T-ACTIVE-R1",
          status: "active",
        },
        {
          branch: "codex/fix/active",
          case_id: "CASE-OPEN",
          ticket_id: "T-ACTIVE-R1",
          status: "active",
        },
      ],
    }),
  });

  const state = loadState(cwd);
  assert.equal(state.active_case?.case_id, "CASE-OPEN");
  assert.equal(state.active_ticket?.ticket_id, "T-ACTIVE-R1");
  assert.equal(state.active_branch?.branch, "codex/fix/active");
});

test("uses deterministic YAML-first deduplication and strict JSON parsing", () => {
  const cwd = makeSourceFixture({
    "cases/a-duplicate.json": JSON.stringify({
      case_id: "CASE-DUPLICATE",
      status: "open",
      title: "JSON loses",
    }),
    "cases/z-duplicate.yaml": [
      "case_id: CASE-DUPLICATE",
      "status: open",
      "title: YAML wins",
      "",
    ].join("\n"),
    "cases/b-json-only.json": JSON.stringify({
      case_id: "CASE-JSON",
      status: "open",
      title: "JSON only",
    }),
    "cases/c-invalid.json": "case_id: CASE-NOT-JSON\nstatus: open\n",
  });

  const state = loadState(cwd);
  assert.deepEqual(state.cases.map((item) => item.case_id), ["CASE-DUPLICATE", "CASE-JSON"]);
  assert.equal(state.cases[0]?.title, "YAML wins");
  assert.equal(readAllYamlFiles(path.join(cwd, ".governance", "cases")).length, 1);
});

test("normalizes malformed legacy scalar values to typed safe defaults", () => {
  const cwd = makeSourceFixture({
    "cases/invalid.json": JSON.stringify({ case_id: "CASE-INVALID", status: "invented" }),
    "tickets/invalid.json": JSON.stringify({
      ticket_id: "T-INVALID-R1",
      case_id: "CASE-INVALID",
      status: "invented",
      workstream_status: "invented",
      revision: "not-a-number",
      risk_profile: {
        ambiguity: "not-a-number",
        scope_drift: Infinity,
        implementation_complexity: -4,
        verification_strength: 8,
        blast_radius: "planetary",
      },
    }),
  });

  const state = loadState(cwd);
  assert.equal(state.cases[0]?.status, "DRAFT");
  assert.equal(state.tickets[0]?.status, "DRAFT");
  assert.equal(state.tickets[0]?.workstream_status, "ACTIVE");
  assert.equal(state.tickets[0]?.revision, 1);
  assert.deepEqual(state.tickets[0]?.risk_profile, {
    ambiguity: 0,
    scope_drift: 0,
    implementation_complexity: 0,
    verification_strength: 1,
    blast_radius: "medium",
  });
  assert.equal(state.active_case, null);
  assert.equal(state.active_ticket, null);
});

test("distinguishes governance source formats", () => {
  const fixtures = [
    {
      expected: "case-folder",
      cwd: makeSourceFixture({ "cases/CASE-FOLDER/case.yaml": "case_id: CASE-FOLDER\n" }),
    },
    {
      expected: "legacy-yaml",
      cwd: makeSourceFixture({ "cases/CASE-YAML.yaml": "case_id: CASE-YAML\n" }),
    },
    {
      expected: "mixed",
      cwd: makeSourceFixture({
        "cases/CASE-FOLDER/case.yaml": "case_id: CASE-FOLDER\n",
        "cases/CASE-JSON.json": JSON.stringify({ case_id: "CASE-JSON" }),
      }),
    },
    {
      expected: "empty",
      cwd: makeSourceFixture(),
    },
    {
      expected: "unknown",
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), "govruntime-no-source-fixture-")),
    },
  ];
  fs.mkdirSync(path.join(fixtures[3].cwd, ".governance"), { recursive: true });

  for (const fixture of fixtures) {
    const status = runGovctl(["status", "--debug-state"], fixture.cwd);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, new RegExp(`Format:\\s+${fixture.expected}`));
  }
});

test("classifies recognized non-case governance sources through the CLI boundary", () => {
  const fixtures = [
    {
      expected: "legacy-yaml",
      cwd: makeSourceFixture({ "constitution.yaml": "version: '0.1'\n" }),
    },
    {
      expected: "pre-alpha-json",
      cwd: makeSourceFixture({ "branches/branch_ledger.json": JSON.stringify({ branches: [] }) }),
    },
  ];

  for (const fixture of fixtures) {
    const status = runGovctl(["status", "--debug-state"], fixture.cwd);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, new RegExp(`Format:\\s+${fixture.expected}`));
  }
});

test("reports a structurally invalid governance path as unknown", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "govruntime-invalid-source-fixture-"));
  fs.writeFileSync(path.join(cwd, ".governance"), "not a directory\n", "utf8");

  const status = runGovctl(["status", "--debug-state"], cwd);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Format:\s+unknown/);
  assert.match(status.stdout, /Ignored \/ unsupported:/);
  assert.match(status.stdout, /governance path is not a readable directory/);
});

test("reports an unreadable governance directory as unknown", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "govruntime-unreadable-source-fixture-"));
  const governanceDir = path.join(cwd, ".governance");
  fs.mkdirSync(governanceDir);
  fs.chmodSync(governanceDir, 0o000);
  try {
    try {
      fs.readdirSync(governanceDir);
      t.skip("current process can read mode-000 directories");
      return;
    } catch {
      // Expected on normal non-root execution.
    }
    const status = runGovctl(["status", "--debug-state"], cwd);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /Format:\s+unknown/);
    assert.match(status.stdout, /governance path is not a readable directory/);
  } finally {
    fs.chmodSync(governanceDir, 0o700);
  }
});

test("bounds source inventory work and reports truncated classification as unknown", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "govruntime-large-source-fixture-"));
  const governanceDir = path.join(cwd, ".governance");
  fs.mkdirSync(governanceDir);
  for (let index = 0; index < 1001; index += 1) {
    fs.mkdirSync(path.join(governanceDir, `empty-${String(index).padStart(4, "0")}`));
  }

  const status = runGovctl(["status", "--debug-state"], cwd);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Format:\s+unknown/);
  assert.match(status.stdout, /diagnostic scan truncated after 1000 entries or depth 8/);
});

test("reports present, actually read, and ignored governance sources truthfully", () => {
  const cwd = makeSourceFixture({
    "constitution.yaml": "version: '0.1'\n",
    "constitution.json": JSON.stringify({ version: "legacy" }),
    "current.json": JSON.stringify({ active_case_id: "CASE-DIRECT" }),
    "current.yaml": "active_case_id: CASE-UNSUPPORTED\n",
    "branches/branch_ledger.yaml": "branches: []\n",
    "branches/branch_ledger.json": JSON.stringify({ branches: [] }),
    "cases/CASE-DIRECT.yaml": "case_id: CASE-DIRECT\nstatus: open\n",
    "cases/CASE-FOLDER/case.yaml": "case_id: CASE-FOLDER\n",
    "cases/CASE-FOLDER/events.jsonl": "{}\n",
    "cases/notes.txt": "not a state source\n",
    "tickets/T-DIRECT.json": JSON.stringify({ ticket_id: "T-DIRECT", case_id: "CASE-DIRECT" }),
    "audit/ledger.jsonl": "{}\n",
    "audit/head.json": "{}\n",
    "mystery.toml": "unknown = true\n",
  });

  const status = runGovctl(["status", "--debug-state"], cwd);
  assert.equal(status.status, 0, status.stderr);
  assert.deepEqual(readDebugList(status.stdout, "Files present:"), [
    "audit/head.json",
    "audit/ledger.jsonl",
    "branches/branch_ledger.json",
    "branches/branch_ledger.yaml",
    "cases/CASE-DIRECT.yaml",
    "cases/CASE-FOLDER/case.yaml",
    "cases/CASE-FOLDER/events.jsonl",
    "cases/notes.txt",
    "constitution.json",
    "constitution.yaml",
    "current.json",
    "current.yaml",
    "mystery.toml",
    "tickets/T-DIRECT.json",
  ]);
  assert.deepEqual(readDebugList(status.stdout, "Files read:"), [
    "branches/branch_ledger.yaml",
    "cases/CASE-DIRECT.yaml",
    "constitution.yaml",
    "current.json",
    "tickets/T-DIRECT.json",
  ]);
  const ignored = readDebugList(status.stdout, "Ignored / unsupported:");
  assert.equal(ignored.length, 9);
  assert.match(ignored.join("\n"), /constitution\.json.*constitution\.yaml.*first/);
  assert.match(ignored.join("\n"), /branches\/branch_ledger\.json.*branch_ledger\.yaml.*first/);
  assert.match(ignored.join("\n"), /cases\/CASE-FOLDER\/case\.yaml.*case-folder/);
  assert.match(ignored.join("\n"), /audit\/ledger\.jsonl.*not read/);
  assert.match(ignored.join("\n"), /cases\/notes\.txt.*unsupported/);
  assert.match(ignored.join("\n"), /mystery\.toml.*unsupported/);
  assert.ok(!ignored.some((entry) => entry.startsWith("current.json")));
});

test("validates tool input path literals against the fixture root", () => {
  const cwd = makeGovernanceFixture();
  const state = loadState(cwd);

  const findings = validateHookPathLiterals(
    {
      platform: "codex",
      hook_event_name: "PreToolUse",
      session_id: "test-session",
      cwd,
      tool_name: "Read",
      tool_input: { file_path: "src/missing.ts" },
      metadata: {},
      raw: {},
    },
    state
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warn");
  assert.match(findings[0].reason, /does not resolve/);
});

test("allows missing write targets for write-intent tools", () => {
  const cwd = makeGovernanceFixture();
  const state = loadState(cwd);

  const findings = validateHookPathLiterals(
    {
      platform: "codex",
      hook_event_name: "PreToolUse",
      session_id: "test-session",
      cwd,
      tool_name: "Write",
      tool_input: { file_path: "src/new-file.ts" },
      metadata: {},
      raw: {},
    },
    state
  );

  assert.deepEqual(findings, []);
});

test("validates markdown document path literals", () => {
  const cwd = makeGovernanceFixture();
  const state = loadState(cwd);

  const findings = validateDocumentPathLiterals("Read `src/app.ts` and `src/missing.ts`.", state);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].literal, "src/missing.ts");
  assert.equal(findings[0].severity, "warn");
});
