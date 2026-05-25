import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { readGitHead } from "../audit/ledger.js";
import type { GovernanceState, NormalizedHookEvent } from "../state/types.js";
import type { PolicyConfig, PolicyInput } from "./types.js";

const DEFAULT_CONFIG: PolicyConfig = {
  engine: "builtin",
  mode: "enforce",
};

const FILE_KEYS = ["file_path", "path", "target_file", "filename", "file", "filepath"];
const DESTRUCTIVE_PATTERNS: Array<{ signal: string; re: RegExp }> = [
  { signal: "rm", re: /(^|\s)rm\s+/ },
  { signal: "rm_rf", re: /(^|\s)rm\s+-[^\n;]*[rf]/ },
  { signal: "git_reset", re: /(^|\s)git\s+reset(\s+--hard)?\b/ },
  { signal: "git_clean", re: /(^|\s)git\s+clean\b/ },
  { signal: "git_checkout", re: /(^|\s)git\s+checkout\s+(--|[^\n;]*\s--)/ },
  { signal: "git_rm", re: /(^|\s)git\s+rm\b/ },
  { signal: "sed_in_place", re: /(^|\s)sed\s+[^\n;]*-i/ },
  { signal: "perl_in_place", re: /(^|\s)perl\s+[^\n;]*-p[iI]/ },
  { signal: "chmod", re: /(^|\s)chmod\s+/ },
  { signal: "chown", re: /(^|\s)chown\s+/ },
  { signal: "sudo", re: /(^|\s)sudo\s+/ },
  { signal: "drop_table", re: /drop\s+table/i },
  { signal: "truncate_table", re: /truncate\s+table/i },
  { signal: "terraform_apply_destroy", re: /(^|\s)terraform\s+(apply|destroy)\b/ },
  { signal: "kubectl_delete_apply", re: /(^|\s)kubectl\s+(delete|apply)\b/ },
  { signal: "docker_remove", re: /(^|\s)docker\s+(rm|rmi)\b/ },
  { signal: "package_install_lockfile", re: /(^|\s)(npm|yarn|pnpm)\s+(install|add|remove|update)\b/ },
  { signal: "script_may_write", re: /(^|\s)(python|python3|node)\s+[^\n;]*(write|generate|migrate|seed|fix|update)/i },
];

export function loadPolicyConfig(cwd: string): PolicyConfig {
  const filePath = path.join(cwd, ".governance", "policy.yaml");
  try {
    const raw = yaml.load(fs.readFileSync(filePath, "utf8")) as Partial<PolicyConfig> | null;
    if (!raw) return DEFAULT_CONFIG;
    return {
      engine: raw.engine === "opa" ? "opa" : "builtin",
      mode: raw.mode === "advisory" ? "advisory" : "enforce",
      entrypoint: typeof raw.entrypoint === "string" ? raw.entrypoint : undefined,
      policy_dir: typeof raw.policy_dir === "string" ? raw.policy_dir : undefined,
      data_dir: typeof raw.data_dir === "string" ? raw.data_dir : undefined,
      policy_version: typeof raw.policy_version === "string" ? raw.policy_version : undefined,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function buildPolicyInput(event: NormalizedHookEvent, state: GovernanceState, config = loadPolicyConfig(state.cwd)): PolicyInput {
  const command = getCommand(event);
  const targetPaths = unique([...extractToolPaths(event), ...extractCommandPaths(command, state.cwd)]);
  const destructiveSignals = extractDestructiveSignals(event.tool_name, command);
  const explicitScopeExpansion = truthy(event.tool_input?.["explicit_scope_expansion"] ?? event.metadata["explicit_scope_expansion"]);
  const explicitDestructiveAction = truthy(event.tool_input?.["explicit_destructive_action"] ?? event.metadata["explicit_destructive_action"]);
  const humanApprovalIds = readStringArray(event.tool_input?.["human_approval_ids"] ?? event.metadata["human_approval_ids"]);

  return {
    event: {
      hook: event.hook_event_name,
      platform: event.platform,
      tool_name: event.tool_name,
      command,
      target_paths: targetPaths,
      diff_paths: extractDiffPaths(event),
      destructive_signals: destructiveSignals,
    },
    actor: {
      type: event.hook_event_name === "UserPromptSubmit" ? "user" : "hook",
      agent: event.platform,
      session_id: event.session_id,
    },
    governance: {
      active_case: state.active_case ? { case_id: state.active_case.case_id, status: state.active_case.status } : undefined,
      active_ticket: state.active_ticket ? {
        ticket_id: state.active_ticket.ticket_id,
        status: state.active_ticket.status,
        acceptance_criteria: state.active_ticket.acceptance_criteria,
        non_goals: state.active_ticket.non_goals,
        risk_profile: state.active_ticket.risk_profile,
      } : undefined,
      active_branch: state.active_branch ? {
        branch: state.active_branch.branch,
        intended_scope: state.active_branch.intended_scope,
        forbidden_scope: state.active_branch.forbidden_scope,
      } : undefined,
    },
    repo: {
      git_head: readGitHead(state.cwd),
      high_risk_paths: collectPolicyPaths(state.regulations, ["high_risk_paths", "highRiskPaths", "high_risk"]),
      protected_paths: collectPolicyPaths(state.regulations, ["protected_paths", "protectedPaths", "protected"]),
    },
    authorization: {
      explicit_scope_expansion: explicitScopeExpansion,
      explicit_destructive_action: explicitDestructiveAction,
      human_approval_ids: humanApprovalIds,
    },
    policy_context: {
      engine: config.engine,
      mode: config.mode,
      policy_version: config.policy_version,
    },
  };
}

export function extractDestructiveSignals(toolName?: string, command?: string): string[] {
  const signals: string[] = [];
  const normalizedTool = String(toolName ?? "").toLowerCase();
  if (["rm", "delete", "drop", "truncate"].includes(normalizedTool)) signals.push(`tool.${normalizedTool}`);
  if (!command) return unique(signals);
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.re.test(command)) signals.push(pattern.signal);
  }
  return unique(signals);
}

function getCommand(event: NormalizedHookEvent): string | undefined {
  const value = event.tool_input?.["command"] ?? event.tool_input?.["cmd"] ?? event.tool_input?.["script"];
  return typeof value === "string" ? value : undefined;
}

function extractToolPaths(event: NormalizedHookEvent): string[] {
  const out: string[] = [];
  const input = event.tool_input ?? {};
  for (const key of FILE_KEYS) {
    const value = input[key];
    if (typeof value === "string") out.push(normalizePolicyPath(value, event.cwd));
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string") out.push(normalizePolicyPath(item, event.cwd));
    }
  }
  return out;
}

function extractCommandPaths(command: string | undefined, cwd: string): string[] {
  if (!command) return [];
  const out: string[] = [];
  const tokenRe = /(?:^|\s)(\.?\.?\/?[A-Za-z0-9_.@/-]+\.[A-Za-z0-9_/-]+|\.?\.?\/?[A-Za-z0-9_.@/-]+\/[^\s;|&]+)/g;
  for (const match of command.matchAll(tokenRe)) {
    const token = match[1]?.replace(/^['"]|['"]$/g, "");
    if (token && isPathish(token)) out.push(normalizePolicyPath(token, cwd));
  }
  return out;
}

function extractDiffPaths(event: NormalizedHookEvent): string[] {
  const raw = event.tool_output?.["diff_paths"] ?? event.tool_output?.["changed_files"];
  return readStringArray(raw);
}

function normalizePolicyPath(value: string, cwd: string): string {
  const stripped = value.trim().replace(/:\d+(?::\d+)?$/, "");
  if (path.isAbsolute(stripped)) {
    const rel = path.relative(cwd, stripped);
    return rel.startsWith("..") ? stripped : rel || ".";
  }
  return stripped.replace(/^\.\//, "");
}

function isPathish(value: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return value.includes("/") || /\.[A-Za-z0-9]+$/.test(value);
}

function truthy(value: unknown): boolean {
  return value === true || value === "true" || value === "yes" || value === 1;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function collectPolicyPaths(regulations: Record<string, unknown>, keys: string[]): string[] {
  const out: string[] = [];
  function visit(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const raw = record[key];
      if (Array.isArray(raw)) {
        for (const item of raw) if (typeof item === "string") out.push(item);
      }
    }
    for (const child of Object.values(record)) visit(child);
  }
  visit(regulations);
  return unique(out);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
