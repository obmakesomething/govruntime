/**
 * Governance State Writer
 *
 * Atomic writes to .governance/ YAML and JSONL files.
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { ArchitectureDecision, ArchitectureInvariant, BranchEntry, BranchLedger, Case, Ticket } from "./types.js";
import { govPath } from "./loader.js";
import { appendLedgerRecord } from "../audit/ledger.js";
import type { AuditStream } from "../audit/types.js";

function atomicWriteFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp." + Date.now();
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

export function appendJsonl(filePath: string, record: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8");
}

export function writeYamlFile(filePath: string, data: unknown): void {
  const content = yaml.dump(data, { indent: 2, lineWidth: 120, noRefs: true });
  atomicWriteFile(filePath, content);
}

export function writeCase(cwd: string, c: Case): void {
  writeYamlFile(govPath(cwd, "cases", `${c.case_id}.yaml`), c);
}

export function writeTicket(cwd: string, t: Ticket): void {
  writeYamlFile(govPath(cwd, "tickets", `${t.ticket_id}.yaml`), t);
}

export function writeDecision(cwd: string, decision: ArchitectureDecision): void {
  writeYamlFile(govPath(cwd, "decisions", `${decision.decision_id}.yaml`), decision);
}

export function writeInvariant(cwd: string, invariant: ArchitectureInvariant): void {
  writeYamlFile(govPath(cwd, "invariants", `${invariant.invariant_id}.yaml`), invariant);
}

export function writeBranchLedger(cwd: string, ledger: BranchLedger): void {
  writeYamlFile(govPath(cwd, "branches", "branch_ledger.yaml"), ledger);
}

export function appendEvidence(cwd: string, evidence: unknown): void {
  appendJsonl(govPath(cwd, "evidence", "evidence.jsonl"), evidence);
  appendGovernanceLedger(cwd, "evidence", evidence);
}

export function appendDocketEvent(cwd: string, event: unknown): void {
  appendJsonl(govPath(cwd, "docket", "docket_events.jsonl"), event);
  appendGovernanceLedger(cwd, "docket", event);
}

export function appendAuditEvent(cwd: string, event: unknown): void {
  appendJsonl(govPath(cwd, "audit", "events.jsonl"), event);
  appendGovernanceLedger(cwd, "audit_event", event);
}

export function appendCleanStateEvent(cwd: string, event: unknown): void {
  appendJsonl(govPath(cwd, "audit", "clean_state.jsonl"), event);
  appendGovernanceLedger(cwd, "audit_event", event);
}

export function appendJudgmentLog(cwd: string, judgment: unknown): void {
  appendJsonl(govPath(cwd, "audit", "judgments.jsonl"), judgment);
  appendGovernanceLedger(cwd, "judgment", judgment);
}

export function appendToolCallLog(cwd: string, entry: unknown): void {
  appendJsonl(govPath(cwd, "audit", "tool_calls.jsonl"), entry);
  appendGovernanceLedger(cwd, "tool_call", entry);
}

export function appendSimulationLog(cwd: string, sim: unknown): void {
  appendJsonl(govPath(cwd, "simulations", "risk_runs.jsonl"), sim);
}

export function ensureGovernanceDirs(cwd: string): void {
  const dirs = [
    "cases",
    "tickets",
    "precedents/active",
    "precedents/overruled",
    "decisions",
    "invariants",
    "exceptions",
    "evidence",
    "docket",
    "branches",
    "linear",
    "skills",
    "audit",
    "audit/checkpoints",
    "simulations",
    "statutes",
    "regulations",
    "policies",
    "policy_data",
  ];
  for (const d of dirs) fs.mkdirSync(govPath(cwd, d), { recursive: true });
}

export function touchJsonl(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "", "utf8");
  }
}

function appendGovernanceLedger(cwd: string, stream: AuditStream, payload: unknown): void {
  const record = isRecord(payload) ? payload : {};
  appendLedgerRecord(cwd, stream, deriveRecordId(stream, record), payload, {
    actor: deriveActor(record),
    case_id: typeof record["case_id"] === "string" ? record["case_id"] : undefined,
    ticket_id: typeof record["ticket_id"] === "string" ? record["ticket_id"] : undefined,
    session_id: typeof record["session_id"] === "string" ? record["session_id"] : undefined,
    created_at: typeof record["created_at"] === "string" ? record["created_at"] : undefined,
  });
}

function deriveRecordId(stream: AuditStream, record: Record<string, unknown>): string {
  for (const key of ["judgment_id", "evidence_id", "event_id", "tool_call_id", "record_id", "id"]) {
    if (typeof record[key] === "string") return record[key];
  }
  return `${stream}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function deriveActor(record: Record<string, unknown>): "user" | "agent" | "hook" | "system" {
  const actor = record["actor"];
  if (actor === "user" || actor === "agent" || actor === "hook" || actor === "system") return actor;
  if (typeof record["event"] === "string" && record["event"].includes("tool")) return "hook";
  return "system";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
