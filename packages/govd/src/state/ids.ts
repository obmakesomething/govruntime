/**
 * ID Generation
 * Produces deterministic, sortable, human-readable IDs for all governance entities.
 */

function dateSegment(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

let counters: Map<string, number> = new Map();

function nextSeq(prefix: string): string {
  const key = prefix + "-" + dateSegment();
  const n = (counters.get(key) ?? 0) + 1;
  counters.set(key, n);
  return String(n).padStart(3, "0");
}

// Reset counters (useful in tests)
export function resetCounters(): void {
  counters = new Map();
}

export function newEvidenceId(): string {
  return `EV-${dateSegment()}-${nextSeq("EV")}`;
}

export function newDocketEventId(): string {
  return `DCK-${dateSegment()}-${nextSeq("DCK")}`;
}

export function newConflictId(): string {
  return `CON-${dateSegment()}-${nextSeq("CON")}`;
}

export function newJudgmentId(): string {
  return `JDG-${dateSegment()}-${nextSeq("JDG")}`;
}

export function newSimulationId(): string {
  return `SIM-${dateSegment()}-${nextSeq("SIM")}`;
}

export function newCaseId(label?: string): string {
  const suffix = label
    ? label.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 20)
    : nextSeq("CASE");
  return `CASE-${dateSegment()}-${suffix}`;
}

export function newTicketId(area: string, seq: number, revision: number): string {
  return `T-${area.toUpperCase()}-${String(seq).padStart(3, "0")}-R${revision}`;
}

export function newPrecedentId(seq: number): string {
  return `P-${String(seq).padStart(3, "0")}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}
