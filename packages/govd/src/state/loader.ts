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
} from "./types.js";

const GOVERNANCE_DIR = ".governance";

function govPath(cwd: string, ...parts: string[]): string {
  return path.join(cwd, GOVERNANCE_DIR, ...parts);
}

function readYamlFile<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return yaml.load(raw) as T;
  } catch {
    return null;
  }
}

function readJsonlFile<T>(filePath: string): T[] {
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
    const entries = fs.readdirSync(dirPath);
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

function findActiveCase(cases: Case[]): Case | null {
  const active = cases.filter(
    (c) =>
      c.status === "OPEN" ||
      c.status === "UNDER_REVIEW" ||
      c.status === "UNDER_JUDGMENT" ||
      c.status === "ENFORCING"
  );
  if (active.length === 0) return null;
  // Return most recently opened
  return active.sort((a, b) =>
    b.opened_at.localeCompare(a.opened_at)
  )[0] ?? null;
}

function findActiveTicket(tickets: Ticket[], activeCase: Case | null): Ticket | null {
  if (!activeCase) return null;
  const candidates = tickets.filter(
    (t) =>
      t.case_id === activeCase.case_id &&
      (t.status === "DRAFT" ||
        t.status === "READY" ||
        t.status === "ANALYZED" ||
        t.status === "ASSIGNED" ||
        t.status === "IN_PROGRESS" ||
        t.status === "VERIFYING" ||
        t.status === "SIMULATING")
  );
  if (candidates.length === 0) return null;
  // Return most recently updated
  return candidates.sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at)
  )[0] ?? null;
}

function findActiveBranch(
  ledger: BranchLedger,
  activeTicket: Ticket | null
): BranchEntry | null {
  if (!activeTicket) return null;
  return (
    ledger.branches.find(
      (b) => b.ticket_id === activeTicket.ticket_id && b.status === "active"
    ) ?? null
  );
}

export function loadState(cwd: string): GovernanceState {
  const governanceDir = govPath(cwd);

  const constitution = readYamlFile<ConstitutionConfig>(
    govPath(cwd, "constitution.yaml")
  );

  const statutes = readAllStatutes(cwd);
  const regulations = readAllRegulations(cwd);

  const cases = readAllYamlFiles<Case>(govPath(cwd, "cases"));
  const tickets = readAllYamlFiles<Ticket>(govPath(cwd, "tickets"));
  const activePrecedents = readAllYamlFiles<Precedent>(
    govPath(cwd, "precedents", "active")
  );
  const overruledPrecedents = readAllYamlFiles<Precedent>(
    govPath(cwd, "precedents", "overruled")
  );
  const precedents = [...activePrecedents, ...overruledPrecedents];

  const rawLedger = readYamlFile<{ branches: BranchEntry[] }>(
    govPath(cwd, "branches", "branch_ledger.yaml")
  );
  const branchLedger: BranchLedger = rawLedger ?? { branches: [] };

  const activeCase = findActiveCase(cases);
  const activeTicket = findActiveTicket(tickets, activeCase);
  const activeBranch = findActiveBranch(branchLedger, activeTicket);

  return {
    cwd,
    governance_dir: governanceDir,
    constitution,
    statutes,
    regulations,
    cases,
    tickets,
    precedents,
    branch_ledger: branchLedger,
    active_case: activeCase,
    active_ticket: activeTicket,
    active_branch: activeBranch,
  };
}

// Re-export helper readers for use in other modules
export { readYamlFile, readJsonlFile, readAllYamlFiles, govPath };
export type { DocketEvent, Evidence };
