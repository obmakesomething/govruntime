import fs from "node:fs";
import path from "node:path";
import type {
  ArchitectureDecision,
  ArchitectureInvariant,
  CaseId,
  DecisionId,
  EvidenceId,
  GovernanceState,
  InvariantBlockedPattern,
  InvariantId,
  TicketId,
} from "../state/types.js";
import { newDecisionId, newInvariantId, nowISO } from "../state/ids.js";
import { writeDecision, writeInvariant } from "../state/writer.js";

export interface RecordDecisionInput {
  title: string;
  statement?: string;
  scope?: string[];
  evidence?: EvidenceId[];
  case_id?: CaseId;
  ticket_id?: TicketId;
  rationale?: string[];
}

export interface CreateInvariantInput {
  name: string;
  title?: string;
  decision_id?: DecisionId;
  case_id?: CaseId;
  ticket_id?: TicketId;
  scope?: string[];
  rule?: string[];
  blocked_patterns?: Array<string | InvariantBlockedPattern>;
  required_checks?: string[];
  required_ticket_acceptance_criteria?: string[];
  override_requires?: string[];
  linked_tickets?: TicketId[];
}

export interface InvariantFinding {
  invariant_id: InvariantId;
  invariant_name: string;
  status: "pass" | "fail" | "skipped";
  rule: string;
  path?: string;
  pattern?: string;
  reason: string;
}

export function recordDecision(cwd: string, input: RecordDecisionInput): ArchitectureDecision {
  const now = nowISO();
  const decision: ArchitectureDecision = {
    decision_id: newDecisionId(),
    status: "active",
    title: input.title,
    statement: input.statement ?? input.title,
    scope: input.scope ?? [],
    evidence: input.evidence ?? [],
    case_id: input.case_id,
    ticket_id: input.ticket_id,
    rationale: input.rationale ?? [],
    created_at: now,
  };
  writeDecision(cwd, decision);
  return decision;
}

export function createInvariant(cwd: string, input: CreateInvariantInput): ArchitectureInvariant {
  const invariant: ArchitectureInvariant = {
    invariant_id: newInvariantId(),
    status: "active",
    name: input.name,
    title: input.title ?? input.name.replace(/[-_]+/g, " "),
    decision_id: input.decision_id,
    case_id: input.case_id,
    ticket_id: input.ticket_id,
    scope: input.scope ?? [],
    rule: input.rule ?? [],
    blocked_patterns: input.blocked_patterns ?? [],
    required_checks: input.required_checks ?? [],
    required_ticket_acceptance_criteria: input.required_ticket_acceptance_criteria ?? [],
    override_requires: input.override_requires ?? ["explicit user reauthorization", "ticket reissue", "docket event"],
    linked_tickets: input.linked_tickets ?? [],
    created_at: nowISO(),
  };
  writeInvariant(cwd, invariant);
  return invariant;
}

export function findActiveInvariants(state: GovernanceState): ArchitectureInvariant[] {
  return state.invariants.filter((invariant) => invariant.status === "active");
}

export function checkInvariants(state: GovernanceState): InvariantFinding[] {
  const findings: InvariantFinding[] = [];
  for (const invariant of findActiveInvariants(state)) {
    if (invariant.blocked_patterns.length === 0) {
      findings.push({
        invariant_id: invariant.invariant_id,
        invariant_name: invariant.name,
        status: "skipped",
        rule: "invariant.no_blocked_patterns",
        reason: "No blocked patterns are configured for this invariant.",
      });
      continue;
    }

    for (const blocked of invariant.blocked_patterns) {
      const normalized = normalizeBlockedPattern(blocked);
      if (!normalized.path) {
        findings.push({
          invariant_id: invariant.invariant_id,
          invariant_name: invariant.name,
          status: "skipped",
          rule: "invariant.pattern_without_path",
          pattern: normalized.pattern,
          reason: "Pattern has no path; static check skipped.",
        });
        continue;
      }

      const paths = resolveCandidatePaths(state.cwd, normalized.path);
      if (paths.length === 0) {
        findings.push({
          invariant_id: invariant.invariant_id,
          invariant_name: invariant.name,
          status: "skipped",
          rule: "invariant.path_not_found",
          path: normalized.path,
          pattern: normalized.pattern,
          reason: "Configured path did not resolve in this repository.",
        });
        continue;
      }

      for (const candidate of paths) {
        const relativePath = path.relative(state.cwd, candidate);
        const content = fs.readFileSync(candidate, "utf8");
        const regex = new RegExp(normalized.pattern, "m");
        if (regex.test(content)) {
          findings.push({
            invariant_id: invariant.invariant_id,
            invariant_name: invariant.name,
            status: "fail",
            rule: "invariant.blocked_pattern_found",
            path: relativePath,
            pattern: normalized.pattern,
            reason: normalized.reason ?? `Blocked implementation pattern found for invariant ${invariant.name}.`,
          });
        }
      }
    }
  }

  if (findings.some((finding) => finding.status === "fail")) {
    return findings;
  }

  if (findings.length === 0) {
    return [
      {
        invariant_id: "none",
        invariant_name: "none",
        status: "pass",
        rule: "invariant.no_active_invariants",
        reason: "No active invariants are configured.",
      },
    ];
  }

  findings.push({
    invariant_id: "all",
    invariant_name: "all",
    status: "pass",
    rule: "invariant.no_blocked_patterns_found",
    reason: "No configured blocked implementation patterns were found.",
  });
  return findings;
}

function normalizeBlockedPattern(blocked: string | InvariantBlockedPattern): InvariantBlockedPattern {
  if (typeof blocked === "string") {
    return { pattern: blocked };
  }
  return blocked;
}

function resolveCandidatePaths(cwd: string, pattern: string): string[] {
  const normalized = pattern.replace(/\\/g, "/");
  if (!normalized.includes("*")) {
    const exact = path.resolve(cwd, normalized);
    return fs.existsSync(exact) && fs.statSync(exact).isFile() ? [exact] : [];
  }

  const rootPrefix = normalized.split("*")[0] ?? "";
  const root = rootPrefix.includes("/")
    ? path.resolve(cwd, rootPrefix.slice(0, rootPrefix.lastIndexOf("/")))
    : cwd;
  if (!fs.existsSync(root)) return [];

  const files = walkFiles(root, 300);
  return files.filter((file) => globLikeMatches(path.relative(cwd, file), normalized));
}

function walkFiles(root: string, limit: number): string[] {
  const results: string[] = [];
  const stack = [root];
  while (stack.length > 0 && results.length < limit) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      if (entry.isFile()) results.push(full);
      if (results.length >= limit) break;
    }
  }
  return results;
}

function globLikeMatches(filePath: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§DOUBLESTAR§")
    .replace(/\*/g, "[^/]*")
    .replace(/§DOUBLESTAR§/g, ".*");
  return new RegExp(`^${escaped}$`).test(filePath.replace(/\\/g, "/"));
}
