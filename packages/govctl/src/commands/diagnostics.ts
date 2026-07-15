import fs from "node:fs";
import path from "node:path";
import type { GovernanceState } from "@govruntime/govd";
import { govPath, readYamlFile } from "@govruntime/govd";

export type GovernanceFormat = "case-folder" | "legacy-yaml" | "pre-alpha-json" | "mixed" | "empty" | "unknown";

export interface GovernanceSourceDebug {
  cwd: string;
  governance_dir: string;
  governance_dir_exists: boolean;
  format: GovernanceFormat;
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

export function buildStateDebug(cwd: string, state: GovernanceState): GovernanceSourceDebug {
  const governanceDir = govPath(cwd);
  const governanceDirExists = exists(governanceDir);
  const governanceDirUsable = isDirectory(governanceDir);
  const caseFolderNames = listDir(govPath(cwd, "cases")).filter((entry) =>
    isDirectory(path.join(govPath(cwd, "cases"), entry)) && exists(path.join(govPath(cwd, "cases"), entry, "case.yaml"))
  );
  const caseFileNames = listDir(govPath(cwd, "cases")).filter((entry) => isFile(path.join(govPath(cwd, "cases"), entry)));
  const ticketFileNames = listDir(govPath(cwd, "tickets")).filter((entry) => isFile(path.join(govPath(cwd, "tickets"), entry)));
  const legacyYamlCases = caseFileNames.filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"));
  const legacyJsonCases = caseFileNames.filter((entry) => entry.endsWith(".json"));
  const legacyYamlTickets = ticketFileNames.filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"));
  const legacyJsonTickets = ticketFileNames.filter((entry) => entry.endsWith(".json"));

  const scan = listFilesRecursive(governanceDir);
  const present = scan.files.sort();
  const filesRead = new Set<string>();
  const ignored = new Map<string, string>();

  if (governanceDirExists && !governanceDirUsable) {
    ignored.set(".governance", ".governance (governance path is not a readable directory)");
  }
  if (scan.error) {
    ignored.set(".governance-scan", `.governance (${scan.error})`);
  }
  if (scan.truncated) {
    ignored.set(".governance-limit", ".governance (diagnostic scan truncated after 1000 entries or depth 8)");
  }

  addSingleRead(cwd, "current.json", filesRead, ignored);
  addYamlFirstFallback(cwd, "constitution.yaml", "constitution.json", filesRead, ignored);
  addCollectionReads(cwd, "statutes", [".yaml", ".yml"], filesRead, ignored);
  addCollectionReads(cwd, "regulations", [".yaml", ".yml"], filesRead, ignored);
  for (const directory of ["cases", "tickets", "decisions", "invariants", "precedents/active", "precedents/overruled"]) {
    addCollectionReads(cwd, directory, [".yaml", ".yml", ".json"], filesRead, ignored);
  }
  addYamlFirstFallback(cwd, "branches/branch_ledger.yaml", "branches/branch_ledger.json", filesRead, ignored);

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
    governance_dir_exists: governanceDirExists,
    format: detectGovernanceFormat({
      governanceDirExists,
      governanceDirUsable: governanceDirUsable && scan.error == null && !scan.truncated,
      caseFolderCount: caseFolderNames.length,
      hasYamlSource: present.some((relativePath) => isRecognizedDirectSource(relativePath) && /\.ya?ml$/.test(relativePath)),
      hasJsonSource: present.some((relativePath) => isRecognizedDirectSource(relativePath) && relativePath.endsWith(".json")),
    }),
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

function addSingleRead(
  cwd: string,
  relativePath: string,
  filesRead: Set<string>,
  ignored: Map<string, string>
): void {
  const filePath = govPath(cwd, ...relativePath.split("/"));
  if (!isFile(filePath)) return;
  filesRead.add(relativePath);
  if (readYamlFile(filePath) == null) {
    ignored.set(relativePath, `${relativePath} (read but did not yield state)`);
  }
}

function addYamlFirstFallback(
  cwd: string,
  yamlPath: string,
  fallbackPath: string,
  filesRead: Set<string>,
  ignored: Map<string, string>
): void {
  const yamlFilePath = govPath(cwd, ...yamlPath.split("/"));
  const fallbackFilePath = govPath(cwd, ...fallbackPath.split("/"));
  const yamlPresent = isFile(yamlFilePath);
  const fallbackPresent = isFile(fallbackFilePath);
  const yamlValue = yamlPresent ? readYamlFile(yamlFilePath) : null;

  if (yamlPresent) filesRead.add(yamlPath);
  if (yamlValue != null) {
    if (fallbackPresent) {
      ignored.set(fallbackPath, `${fallbackPath} (skipped: ${yamlPath} loaded first)`);
    }
    return;
  }

  if (yamlPresent) {
    ignored.set(yamlPath, `${yamlPath} (read but did not yield state; fallback attempted)`);
  }
  if (!fallbackPresent) return;

  filesRead.add(fallbackPath);
  if (readYamlFile(fallbackFilePath) == null) {
    ignored.set(fallbackPath, `${fallbackPath} (read but did not yield state)`);
  }
}

function addCollectionReads(
  cwd: string,
  relativeDirectory: string,
  extensions: string[],
  filesRead: Set<string>,
  ignored: Map<string, string>
): void {
  const directoryPath = govPath(cwd, ...relativeDirectory.split("/"));
  for (const entry of listDir(directoryPath)) {
    const filePath = path.join(directoryPath, entry);
    if (!isFile(filePath) || !extensions.some((extension) => entry.endsWith(extension))) continue;
    const relativePath = `${relativeDirectory}/${entry}`;
    filesRead.add(relativePath);
    if (!readYamlFile(filePath)) {
      ignored.set(relativePath, `${relativePath} (read but did not yield state)`);
    }
  }
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

function listDir(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

function listFilesRecursive(dirPath: string): { files: string[]; truncated: boolean; error: string | null } {
  const files: string[] = [];
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
      if (entry.isDirectory()) walk(absolutePath, relativePath, depth + 1);
      else if (entry.isFile()) files.push(relativePath);
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

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
