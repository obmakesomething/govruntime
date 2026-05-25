import fs from "node:fs";
import path from "node:path";
import type { GovernanceState, NormalizedHookEvent } from "../state/types.js";

export type PathLiteralSeverity = "info" | "warn" | "error";

export interface PathLiteralFinding {
  literal: string;
  source: string;
  severity: PathLiteralSeverity;
  reason: string;
  normalized_path?: string;
}

const URL_RE = /^[a-z][a-z0-9+.-]*:/i;
const PACKAGE_RE = /^@?[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)?$/i;
const PATHISH_RE = /^(\/|\.\/|\.\.\/|~\/|[A-Za-z0-9_.-]+\/)/;
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "apply_patch", "write_file"]);

export function validateHookPathLiterals(
  event: NormalizedHookEvent,
  state: GovernanceState
): PathLiteralFinding[] {
  if (!state.runtime_config.path_validation.enabled) return [];
  if (!state.runtime_config.path_validation.check_tool_inputs) return [];

  const literals = collectToolInputPathLiterals(event, state.runtime_config.path_validation.path_keys);
  return validatePathLiterals(literals, state, isWriteIntent(event));
}

export function validateDocumentPathLiterals(
  content: string,
  state: GovernanceState
): PathLiteralFinding[] {
  if (!state.runtime_config.path_validation.enabled) return [];
  if (!state.runtime_config.path_validation.check_document_literals) return [];

  const literals = collectMarkdownPathLiterals(content);
  return validatePathLiterals(literals, state, false);
}

function collectToolInputPathLiterals(
  event: NormalizedHookEvent,
  pathKeys: string[]
): Array<{ literal: string; source: string }> {
  const out: Array<{ literal: string; source: string }> = [];
  const input = event.tool_input ?? {};
  const normalizedPathKeys = new Set(pathKeys.map((key) => key.toLowerCase()));

  function visit(value: unknown, keyPath: string[]): void {
    if (typeof value === "string") {
      const key = keyPath[keyPath.length - 1]?.toLowerCase();
      if (key && normalizedPathKeys.has(key) && isPathCandidate(value)) {
        out.push({ literal: value, source: keyPath.join(".") });
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...keyPath, String(index)]));
      return;
    }

    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, [...keyPath, key]);
      }
    }
  }

  visit(input, ["tool_input"]);
  return out;
}

function collectMarkdownPathLiterals(content: string): Array<{ literal: string; source: string }> {
  const out: Array<{ literal: string; source: string }> = [];
  const codeSpanRe = /`([^`]+)`/g;
  const markdownLinkRe = /\[[^\]]+\]\(([^)]+)\)/g;

  for (const match of content.matchAll(codeSpanRe)) {
    const literal = match[1]?.trim();
    if (literal && isPathCandidate(literal)) out.push({ literal, source: "markdown.code_span" });
  }

  for (const match of content.matchAll(markdownLinkRe)) {
    const literal = match[1]?.trim();
    if (literal && isPathCandidate(literal)) out.push({ literal, source: "markdown.link" });
  }

  return out;
}

function validatePathLiterals(
  literals: Array<{ literal: string; source: string }>,
  state: GovernanceState,
  writeIntent: boolean
): PathLiteralFinding[] {
  const findings: PathLiteralFinding[] = [];

  for (const item of literals) {
    const literal = stripLocationSuffix(item.literal.trim());
    if (!isPathCandidate(literal)) continue;

    if (literal.includes("\0")) {
      findings.push({
        ...item,
        literal,
        severity: "error",
        reason: "Path literal contains a null byte.",
      });
      continue;
    }

    const normalized = normalizePath(literal, state.cwd);
    if (path.relative(state.cwd, normalized).startsWith("..")) {
      findings.push({
        ...item,
        literal,
        severity: "warn",
        reason: "Path literal points outside the repository root.",
        normalized_path: normalized,
      });
      continue;
    }

    if (!writeIntent && !fs.existsSync(normalized)) {
      findings.push({
        ...item,
        literal,
        severity: "warn",
        reason: "Path literal does not resolve to an existing file or directory.",
        normalized_path: normalized,
      });
    }
  }

  return findings;
}

function normalizePath(literal: string, cwd: string): string {
  if (literal.startsWith("~/")) {
    return path.resolve(process.env["HOME"] ?? cwd, literal.slice(2));
  }
  return path.isAbsolute(literal) ? path.normalize(literal) : path.resolve(cwd, literal);
}

function stripLocationSuffix(literal: string): string {
  return literal.replace(/:\d+(?::\d+)?$/, "");
}

function isPathCandidate(value: string): boolean {
  if (!value || URL_RE.test(value)) return false;
  if (!PATHISH_RE.test(value)) return false;
  if (value.includes("*")) return false;
  if (PACKAGE_RE.test(value) && !value.includes(".")) return false;
  return true;
}

function isWriteIntent(event: NormalizedHookEvent): boolean {
  const toolName = event.tool_name ?? "";
  return WRITE_TOOLS.has(toolName);
}
