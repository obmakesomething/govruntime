import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeClaudeCodeEvent,
  normalizeCodexEvent,
  normalizeEvent,
} from "../dist/hooks/normalize.js";

test("normalizes Claude Code hook payloads", () => {
  const event = normalizeClaudeCodeEvent({
    hook_event_name: "PreToolUse",
    session_id: "claude-session",
    cwd: "/tmp/project",
    tool_name: "Read",
    tool_input: { file_path: "README.md" },
  });

  assert.equal(event.platform, "claude_code");
  assert.equal(event.hook_event_name, "PreToolUse");
  assert.equal(event.session_id, "claude-session");
  assert.equal(event.cwd, "/tmp/project");
  assert.equal(event.tool_name, "Read");
  assert.deepEqual(event.tool_input, { file_path: "README.md" });
});

test("normalizes Codex hook payloads", () => {
  const event = normalizeCodexEvent({
    event: "pre_tool",
    sessionId: "codex-session",
    workdir: "/tmp/project",
    toolName: "Read",
    toolInput: { path: "docs/architecture.md" },
  });

  assert.equal(event.platform, "codex");
  assert.equal(event.hook_event_name, "PreToolUse");
  assert.equal(event.session_id, "codex-session");
  assert.equal(event.cwd, "/tmp/project");
  assert.equal(event.tool_name, "Read");
  assert.deepEqual(event.tool_input, { path: "docs/architecture.md" });
});

test("auto-detects Claude-shaped and Codex-shaped payloads", () => {
  assert.equal(normalizeEvent({ hook_event_name: "Stop" }).platform, "claude_code");
  assert.equal(normalizeEvent({ event: "stop" }).platform, "codex");
});
