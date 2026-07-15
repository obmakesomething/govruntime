import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withFileLock } from "./file_lock.js";

interface IdSequenceState {
  version: "gr.id-sequences.v1";
  sequences: Record<string, number>;
  updated_at?: string;
}

const SOURCE_PATHS: Record<string, string[]> = {
  CASE: ["cases"],
  CON: ["conflicts"],
  DEC: ["decisions"],
  DCK: ["docket/docket_events.jsonl"],
  EV: ["evidence/evidence.jsonl"],
  INV: ["invariants"],
  JDG: ["audit/judgments.jsonl"],
  SIM: ["simulations/risk_runs.jsonl"],
};

export function reservePersistentSequence(cwd: string, prefix: string, date: string): number {
  if (!cwd) throw new Error("Governance ID allocation requires a cwd.");
  const auditPath = path.join(path.resolve(cwd), ".governance", "audit");
  const statePath = path.join(auditPath, "id-sequences.json");
  const lockPath = path.join(auditPath, ".locks", "id-sequences.lock");
  const key = `${prefix}-${date}`;

  return withFileLock(lockPath, () => {
    const state = readState(statePath);
    const persisted = state.sequences[key] ?? 0;
    const observed = findObservedHighWater(cwd, prefix, date);
    const next = Math.max(persisted, observed) + 1;
    state.sequences[key] = next;
    state.updated_at = new Date().toISOString();
    writeState(statePath, state);
    return next;
  });
}

function readState(filePath: string): IdSequenceState {
  if (!fs.existsSync(filePath)) {
    return { version: "gr.id-sequences.v1", sequences: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw malformedState(filePath, error);
  }

  if (!isRecord(parsed) || parsed["version"] !== "gr.id-sequences.v1" || !isRecord(parsed["sequences"])) {
    throw malformedState(filePath);
  }

  const sequences: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed["sequences"])) {
    if (!Number.isInteger(value) || (value as number) < 0) throw malformedState(filePath);
    sequences[key] = value as number;
  }

  const updatedAt = parsed["updated_at"];
  if (updatedAt !== undefined && typeof updatedAt !== "string") throw malformedState(filePath);
  return {
    version: "gr.id-sequences.v1",
    sequences,
    updated_at: updatedAt as string | undefined,
  };
}

function writeState(filePath: string, state: IdSequenceState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const orderedSequences = Object.fromEntries(
    Object.entries(state.sequences).sort(([left], [right]) => left.localeCompare(right)),
  );
  const content = JSON.stringify({ ...state, sequences: orderedSequences }, null, 2) + "\n";
  const tmp = `${filePath}.tmp.${process.pid}.${crypto.randomUUID()}`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
  fsyncDirectory(path.dirname(filePath));
}

function findObservedHighWater(cwd: string, prefix: string, date: string): number {
  const governanceRoot = path.join(path.resolve(cwd), ".governance");
  const candidates = [
    ...(SOURCE_PATHS[prefix] ?? []),
    "audit/ledger.jsonl",
  ];
  const matcher = new RegExp(`\\b${escapeRegExp(prefix)}-${escapeRegExp(date)}-(\\d+)\\b`, "g");
  let highWater = 0;

  for (const relativePath of candidates) {
    for (const filePath of listFiles(path.join(governanceRoot, relativePath))) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf8");
      } catch (error) {
        throw new Error(`Failed to inspect persisted governance IDs in ${filePath}: ${String(error)}`);
      }
      for (const match of content.matchAll(matcher)) {
        highWater = Math.max(highWater, Number.parseInt(match[1] ?? "0", 10));
      }
    }
  }

  return highWater;
}

function listFiles(targetPath: string): string[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(targetPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
  if (stat.isFile()) return [targetPath];
  if (!stat.isDirectory()) return [];
  return fs.readdirSync(targetPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => listFiles(path.join(targetPath, entry.name)));
}

function malformedState(filePath: string, cause?: unknown): Error {
  const detail = cause instanceof Error ? ` ${cause.message}` : "";
  return new Error(`Malformed governance ID sequence state at ${filePath}.${detail}`);
}

function fsyncDirectory(directoryPath: string): void {
  const fd = fs.openSync(directoryPath, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
