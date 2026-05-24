/**
 * Governance State Writer
 *
 * Atomic writes to .governance/ YAML and JSONL files.
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { BranchEntry, BranchLedger, Case, Ticket } from "./types.js";
import { govPath } from "./loader.js";

// ---------------------------------------------------------------------------
// Atomic file writer (write to tmp, then rename)
// ---------------------------------------------------------------------------

function atomicWriteFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = filePath + ".tmp." + Date.now();
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// JSONL appender
// ---------------------------------------------------------------------------

export function appendJsonl(filePath: string, record: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const line = JSON.stringify(record) + "\n";
  fs.appendFileSync(filePath, line, "utf8");
}

// ---------------------------------------------------------------------------
// YAML writers
// ---------------------------------------------------------------------------

export function writeYamlFile(filePath: string, data: unknown): void {
  const content = yaml.dump(data, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  });
  atomicWriteFile(filePath, content);
}

// ---------------------------------------------------------------------------
// Domain-specific writers
// ---------------------------------------------------------------------------

export function writeCase(cwd: string, c: Case): void {
  const filePath = govPath(cwd, "cases", `${c.case_id}.yaml`);
  writeYamlFile(filePath, c);
}

export function writeTicket(cwd: string, t: Ticket): void {
  const filePath = govPath(cwd, "tickets", `${t.ticket_id}.yaml`);
  writeYamlFile(filePath, t);
}

export function writeBranchLedger(cwd: string, ledger: BranchLedger): void {
  const filePath = govPath(cwd, "branches", "branch_ledger.yaml");
  writeYamlFile(filePath, ledger);
}

export function appendEvidence(cwd: string, evidence: unknown): void {
  appendJsonl(govPath(cwd, "evidence", "evidence.jsonl"), evidence);
}

export function appendDocketEvent(cwd: string, event: unknown): void {
  appendJsonl(govPath(cwd, "docket", "docket_events.jsonl"), event);
}

export function appendAuditEvent(cwd: string, event: unknown): void {
  appendJsonl(govPath(cwd, "audit", "events.jsonl"), event);
}

export function appendJudgmentLog(cwd: string, judgment: unknown): void {
  appendJsonl(govPath(cwd, "audit", "judgments.jsonl"), judgment);
}

export function appendToolCallLog(cwd: string, entry: unknown): void {
  appendJsonl(govPath(cwd, "audit", "tool_calls.jsonl"), entry);
}

export function appendSimulationLog(cwd: string, sim: unknown): void {
  appendJsonl(govPath(cwd, "simulations", "risk_runs.jsonl"), sim);
}

// ---------------------------------------------------------------------------
// Scaffold writer (used by govctl init)
// ---------------------------------------------------------------------------

export function ensureGovernanceDirs(cwd: string): void {
  const dirs = [
    "cases",
    "tickets",
    "precedents/active",
    "precedents/overruled",
    "evidence",
    "docket",
    "branches",
    "audit",
    "simulations",
    "statutes",
    "regulations",
  ];
  for (const d of dirs) {
    fs.mkdirSync(govPath(cwd, d), { recursive: true });
  }
}

export function touchJsonl(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "", "utf8");
  }
}
