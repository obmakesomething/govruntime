import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { canonicalJson, sha256Canonical } from "./canonical.js";
import { withFileLock } from "../state/file_lock.js";
import type {
  AuditCheckpoint,
  AuditContext,
  AuditEnvelope,
  AuditHead,
  AuditStream,
  AuditVerificationFailure,
  AuditVerificationResult,
} from "./types.js";

const GENESIS_HASH = "sha256:genesis";

export function auditDir(cwd: string): string {
  return path.join(cwd, ".governance", "audit");
}

export function ledgerPath(cwd: string): string {
  return path.join(auditDir(cwd), "ledger.jsonl");
}

export function headPath(cwd: string): string {
  return path.join(auditDir(cwd), "head.json");
}

export function checkpointsDir(cwd: string): string {
  return path.join(auditDir(cwd), "checkpoints");
}

export function initialAuditHead(): AuditHead {
  return {
    version: "gr.audit.head.v1",
    last_seq: 0,
    last_hash: GENESIS_HASH,
    updated_at: new Date(0).toISOString(),
  };
}

export function readAuditHead(cwd: string): AuditHead {
  try {
    const parsed = JSON.parse(fs.readFileSync(headPath(cwd), "utf8")) as AuditHead;
    if (parsed.version === "gr.audit.head.v1" && typeof parsed.last_seq === "number" && typeof parsed.last_hash === "string") {
      return parsed;
    }
    return initialAuditHead();
  } catch {
    return initialAuditHead();
  }
}

export function appendLedgerRecord<T>(
  cwd: string,
  stream: AuditStream,
  recordId: string,
  payload: T,
  context: AuditContext = {}
): AuditEnvelope<T> {
  const lockPath = path.join(auditDir(cwd), ".locks", "ledger.lock");
  return withFileLock(lockPath, () => {
    fs.mkdirSync(auditDir(cwd), { recursive: true });
    const head = readAuditHead(cwd);
    const createdAt = context.created_at ?? new Date().toISOString();
    const payloadHash = sha256Canonical(payload);
    const envelopeWithoutHash = omitUndefined({
      version: "gr.audit.v1" as const,
      seq: head.last_seq + 1,
      stream,
      record_id: recordId,
      prev_hash: head.last_hash,
      payload_hash: payloadHash,
      payload,
      case_id: context.case_id,
      ticket_id: context.ticket_id,
      session_id: context.session_id,
      actor: context.actor ?? "system",
      git_head: context.git_head ?? readGitHead(cwd),
      created_at: createdAt,
    });
    const entryHash = sha256Canonical(envelopeWithoutHash);
    const envelope = {
      ...envelopeWithoutHash,
      entry_hash: entryHash,
    } as AuditEnvelope<T>;

    fs.appendFileSync(ledgerPath(cwd), canonicalJson(envelope) + "\n", "utf8");
    writeAuditHead(cwd, {
      version: "gr.audit.head.v1",
      last_seq: envelope.seq,
      last_hash: envelope.entry_hash,
      updated_at: createdAt,
    });

    return envelope;
  });
}

export function readLedger(cwd: string): AuditEnvelope[] {
  try {
    return fs.readFileSync(ledgerPath(cwd), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AuditEnvelope);
  } catch {
    return [];
  }
}

export function verifyAuditLedger(cwd: string): AuditVerificationResult {
  const lines = readLedgerLines(cwd);
  let previousHash = GENESIS_HASH;
  let expectedSeq = 1;
  let checked = 0;

  for (const line of lines) {
    let envelope: AuditEnvelope;
    try {
      envelope = JSON.parse(line) as AuditEnvelope;
    } catch {
      return failed(expectedSeq, "Invalid JSON ledger line.", undefined, undefined, "Ledger line cannot be parsed as JSON.", checked);
    }

    const base = { seq: envelope.seq, stream: envelope.stream, record_id: envelope.record_id };
    if (envelope.version !== "gr.audit.v1") {
      return failedEnvelope(base, "Invalid audit envelope version.", "gr.audit.v1", envelope.version, "Envelope version does not match GovRuntime audit v1.", checked);
    }
    if (envelope.seq !== expectedSeq) {
      return failedEnvelope(base, "Invalid sequence number.", expectedSeq, envelope.seq, "Ledger sequence must increase by exactly 1. A line may have been deleted, inserted, or reordered.", checked);
    }
    if (envelope.prev_hash !== previousHash) {
      return failedEnvelope(base, "Invalid previous hash.", previousHash, envelope.prev_hash, "Hash chain is broken. A previous line may have been changed, deleted, or reordered.", checked);
    }

    const expectedPayloadHash = sha256Canonical(envelope.payload);
    if (envelope.payload_hash !== expectedPayloadHash) {
      return failedEnvelope(base, "Invalid payload hash.", expectedPayloadHash, envelope.payload_hash, "Payload no longer matches the recorded payload hash. The record payload was likely modified.", checked);
    }

    const unsignedEntry = unsignedEnvelope(envelope);
    const expectedEntryHash = sha256Canonical(unsignedEntry);
    if (envelope.entry_hash !== expectedEntryHash) {
      return failedEnvelope(base, "Invalid entry hash.", expectedEntryHash, envelope.entry_hash, "Envelope metadata no longer matches the recorded entry hash.", checked);
    }

    previousHash = envelope.entry_hash;
    expectedSeq += 1;
    checked += 1;
  }

  const head = readAuditHead(cwd);
  const finalSeq = expectedSeq - 1;
  if (head.last_seq !== finalSeq) {
    return failed(finalSeq, "Audit head sequence mismatch.", finalSeq, head.last_seq, "head.json does not match the final ledger sequence.", checked, head);
  }
  if (head.last_hash !== previousHash) {
    return failed(finalSeq, "Audit head hash mismatch.", previousHash, head.last_hash, "head.json does not match the final ledger hash.", checked, head);
  }

  return { ok: true, checked, head };
}

export function inspectLedgerRecord(cwd: string, seq: number): AuditEnvelope | null {
  return readLedger(cwd).find((entry) => entry.seq === seq) ?? null;
}

export function createAuditCheckpoint(cwd: string): AuditCheckpoint {
  const verify = verifyAuditLedger(cwd);
  if (!verify.ok) {
    throw new Error(`Cannot checkpoint invalid audit ledger: ${verify.failure?.reason ?? "unknown failure"}`);
  }
  const head = verify.head ?? readAuditHead(cwd);
  const checkpoint: AuditCheckpoint = {
    version: "gr.checkpoint.v1",
    from_seq: head.last_seq > 0 ? 1 : 0,
    to_seq: head.last_seq,
    tip_hash: head.last_hash,
    git_head: readGitHead(cwd),
    created_at: new Date().toISOString(),
    signature: null,
  };
  fs.mkdirSync(checkpointsDir(cwd), { recursive: true });
  const filePath = path.join(checkpointsDir(cwd), `checkpoint-${head.last_seq}.json`);
  atomicWriteFile(filePath, JSON.stringify(checkpoint, null, 2) + "\n");
  return checkpoint;
}

export function readGitHead(cwd: string): string | undefined {
  try {
    return execSync("git rev-parse --verify HEAD", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function readLedgerLines(cwd: string): string[] {
  try {
    return fs.readFileSync(ledgerPath(cwd), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

function writeAuditHead(cwd: string, head: AuditHead): void {
  fs.mkdirSync(auditDir(cwd), { recursive: true });
  atomicWriteFile(headPath(cwd), JSON.stringify(head, null, 2) + "\n");
}

function atomicWriteFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

function unsignedEnvelope(envelope: AuditEnvelope): Record<string, unknown> {
  const { entry_hash: _entryHash, signer: _signer, ...unsigned } = envelope;
  return omitUndefined(unsigned);
}

function omitUndefined<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

function failed(
  seq: number,
  reason: string,
  expected: string | number | undefined,
  actual: string | number | undefined,
  interpretation: string,
  checked: number,
  head?: AuditHead
): AuditVerificationResult {
  return {
    ok: false,
    checked,
    head,
    failure: { seq, reason, expected, actual, interpretation },
  };
}

function failedEnvelope(
  base: { seq: number; stream?: AuditStream; record_id?: string },
  reason: string,
  expected: string | number | undefined,
  actual: string | number | undefined,
  interpretation: string,
  checked: number
): AuditVerificationResult {
  const failure: AuditVerificationFailure = {
    seq: base.seq,
    stream: base.stream,
    record_id: base.record_id,
    reason,
    expected,
    actual,
    interpretation,
  };
  return { ok: false, checked, failure };
}
