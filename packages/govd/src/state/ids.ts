/**
 * ID Generation
 * Produces deterministic, sortable, human-readable IDs for all governance entities.
 */
import { reservePersistentSequence } from "./id_store.js";

function dateSegment(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function nextSeq(cwd: string, prefix: string, date: string): string {
  const n = reservePersistentSequence(cwd, prefix, date);
  return String(n).padStart(3, "0");
}

function newSequencedId(cwd: string, prefix: string): string {
  const date = dateSegment();
  return `${prefix}-${date}-${nextSeq(cwd, prefix, date)}`;
}

/**
 * @deprecated Persistent allocators have no process-local counters.
 * Use an isolated cwd when a test needs a fresh sequence.
 */
export function resetCounters(): void {
  // Retained as a compatibility no-op for the alpha API.
}

export function newEvidenceId(cwd: string): string {
  return newSequencedId(cwd, "EV");
}

export function newDocketEventId(cwd: string): string {
  return newSequencedId(cwd, "DCK");
}

export function newConflictId(cwd: string): string {
  return newSequencedId(cwd, "CON");
}

export function newJudgmentId(cwd: string): string {
  return newSequencedId(cwd, "JDG");
}

export function newSimulationId(cwd: string): string {
  return newSequencedId(cwd, "SIM");
}

export function newCaseId(cwd: string, label?: string): string {
  const date = dateSegment();
  const sequence = nextSeq(cwd, "CASE", date);
  const normalizedLabel = label
    ? label.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20)
    : "";
  return normalizedLabel
    ? `CASE-${date}-${sequence}-${normalizedLabel}`
    : `CASE-${date}-${sequence}`;
}

export function newTicketId(area: string, seq: number, revision: number): string {
  return `T-${area.toUpperCase()}-${String(seq).padStart(3, "0")}-R${revision}`;
}

export function newPrecedentId(seq: number): string {
  return `P-${String(seq).padStart(3, "0")}`;
}

export function newDecisionId(cwd: string): string {
  return newSequencedId(cwd, "DEC");
}

export function newInvariantId(cwd: string): string {
  return newSequencedId(cwd, "INV");
}

export function nowISO(): string {
  return new Date().toISOString();
}
