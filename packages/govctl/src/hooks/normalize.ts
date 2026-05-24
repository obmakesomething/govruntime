/**
 * Hook Event Normalizer
 *
 * Converts platform-specific hook JSON into the common NormalizedHookEvent schema.
 * Claude Code and Codex have different input formats.
 */

import type { NormalizedHookEvent, HookEventName, HookPlatform } from "@govruntime/govd";

// ---------------------------------------------------------------------------
// Claude Code hook input format (from stdin)
// ---------------------------------------------------------------------------

interface ClaudeCodeHookInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  stop_reason?: string;
  [key: string]: unknown;
}

export function normalizeClaudeCodeEvent(
  raw: Record<string, unknown>
): NormalizedHookEvent {
  const input = raw as ClaudeCodeHookInput;

  const event: NormalizedHookEvent = {
    platform: "claude_code",
    hook_event_name: (input.hook_event_name ?? "SessionStart") as HookEventName,
    session_id: String(input.session_id ?? "unknown"),
    cwd: String(input.cwd ?? process.cwd()),
    metadata: {},
    raw,
  };

  if (typeof input.transcript_path === "string") event.transcript_path = input.transcript_path;
  if (typeof input.prompt === "string") event.prompt = input.prompt;
  if (typeof input.tool_name === "string") event.tool_name = input.tool_name;
  if (input.tool_input) event.tool_input = input.tool_input;
  if (input.tool_response) event.tool_output = input.tool_response;
  if (typeof input.stop_reason === "string") event.last_assistant_message = input.stop_reason;

  return event;
}

// ---------------------------------------------------------------------------
// Codex hook input format
// ---------------------------------------------------------------------------

interface CodexHookInput {
  event?: string;
  workdir?: string;
  sessionId?: string;
  userMessage?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: Record<string, unknown>;
  [key: string]: unknown;
}

const CODEX_EVENT_MAP: Record<string, HookEventName> = {
  session_start: "SessionStart",
  message: "UserPromptSubmit",
  pre_tool: "PreToolUse",
  post_tool: "PostToolUse",
  stop: "Stop",
};

export function normalizeCodexEvent(
  raw: Record<string, unknown>
): NormalizedHookEvent {
  const input = raw as CodexHookInput;
  const eventName =
    CODEX_EVENT_MAP[String(input.event ?? "session_start")] ?? "SessionStart";

  const event: NormalizedHookEvent = {
    platform: "codex",
    hook_event_name: eventName,
    session_id: String(input.sessionId ?? "unknown"),
    cwd: String(input.workdir ?? process.cwd()),
    metadata: {},
    raw,
  };

  if (typeof input.userMessage === "string") event.prompt = input.userMessage;
  if (typeof input.toolName === "string") event.tool_name = input.toolName;
  if (input.toolInput) event.tool_input = input.toolInput;
  if (input.toolOutput) event.tool_output = input.toolOutput;

  return event;
}

// ---------------------------------------------------------------------------
// Auto-detect platform
// ---------------------------------------------------------------------------

export function normalizeEvent(
  raw: Record<string, unknown>,
  platform?: HookPlatform
): NormalizedHookEvent {
  const detectedPlatform =
    platform ??
    ("hook_event_name" in raw ? "claude_code" : "codex");

  if (detectedPlatform === "codex") {
    return normalizeCodexEvent(raw);
  }
  return normalizeClaudeCodeEvent(raw);
}
