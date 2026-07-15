import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { GovernanceState, SourceReadTrace } from "@govruntime/govd";
import { govPath } from "@govruntime/govd";

export type GovernanceFormat = "case-folder" | "legacy-yaml" | "pre-alpha-json" | "mixed" | "empty" | "unknown";
export type SnapshotStatus = "consistent" | "changed" | "unknown";

export interface GovernanceInventoryEntry {
  path: string;
  fingerprint: string | null;
}

export interface GovernanceInventory {
  governance_dir_exists: boolean;
  governance_dir_usable: boolean;
  files: GovernanceInventoryEntry[];
  truncated: boolean;
  error: string | null;
}

export interface GovernanceSourceDebug {
  cwd: string;
  governance_dir: string;
  governance_dir_exists: boolean;
  format: GovernanceFormat;
  snapshot: SnapshotStatus;
  files_read: string[];
  files_present: string[];
  ignored_or_unsupported: string[];
  counts: {
    cases: number;
    tickets: number;
    branches: number;
    precedents: number;
    decisions: number;
    invariants: number;
    case_folders: number;
    legacy_yaml_cases: number;
    legacy_json_cases: number;
    legacy_yaml_tickets: number;
    legacy_json_tickets: number;
  };
  active: {
    case_id: string | null;
    ticket_id: string | null;
    branch: string | null;
  };
}

const FALLBACK_PAIRS = [
  ["constitution.yaml", "constitution.json"],
  ["branches/branch_ledger.yaml", "branches/branch_ledger.json"],
] as const;
const FIXED_SOURCE_PATHS = new Set([
  "current.json",
  "constitution.yaml",
  "constitution.json",
  "branches/branch_ledger.yaml",
  "branches/branch_ledger.json",
]);

export function captureGovernanceInventory(cwd: string): GovernanceInventory {
  const governanceDir = govPath(cwd);
  const governanceDirExists = exists(governanceDir);
  const governanceDirUsable = isDirectory(governanceDir);
  const scan = listFilesRecursive(governanceDir);
  return {
    governance_dir_exists: governanceDirExists,
    governance_dir_usable: governanceDirUsable,
    files: scan.files,
    truncated: scan.truncated,
    error: scan.error,
  };
}

export function compareSnapshot(inventory: GovernanceInventory, trace: SourceReadTrace[]): SnapshotStatus {
  if (inventory.error || inventory.truncated || !inventory.governance_dir_usable) return "unknown";
  const inventoryByPath = new Map(inventory.files.map((entry) => [entry.path, entry.fingerprint]));
  const traceByPath = new Map(trace.map((event) => [event.path, event]));
  if (!hasCompleteFixedSourceTrace(traceByPath)) return "changed";

  for (const event of trace) {
    const inventoryFingerprint = inventoryByPath.get(event.path);
    if (event.outcome === "missing") {
      if (inventoryByPath.has(event.path)) return "changed";
      if (!FIXED_SOURCE_PATHS.has(event.path)) return "changed";
    } else if (event.fingerprint == null || inventoryFingerprint !== event.fingerprint) {
      return "changed";
    }
  }

  for (const entry of inventory.files) {
    if (!isLoaderStructuredSource(entry.path) || traceByPath.has(entry.path)) continue;
    if (isSkippedFallback(entry.path, traceByPath)) continue;
    return "changed";
  }
  return "consistent";
}

export function buildStateDebug(
  cwd: string,
  state: GovernanceState,
  inventory: GovernanceInventory,
  trace: SourceReadTrace[]
): GovernanceSourceDebug {
  const governanceDir = govPath(cwd);
  const present = inventory.files.map((entry) => entry.path).sort();
  const presentSet = new Set(present);
  const caseFolderNames = [...new Set(
    present
      .map((relativePath) => /^cases\/([^/]+)\/case\.yaml$/.exec(relativePath)?.[1])
      .filter((value): value is string => Boolean(value))
  )];
  const caseFileNames = directFileNames(present, "cases");
  const ticketFileNames = directFileNames(present, "tickets");
  const legacyYamlCases = caseFileNames.filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"));
  const legacyJsonCases = caseFileNames.filter((entry) => entry.endsWith(".json"));
  const legacyYamlTickets = ticketFileNames.filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"));
  const legacyJsonTickets = ticketFileNames.filter((entry) => entry.endsWith(".json"));
  const filesRead = new Set(trace.filter((event) => event.fingerprint != null).map((event) => event.path));
  const ignored = new Map<string, string>();
  const traceByPath = new Map(trace.map((event) => [event.path, event]));

  if (inventory.governance_dir_exists && !inventory.governance_dir_usable) {
    ignored.set(".governance", ".governance (governance path is not a readable directory)");
  }
  if (inventory.error) {
    ignored.set(".governance-scan", `.governance (${inventory.error})`);
  }
  if (inventory.truncated) {
    ignored.set(".governance-limit", ".governance (diagnostic scan truncated after 1000 entries or depth 8)");
  }
  for (const event of trace) {
    if (event.outcome === "invalid") {
      ignored.set(event.path, `${event.path} (read but did not yield state)`);
    }
  }
  for (const [preferred, fallback] of FALLBACK_PAIRS) {
    if (presentSet.has(fallback) && traceByPath.get(preferred)?.outcome === "loaded" && !filesRead.has(fallback)) {
      ignored.set(fallback, `${fallback} (skipped: ${preferred} loaded first)`);
    }
  }

  for (const relativePath of present) {
    if (ignored.has(relativePath) || filesRead.has(relativePath)) continue;
    if (relativePath === "current.yaml") {
      ignored.set(relativePath, `${relativePath} (unsupported: current loader reads current.json)`);
    } else if (isCaseFolderSource(relativePath, caseFolderNames)) {
      ignored.set(relativePath, `${relativePath} (case-folder source not read by current loader)`);
    } else if (relativePath.startsWith("audit/")) {
      ignored.set(relativePath, `${relativePath} (not read by state loader)`);
    } else {
      ignored.set(relativePath, `${relativePath} (unsupported by state loader)`);
    }
  }

  return {
    cwd,
    governance_dir: governanceDir,
    governance_dir_exists: inventory.governance_dir_exists,
    format: detectGovernanceFormat({
      governanceDirExists: inventory.governance_dir_exists,
      governanceDirUsable: inventory.governance_dir_usable && inventory.error == null && !inventory.truncated,
      caseFolderCount: caseFolderNames.length,
      hasYamlSource: present.some((relativePath) => isRecognizedDirectSource(relativePath) && /\.ya?ml$/.test(relativePath)),
      hasJsonSource: present.some((relativePath) => isRecognizedDirectSource(relativePath) && relativePath.endsWith(".json")),
    }),
    snapshot: compareSnapshot(inventory, trace),
    files_read: [...filesRead].sort(),
    files_present: present,
    ignored_or_unsupported: [...ignored.values()].sort(),
    counts: {
      cases: state.cases.length,
      tickets: state.tickets.length,
      branches: state.branch_ledger.branches.length,
      precedents: state.precedents.length,
      decisions: state.decisions.length,
      invariants: state.invariants.length,
      case_folders: caseFolderNames.length,
      legacy_yaml_cases: legacyYamlCases.length,
      legacy_json_cases: legacyJsonCases.length,
      legacy_yaml_tickets: legacyYamlTickets.length,
      legacy_json_tickets: legacyJsonTickets.length,
    },
    active: {
      case_id: state.active_case?.case_id ?? null,
      ticket_id: state.active_ticket?.ticket_id ?? null,
      branch: state.active_branch?.branch ?? null,
    },
  };
}

function directFileNames(paths: string[], directory: string): string[] {
  return paths
    .filter((relativePath) => relativePath.startsWith(`${directory}/`) && relativePath.split("/").length === 2)
    .map((relativePath) => relativePath.slice(directory.length + 1));
}

function isSkippedFallback(relativePath: string, traceByPath: Map<string, SourceReadTrace>): boolean {
  return FALLBACK_PAIRS.some(([preferred, fallback]) =>
    relativePath === fallback && traceByPath.get(preferred)?.outcome === "loaded"
  );
}

function hasCompleteFixedSourceTrace(traceByPath: Map<string, SourceReadTrace>): boolean {
  if (!traceByPath.has("current.json")) return false;
  return FALLBACK_PAIRS.every(([preferred, fallback]) => {
    const preferredEvent = traceByPath.get(preferred);
    return preferredEvent != null && (preferredEvent.outcome === "loaded" || traceByPath.has(fallback));
  });
}

function isLoaderStructuredSource(relativePath: string): boolean {
  if (["current.json", "constitution.yaml", "constitution.json", "branches/branch_ledger.yaml", "branches/branch_ledger.json"].includes(relativePath)) {
    return true;
  }
  const parts = relativePath.split("/");
  const extension = path.extname(relativePath);
  if (["statutes", "regulations"].includes(parts[0] ?? "")) {
    return parts.length === 2 && [".yaml", ".yml"].includes(extension);
  }
  if (["cases", "tickets", "decisions", "invariants"].includes(parts[0] ?? "")) {
    return parts.length === 2 && [".yaml", ".yml", ".json"].includes(extension);
  }
  return parts[0] === "precedents"
    && ["active", "overruled"].includes(parts[1] ?? "")
    && parts.length === 3
    && [".yaml", ".yml", ".json"].includes(extension);
}

function isCaseFolderSource(relativePath: string, caseFolderNames: string[]): boolean {
  const parts = relativePath.split("/");
  return parts.length > 2 && parts[0] === "cases" && caseFolderNames.includes(parts[1] ?? "");
}

function detectGovernanceFormat(input: {
  governanceDirExists: boolean;
  governanceDirUsable: boolean;
  caseFolderCount: number;
  hasYamlSource: boolean;
  hasJsonSource: boolean;
}): GovernanceFormat {
  if (!input.governanceDirExists || !input.governanceDirUsable) return "unknown";
  const hasCaseFolder = input.caseFolderCount > 0;
  const kindCount = [hasCaseFolder, input.hasYamlSource, input.hasJsonSource].filter(Boolean).length;
  if (kindCount > 1) return "mixed";
  if (hasCaseFolder) return "case-folder";
  if (input.hasJsonSource) return "pre-alpha-json";
  if (input.hasYamlSource) return "legacy-yaml";
  return "empty";
}

function isRecognizedDirectSource(relativePath: string): boolean {
  if (["current.json", "constitution.yaml", "constitution.yml", "constitution.json", "branches/branch_ledger.yaml", "branches/branch_ledger.yml", "branches/branch_ledger.json"].includes(relativePath)) {
    return true;
  }
  const parts = relativePath.split("/");
  if (["cases", "tickets", "decisions", "invariants", "statutes", "regulations"].includes(parts[0] ?? "")) {
    return parts.length === 2;
  }
  return parts[0] === "precedents" && ["active", "overruled"].includes(parts[1] ?? "") && parts.length === 3;
}

function listFilesRecursive(dirPath: string): { files: GovernanceInventoryEntry[]; truncated: boolean; error: string | null } {
  const files: GovernanceInventoryEntry[] = [];
  let truncated = false;
  let error: string | null = null;
  let visitedEntries = 0;

  const walk = (currentPath: string, prefix: string, depth: number): void => {
    if (visitedEntries >= 1000 || depth > 8) {
      truncated = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      error ??= `governance path is not a readable directory${prefix ? `: ${prefix}` : ""}`;
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (visitedEntries >= 1000) {
        truncated = true;
        return;
      }
      visitedEntries += 1;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath, depth + 1);
      } else if (entry.isFile()) {
        try {
          const bytes = fs.readFileSync(absolutePath);
          files.push({ path: relativePath, fingerprint: fingerprintBytes(bytes) });
        } catch {
          files.push({ path: relativePath, fingerprint: null });
          error ??= `governance source is not readable: ${relativePath}`;
        }
      }
    }
  };

  walk(dirPath, "", 0);
  return { files, truncated, error };
}

function exists(filePath: string): boolean {
  if (!filePath) return false;
  return fs.existsSync(filePath);
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function fingerprintBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
