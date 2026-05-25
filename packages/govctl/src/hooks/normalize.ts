/**
 * Hook Event Normalizer
 *
 * Converts platform-specific hook JSON into the common NormalizedHookEvent schema.
 * Claude Code and Codex have different input formats.
 */
import type { HookPlatform, NormalizedHookEvent } from "@govruntime/govd";

type RawHookPayload = Record<string, unknown>;
type HookEventName = NormalizedHookEvent["hook_event_name"];

const CODEX_EVENT_MAP: Record<string, HookEventName> = {
  session_start: "SessionStart",
  message: "UserPromptSubmit",
  pre_tool: "PreToolUse",
  post_tool: "PostToolUse",
  stop: "Stop",
};

export function normalizeClaudeCodeEvent(raw: unknown): NormalizedHookEvent {
  const input = asPayload(raw);
  const event: NormalizedHookEvent = {
    platform: "claude_code",
    hook_event_name: normalizeHookEventName(input["hook_event_name"], "SessionStart"),
    session_id: String(input["session_id"] ?? "unknown"),
    cwd: String(input["cwd"] ?? process.cwd()),
    metadata: {},
    raw: input,
  };

  if (typeof input["transcript_path"] === "string") event.transcript_path = input["transcript_path"];
  if (typeof input["prompt"] === "string") event.prompt = input["prompt"];
  if (typeof input["tool_name"] === "string") event.tool_name = input["tool_name"];
  if (isRecord(input["tool_input"])) event.tool_input = input["tool_input"] as Record<string, unknown>;
  if (isRecord(input["tool_response"])) event.tool_output = input["tool_response"] as Record<string, unknown>;
  if (typeof input["stop_reason"] === "string") event.last_assistant_message = input["stop_reason"];

  return event;
}

export function normalizeCodexEvent(raw: unknown): NormalizedHookEvent {
  const input = asPayload(raw);
  const eventName = CODEX_EVENT_MAP[String(input["event"] ?? "session_start")] ?? "SessionStart";
  const event: NormalizedHookEvent = {
    platform: "codex",
    hook_event_name: eventName,
    session_id: String(input["sessionId"] ?? "unknown"),
    cwd: String(input["workdir"] ?? process.cwd()),
    metadata: {},
    raw: input,
  };

  if (typeof input["userMessage"] === "string") event.prompt = input["userMessage"];
  if (typeof input["toolName"] === "string") event.tool_name = input["toolName"];
  if (isRecord(input["toolInput"])) event.tool_input = input["toolInput"] as Record<string, unknown>;
  if (isRecord(input["toolOutput"])) event.tool_output = input["toolOutput"] as Record<string, unknown>;

  return event;
}

// ---------------------------------------------------------------------------
// Auto-detect platform
// ---------------------------------------------------------------------------

export function normalizeEvent(raw: unknown, platform?: HookPlatform): NormalizedHookEvent {
  const input = asPayload(raw);
  const detectedPlatform = platform ?? ("hook_event_name" in input ? "claude_code" : "codex");

  if (detectedPlatform === "codex") {
    return normalizeCodexEvent(raw);
  }

  return normalizeClaudeCodeEvent(raw);
}

function asPayload(raw: unknown): RawHookPayload {
  return isRecord(raw) ? raw : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeHookEventName(value: unknown, fallback: HookEventName): HookEventName {
  return isHookEventName(value) ? value : fallback;
}

function isHookEventName(value: unknown): value is HookEventName {
  return (
    value === "SessionStart" ||
    value === "UserPromptSubmit" ||
    value === "PreToolUse" ||
    value === "PostToolUse" ||
    value === "Stop"
  );
}
