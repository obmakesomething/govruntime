import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadState,
  validateDocumentPathLiterals,
  validateHookPathLiterals,
} from "../dist/index.js";

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
