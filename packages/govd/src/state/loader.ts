/**
 * Governance State Loader
 *
 * Reads .governance/ YAML and JSONL files into a typed GovernanceState.
 * All reads are synchronous for simplicity in hook adapter context.
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type {
  GovernanceState,
  Case,
  Ticket,
  Precedent,
  BranchLedger,
  ConstitutionConfig,
  DocketEvent,
  Evidence,
  BranchEntry,
  ArchitectureDecision,
  ArchitectureInvariant,
  RuntimeConfig,
  RuntimeEnforcementMode,
  RuntimeProductMode,
} from "./types.js";

const GOVERNANCE_DIR = ".governance";
const EPOCH_TIMESTAMP = new Date(0).toISOString();
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))?)?$/;

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  namespace: "@govruntime",
  product_mode: "development",
  enforcement_mode: "advisory",
  clean_state_log: "audit/clean_state.jsonl",
  path_validation: {
    enabled: true,
    check_tool_inputs: true,
    check_document_literals: true,
    block_missing_existing_paths_in_hard_mode: true,
    path_keys: [
      "file",
      "file_path",
      "filepath",
      "filename",
      "path",
      "paths",
      "target_file",
      "target_path",
    ],
  },
};

function govPath(cwd: string, ...parts: string[]): string {
  return path.join(cwd, GOVERNANCE_DIR, ...parts);
}

function readYamlFile<T = any>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return path.extname(filePath).toLowerCase() === ".json"
      ? JSON.parse(raw) as T
      : yaml.load(raw) as T;
  } catch {
    return null;
  }
}

function readJsonlFile<T = any>(filePath: string): T[] {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

function readAllYamlFiles<T>(dirPath: string): T[] {
  try {
    const entries = fs.readdirSync(dirPath).sort();
    const results: T[] = [];
    for (const entry of entries) {
      if (entry.endsWith(".yaml") || entry.endsWith(".yml")) {
        const obj = readYamlFile<T>(path.join(dirPath, entry));
        if (obj) results.push(obj);
      }
    }
    return results;
  } catch {
    return [];
  }
}

function readAllStructuredFiles<T>(dirPath: string): T[] {
  try {
    const entries = fs.readdirSync(dirPath).sort((a, b) => {
      const priority = (entry: string) => entry.endsWith(".yaml") || entry.endsWith(".yml") ? 0 : 1;
      return priority(a) - priority(b) || a.localeCompare(b);
    });
    const results: T[] = [];
    for (const entry of entries) {
      if (entry.endsWith(".yaml") || entry.endsWith(".yml") || entry.endsWith(".json")) {
        const obj = readYamlFile<T>(path.join(dirPath, entry));
        if (obj) results.push(obj);
      }
    }
    return results;
  } catch {
    return [];
  }
}

function readAllStatutes(cwd: string): Record<string, unknown> {
  const statuteDir = govPath(cwd, "statutes");
  const statutes: Record<string, unknown> = {};
  try {
    const entries = fs.readdirSync(statuteDir);
    for (const entry of entries) {
      if (entry.endsWith(".yaml") || entry.endsWith(".yml")) {
        const name = path.basename(entry, path.extname(entry));
        const obj = readYamlFile(path.join(statuteDir, entry));
        if (obj) statutes[name] = obj;
      }
    }
  } catch {
    // no statutes dir yet
  }
  return statutes;
}

function readAllRegulations(cwd: string): Record<string, unknown> {
  const regDir = govPath(cwd, "regulations");
  const regs: Record<string, unknown> = {};
  try {
    const entries = fs.readdirSync(regDir);
    for (const entry of entries) {
      if (entry.endsWith(".yaml") || entry.endsWith(".yml")) {
        const name = path.basename(entry, path.extname(entry));
        const obj = readYamlFile(path.join(regDir, entry));
        if (obj) regs[name] = obj;
      }
    }
  } catch {
    // no regulations dir yet
  }
  return regs;
}

function findActiveCase(cases: Case[], current: Record<string, unknown> | null): Case | null {
  const currentCaseId = typeof current?.["active_case_id"] === "string" ? current["active_case_id"] : null;
  if (currentCaseId) {
    const selected = cases.find((c) => c.case_id === currentCaseId);
    if (selected && isActiveCase(selected)) return selected;
  }
  const active = cases.filter(isActiveCase);
  if (active.length === 0) return null;
  // Return most recently opened
  return active.sort((a, b) =>
    b.opened_at.localeCompare(a.opened_at) || a.case_id.localeCompare(b.case_id)
  )[0] ?? null;
}

function findActiveTicket(tickets: Ticket[], activeCase: Case | null, current: Record<string, unknown> | null): Ticket | null {
  if (!activeCase) return null;
  const currentTicketId = typeof current?.["active_ticket_id"] === "string" ? current["active_ticket_id"] : null;
  if (currentTicketId) {
    const selected = tickets.find((t) => t.ticket_id === currentTicketId && t.case_id === activeCase.case_id);
    if (selected && isActiveTicket(selected)) return selected;
  }
  const candidates = tickets.filter(
    (t) => t.case_id === activeCase.case_id && isActiveTicket(t)
  );
  if (candidates.length === 0) return null;
  // Return most recently updated
  return candidates.sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at) || a.ticket_id.localeCompare(b.ticket_id)
  )[0] ?? null;
}

function findActiveBranch(
  ledger: BranchLedger,
  activeTicket: Ticket | null,
  current: Record<string, unknown> | null
): BranchEntry | null {
  if (!activeTicket) return null;
  const currentBranch = typeof current?.["active_branch"] === "string" ? current["active_branch"] : null;
  if (currentBranch) {
    const selected = ledger.branches.find(
      (b) =>
        b.branch === currentBranch &&
        b.case_id === activeTicket.case_id &&
        b.ticket_id === activeTicket.ticket_id &&
        b.status === "active"
    );
    if (selected) return selected;
  }
  return (
    ledger.branches
      .filter(
        (b) =>
          b.case_id === activeTicket.case_id &&
          b.ticket_id === activeTicket.ticket_id &&
          b.status === "active"
      )
      .sort((a, b) => a.branch.localeCompare(b.branch))[0] ?? null
  );
}

function isActiveCase(value: Case): boolean {
  return ["OPEN", "UNDER_REVIEW", "UNDER_JUDGMENT", "ENFORCING"].includes(value.status);
}

function isActiveTicket(value: Ticket): boolean {
  return ["DRAFT", "READY", "ANALYZED", "ASSIGNED", "IN_PROGRESS", "VERIFYING", "SIMULATING"].includes(value.status);
}

function normalizeProductMode(value: unknown): RuntimeProductMode {
  return value === "production" ? "production" : "development";
}

function normalizeEnforcementMode(value: unknown): RuntimeEnforcementMode {
  return value === "hard-block" ? "hard-block" : "advisory";
}

function loadRuntimeConfig(constitution: ConstitutionConfig | null): RuntimeConfig {
  const runtime = constitution?.runtime ?? {};
  const pathValidation = (runtime.path_validation ?? {}) as Partial<RuntimeConfig["path_validation"]>;

  return {
    ...DEFAULT_RUNTIME_CONFIG,
    product_mode: normalizeProductMode(runtime.product_mode),
    enforcement_mode: normalizeEnforcementMode(
      process.env["GOVRUNTIME_ENFORCEMENT_MODE"] ?? runtime.enforcement_mode
    ),
    clean_state_log:
      typeof runtime.clean_state_log === "string"
        ? runtime.clean_state_log
        : DEFAULT_RUNTIME_CONFIG.clean_state_log,
    path_validation: {
      ...DEFAULT_RUNTIME_CONFIG.path_validation,
      ...pathValidation,
      path_keys: Array.isArray(pathValidation.path_keys)
        ? pathValidation.path_keys
        : DEFAULT_RUNTIME_CONFIG.path_validation.path_keys,
    },
  };
}

function normalizeLegacyConstitution(raw: Record<string, unknown> | null): ConstitutionConfig | null {
  if (!raw) return null;
  return {
    version: String(raw["version"] ?? "0.1"),
    runtime: raw["runtime"] as ConstitutionConfig["runtime"],
    mission: stringArray(raw["mission"]),
    non_negotiables: stringArray(raw["non_negotiables"]),
    authority_hierarchy: stringArray(raw["authority_hierarchy"]),
    standard_of_proof: {
      casual_answer: { required: "plausible_basis", threshold: 0.5 },
      design_decision: { required: "evidence_supported", threshold: 0.7 },
      code_change: { required: "clear_and_convincing", threshold: 0.8 },
      destructive_action: { required: "explicit_authorization", threshold: 0.95 },
      policy_override: { required: "human_approval", threshold: 1 },
      ...(isRecord(raw["standard_of_proof"]) ? raw["standard_of_proof"] : {}),
    },
  };
}

function normalizeCase(raw: Record<string, unknown>): Case {
  const applicableLaw = raw["applicable_law"];
  const closedAt = normalizeTimestamp(raw["closed_at"]);
  return {
    case_id: String(raw["case_id"] ?? raw["id"] ?? ""),
    status: normalizeAllowedEnum(
      raw["status"],
      ["DRAFT", "OPEN", "UNDER_REVIEW", "UNDER_JUDGMENT", "JUDGED", "ENFORCING", "CLOSED", "STAYED", "APPEALED", "REOPENED", "SUPERSEDED"],
      "DRAFT"
    ) as Case["status"],
    title: String(raw["title"] ?? raw["issue"] ?? "Untitled governance case"),
    opened_at: normalizeRequiredTimestamp(raw["opened_at"] ?? raw["created_at"] ?? raw["updated_at"]),
    ...(closedAt ? { closed_at: closedAt } : {}),
    issue: stringArray(raw["issue"]),
    claims: isRecord(raw["claims"])
      ? raw["claims"] as Case["claims"]
      : { user_claims: stringArray(raw["why_now"]) },
    evidence: stringArray(raw["evidence"]),
    applicable_law: isRecord(applicableLaw)
      ? {
          constitution: stringArray(applicableLaw["constitution"]),
          statutes: stringArray(applicableLaw["statutes"]),
        }
      : { constitution: stringArray(applicableLaw), statutes: [] },
    precedents: stringArray(raw["precedents"]),
    judgment: isRecord(raw["judgment"]) ? {
      decision: String(raw["judgment"]["decision"] ?? ""),
      rationale: stringArray(raw["judgment"]["rationale"]),
      orders: Array.isArray(raw["judgment"]["orders"])
        ? raw["judgment"]["orders"].filter(isRecord).map((order) => ({ ...order, type: String(order["type"] ?? "legacy") }))
        : [],
    } : undefined,
    related_tickets: stringArray(raw["related_tickets"]).concat(typeof raw["active_ticket_id"] === "string" ? [raw["active_ticket_id"]] : []),
    tags: stringArray(raw["tags"]),
  };
}

function normalizeTicket(raw: Record<string, unknown>): Ticket {
  const ticketId = String(raw["ticket_id"] ?? raw["id"] ?? "");
  const closedAt = normalizeTimestamp(raw["closed_at"]);
  return {
    ticket_id: ticketId,
    revision: positiveInteger(raw["revision"], revisionFromId(ticketId) ?? 1),
    case_id: String(raw["case_id"] ?? ""),
    status: normalizeAllowedEnum(
      raw["status"],
      ["DRAFT", "ANALYZED", "SIMULATING", "READY", "ASSIGNED", "IN_PROGRESS", "VERIFYING", "DONE", "BLOCKED_BY_CONFLICT", "BLOCKED_BY_AMBIGUITY", "BLOCKED_BY_POLICY", "NEEDS_REISSUE", "SUPERSEDED", "PAUSED", "CANCELLED"],
      "DRAFT"
    ) as Ticket["status"],
    workstream_status: normalizeAllowedEnum(
      raw["workstream_status"],
      ["ACTIVE", "PAUSED", "STAYED", "BLOCKED", "SUPERSEDED", "ABANDONED", "MERGED", "SPLIT", "DEFERRED", "OVERRULED", "DONE"],
      "ACTIVE"
    ) as Ticket["workstream_status"],
    title: String(raw["title"] ?? "Untitled governance ticket"),
    objective: String(raw["objective"] ?? raw["title"] ?? ""),
    reason_for_reissue: typeof raw["reason_for_reissue"] === "string" ? raw["reason_for_reissue"] : undefined,
    supersedes: typeof raw["supersedes"] === "string" ? raw["supersedes"] : undefined,
    acceptance_criteria: stringArray(raw["acceptance_criteria"]),
    non_goals: stringArray(raw["non_goals"]),
    dependencies: stringArray(raw["dependencies"]),
    assigned_agent: normalizeAssignedAgent(raw["assigned_agent"]),
    risk_profile: normalizeRiskProfile(raw["risk_profile"]),
    verification_plan: normalizeVerificationPlan(raw["verification_plan"], raw["validation_plan"]),
    created_at: normalizeRequiredTimestamp(raw["created_at"] ?? raw["updated_at"]),
    updated_at: normalizeRequiredTimestamp(raw["updated_at"] ?? raw["created_at"]),
    ...(closedAt ? { closed_at: closedAt } : {}),
  };
}

function normalizeBranch(raw: BranchEntry): BranchEntry {
  const exitConditions = raw.exit_conditions;
  const { merged_at: _mergedAt, abandoned_at: _abandonedAt, ...rawWithoutOptionalTimestamps } = raw;
  const mergedAt = normalizeTimestamp(raw.merged_at);
  const abandonedAt = normalizeTimestamp(raw.abandoned_at);
  return {
    ...rawWithoutOptionalTimestamps,
    branch: String(raw.branch ?? ""),
    case_id: String(raw.case_id ?? ""),
    ticket_id: String(raw.ticket_id ?? ""),
    branch_type: String(raw.branch_type ?? "unknown"),
    status: normalizeAllowedEnum(
      raw.status,
      ["ACTIVE", "MERGED", "ABANDONED", "BLOCKED", "PAUSED"],
      "PAUSED"
    ).toLowerCase() as BranchEntry["status"],
    reason_created: stringArray(raw.reason_created),
    intended_scope: stringArray(raw.intended_scope),
    forbidden_scope: stringArray(raw.forbidden_scope),
    parent_branch: String(raw.parent_branch ?? ""),
    success_criteria: stringArray(raw.success_criteria),
    exit_conditions: isRecord(exitConditions) && Array.isArray(exitConditions["merge_when"])
      ? exitConditions as BranchEntry["exit_conditions"]
      : { merge_when: stringArray(exitConditions), abandon_when: [] },
    created_at: normalizeRequiredTimestamp(raw.created_at),
    ...(mergedAt ? { merged_at: mergedAt } : {}),
    ...(abandonedAt ? { abandoned_at: abandonedAt } : {}),
  };
}

function normalizeRequiredTimestamp(value: unknown): string {
  return normalizeTimestamp(value) ?? EPOCH_TIMESTAMP;
}

function normalizeTimestamp(value: unknown): string | undefined {
  const timestamp = value instanceof Date
    ? value.getTime()
    : typeof value === "string"
      ? parseIsoTimestamp(value)
      : Number.NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function parseIsoTimestamp(value: string): number {
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) return Number.NaN;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  calendarDate.setUTCHours(0, 0, 0, 0);
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return Number.NaN;
  }

  if (hourText == null) return calendarDate.getTime();
  if (
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59 ||
    (offsetHourText != null && Number(offsetHourText) > 23) ||
    (offsetMinuteText != null && Number(offsetMinuteText) > 59)
  ) {
    return Number.NaN;
  }

  return Date.parse(zone ? value : `${value}Z`);
}

function normalizeAssignedAgent(value: unknown): Ticket["assigned_agent"] {
  if (!isRecord(value)) return { primary: "unknown", human_review_required: false };
  return {
    primary: String(value["primary"] ?? "unknown"),
    reviewer: typeof value["reviewer"] === "string" ? value["reviewer"] : undefined,
    human_review_required: value["human_review_required"] === true,
  };
}

function normalizeRiskProfile(value: unknown): Ticket["risk_profile"] {
  const record = isRecord(value) ? value : {};
  const blastRadius = String(record["blast_radius"] ?? "medium");
  return {
    ambiguity: boundedNumber(record["ambiguity"]),
    scope_drift: boundedNumber(record["scope_drift"]),
    implementation_complexity: boundedNumber(record["implementation_complexity"]),
    verification_strength: boundedNumber(record["verification_strength"]),
    blast_radius: (["low", "medium", "high", "critical"].includes(blastRadius) ? blastRadius : "medium") as Ticket["risk_profile"]["blast_radius"],
  };
}

function normalizeVerificationPlan(value: unknown, fallback: unknown): Ticket["verification_plan"] {
  if (isRecord(value) && Array.isArray(value["steps"])) {
    return { steps: stringArray(value["steps"]) };
  }
  return { steps: stringArray(fallback) };
}

function normalizeAllowedEnum(value: unknown, allowed: readonly string[], fallback: string): string {
  const normalized = typeof value === "string" ? value.toUpperCase() : fallback;
  return allowed.includes(normalized) ? normalized : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
}

function revisionFromId(ticketId: string): number | null {
  const match = /-R(\d+)$/i.exec(ticketId);
  return match ? Number(match[1]) : null;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCase(value: Case): boolean {
  return Boolean(value.case_id);
}

function isTicket(value: Ticket): boolean {
  return Boolean(value.ticket_id && value.case_id);
}

function isBranchEntry(value: BranchEntry): boolean {
  return Boolean(value.branch && value.case_id && value.ticket_id);
}

function dedupeBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identifier = key(value);
    if (!identifier || seen.has(identifier)) return false;
    seen.add(identifier);
    return true;
  });
}

export function loadState(cwd: string): GovernanceState {
  const governanceDir = govPath(cwd);
  const current = readYamlFile<Record<string, unknown>>(govPath(cwd, "current.json"));

  const constitution = readYamlFile<ConstitutionConfig>(
    govPath(cwd, "constitution.yaml")
  ) ?? normalizeLegacyConstitution(readYamlFile<Record<string, unknown>>(govPath(cwd, "constitution.json")));

  const statutes = readAllStatutes(cwd);
  const regulations = readAllRegulations(cwd);

  const cases = dedupeBy(
    readAllStructuredFiles<Record<string, unknown>>(govPath(cwd, "cases")).map(normalizeCase).filter(isCase),
    (item) => item.case_id
  );
  const tickets = dedupeBy(
    readAllStructuredFiles<Record<string, unknown>>(govPath(cwd, "tickets")).map(normalizeTicket).filter(isTicket),
    (item) => item.ticket_id
  );
  const decisions = dedupeBy(
    readAllStructuredFiles<ArchitectureDecision>(govPath(cwd, "decisions")),
    (item) => item.decision_id
  );
  const invariants = dedupeBy(
    readAllStructuredFiles<ArchitectureInvariant>(govPath(cwd, "invariants")),
    (item) => item.invariant_id
  );
  const activePrecedents = readAllStructuredFiles<Precedent>(
    govPath(cwd, "precedents", "active")
  );
  const overruledPrecedents = readAllStructuredFiles<Precedent>(
    govPath(cwd, "precedents", "overruled")
  );
  const precedents = dedupeBy([...activePrecedents, ...overruledPrecedents], (item) => item.precedent_id);

  const rawLedger = readYamlFile<{ branches: BranchEntry[] }>(
    govPath(cwd, "branches", "branch_ledger.yaml")
  ) ?? readYamlFile<{ branches: BranchEntry[] }>(govPath(cwd, "branches", "branch_ledger.json"));
  const rawBranches = Array.isArray(rawLedger?.branches) ? rawLedger.branches : [];
  const branchLedger: BranchLedger = {
    branches: rawBranches.filter(isRecord).map(normalizeBranch).filter(isBranchEntry),
  };

  const activeCase = findActiveCase(cases, current);
  const activeTicket = findActiveTicket(tickets, activeCase, current);
  const activeBranch = findActiveBranch(branchLedger, activeTicket, current);
  const runtimeConfig = loadRuntimeConfig(constitution);

  return {
    cwd,
    governance_dir: governanceDir,
    runtime_config: runtimeConfig,
    constitution,
    statutes,
    regulations,
    cases,
    tickets,
    precedents,
    decisions,
    invariants,
    branch_ledger: branchLedger,
    active_case: activeCase,
    active_ticket: activeTicket,
    active_branch: activeBranch,
  };
}

// Re-export helper readers for use in other modules
export { readYamlFile, readJsonlFile, readAllYamlFiles, govPath };
export type { DocketEvent, Evidence };
