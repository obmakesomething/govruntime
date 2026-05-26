#!/usr/bin/env node
/**
 * gov - minimal case-scoped control plane for long-running agent work.
 */
import { Command } from "commander";
import chalk from "chalk";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

type JsonRecord = Record<string, unknown>;

type GovEvent = {
  event_id: string;
  timestamp_utc: string;
  case_id: string;
  type: string;
  message: string;
  evidence_refs: string[];
  actor: string;
};

type GateConfig = {
  machine_gates: Array<JsonRecord>;
  human_gates: Array<JsonRecord>;
};

type GeneratedState = {
  generated: true;
  generated_at: string;
  source: string;
  case_id: string;
  current_ticket: string;
  active_decisions: string[];
  active_invariants: string[];
  open_gates: string[];
  closed_gates: string[];
  latest_run: JsonRecord | null;
  latest_artifact: JsonRecord | null;
  latest_review_result: JsonRecord | null;
  open_blockers: string[];
  do_not_do: string[];
  allowed_scope: string[];
  freshness_status: JsonRecord;
  evidence_index: JsonRecord[];
  next_recommended_action: string;
};

const GOVERNANCE_DIR = ".governance";
const GENERATED_BANNER = "GENERATED FILE - do not edit manually. Regenerate with `gov generate-state --case <case_id>`.";
const DEFAULT_PROFILE_EMAIL = "shareoblee001@gmail.com";

const program = new Command();

program
  .name("gov")
  .description("Minimal GovRuntime case control plane")
  .version("0.1.2-alpha");

program
  .command("init")
  .description("Create a governance case folder and default files")
  .requiredOption("--case <case-id>", "Governance case ID")
  .option("--cwd <path>", "Working directory", process.cwd())
  .action((opts: { case: string; cwd: string }) => {
    const cwd = path.resolve(opts.cwd);
    initCase(cwd, opts.case);
    const state = generateState(cwd, opts.case);
    console.log(`Initialized governance case ${chalk.cyan(state.case_id)} at ${path.relative(cwd, caseDir(cwd, opts.case))}`);
  });

program
  .command("status")
  .description("Print current case posture")
  .requiredOption("--case <case-id>", "Governance case ID")
  .option("--cwd <path>", "Working directory", process.cwd())
  .action((opts: { case: string; cwd: string }) => {
    const cwd = path.resolve(opts.cwd);
    const state = ensureFreshState(cwd, opts.case);
    printStatus(state);
  });

program
  .command("record-event")
  .description("Append one governance event")
  .requiredOption("--case <case-id>", "Governance case ID")
  .requiredOption("--type <type>", "Event type")
  .requiredOption("--message <message>", "Event message")
  .option("--evidence <path-or-hash...>", "Evidence reference")
  .option("--actor <actor>", "Actor", "agent")
  .option("--cwd <path>", "Working directory", process.cwd())
  .action((opts: { case: string; type: string; message: string; evidence?: string[]; actor: string; cwd: string }) => {
    const cwd = path.resolve(opts.cwd);
    ensureCase(cwd, opts.case);
    const event = appendEvent(cwd, opts.case, opts.type, opts.message, opts.evidence ?? [], opts.actor);
    console.log(JSON.stringify({ recorded: true, event_id: event.event_id }, null, 2));
  });

program
  .command("generate-state")
  .description("Regenerate case state, context pack, and Linear packet")
  .requiredOption("--case <case-id>", "Governance case ID")
  .option("--cwd <path>", "Working directory", process.cwd())
  .action((opts: { case: string; cwd: string }) => {
    const cwd = path.resolve(opts.cwd);
    const state = generateState(cwd, opts.case);
    console.log(JSON.stringify({ generated: true, case_id: state.case_id, current_ticket: state.current_ticket }, null, 2));
  });

program
  .command("context-pack")
  .description("Print generated context pack, regenerating stale packs first")
  .requiredOption("--case <case-id>", "Governance case ID")
  .option("--cwd <path>", "Working directory", process.cwd())
  .action((opts: { case: string; cwd: string }) => {
    const cwd = path.resolve(opts.cwd);
    ensureFreshState(cwd, opts.case);
    process.stdout.write(fs.readFileSync(casePath(cwd, opts.case, "context_pack.generated.md"), "utf8"));
  });

program
  .command("check")
  .description("Pre-execution governance hook entrypoint")
  .requiredOption("--case <case-id>", "Governance case ID")
  .requiredOption("--before-tool <tool-or-action>", "Tool or action name")
  .option("--payload <json-file>", "JSON payload file")
  .option("--cwd <path>", "Working directory", process.cwd())
  .action((opts: { case: string; beforeTool: string; payload?: string; cwd: string }) => {
    const cwd = path.resolve(opts.cwd);
    const payload = opts.payload ? readJsonFile(path.resolve(cwd, opts.payload)) as JsonRecord : {};
    const result = checkAction(cwd, opts.case, opts.beforeTool, payload);
    console.log(JSON.stringify(result, null, 2));
    if (!result.allowed) process.exitCode = 2;
  });

program
  .command("record-run")
  .description("Register a run manifest under the case")
  .requiredOption("--case <case-id>", "Governance case ID")
  .requiredOption("--run <run-id>", "Run ID")
  .requiredOption("--manifest <manifest-path>", "Run manifest JSON path")
  .option("--cwd <path>", "Working directory", process.cwd())
  .action((opts: { case: string; run: string; manifest: string; cwd: string }) => {
    const cwd = path.resolve(opts.cwd);
    ensureCase(cwd, opts.case);
    const manifestPath = path.resolve(cwd, opts.manifest);
    const manifest = readJsonFile(manifestPath) as JsonRecord;
    const runDir = casePath(cwd, opts.case, "runs", opts.run);
    mkdirp(runDir);
    writeJson(path.join(runDir, "manifest.json"), { ...manifest, run_id: opts.run, case_id: opts.case, registered_at: now() });
    writeJson(path.join(runDir, "artifacts.json"), manifest["artifacts"] ?? {});
    writeJson(path.join(runDir, "validator_results.json"), manifest["validator_results"] ?? {});
    writeJson(path.join(runDir, "review_packet.json"), manifest["review_packet"] ?? {});
    touch(path.join(runDir, "stage_ledger.jsonl"));
    appendEvent(cwd, opts.case, "run_registered", `Registered run ${opts.run}`, [relativeOrHash(cwd, manifestPath)], "agent");
    console.log(JSON.stringify({ registered: true, run_id: opts.run }, null, 2));
  });

program
  .command("record-stage")
  .description("Append a redacted, hash-backed stage lineage event")
  .requiredOption("--case <case-id>", "Governance case ID")
  .requiredOption("--run <run-id>", "Run ID")
  .requiredOption("--section <section-id>", "Section ID")
  .requiredOption("--stage <stage-name>", "Stage name")
  .option("--payload <json-file>", "Additional stage payload JSON")
  .option("--parent <stage-id>", "Parent stage ID")
  .option("--model-call-id <id>", "Provider/model call ID")
  .option("--input <path>", "Full input file path")
  .option("--output <path>", "Full output file path")
  .option("--artifact <artifact-id>", "Artifact ID")
  .option("--issue <code...>", "Quality issue code")
  .option("--matched-snippet <snippet...>", "Matched snippet")
  .option("--notes <notes>", "Stage notes")
  .option("--cwd <path>", "Working directory", process.cwd())
  .action((opts: {
    case: string;
    run: string;
    section: string;
    stage: string;
    payload?: string;
    parent?: string;
    modelCallId?: string;
    input?: string;
    output?: string;
    artifact?: string;
    issue?: string[];
    matchedSnippet?: string[];
    notes?: string;
    cwd: string;
  }) => {
    const cwd = path.resolve(opts.cwd);
    ensureCase(cwd, opts.case);
    ensureRun(cwd, opts.case, opts.run);
    const payload = opts.payload ? readJsonFile(path.resolve(cwd, opts.payload)) as JsonRecord : {};
    const inputPath = opts.input ? path.resolve(cwd, opts.input) : stringValue(payload["full_input_path"]);
    const outputPath = opts.output ? path.resolve(cwd, opts.output) : stringValue(payload["full_output_path"]);
    const stage = buildStageRecord({
      cwd,
      caseId: opts.case,
      runId: opts.run,
      sectionId: opts.section,
      stageName: opts.stage,
      parentStageId: opts.parent,
      modelCallId: opts.modelCallId,
      inputPath,
      outputPath,
      artifactId: opts.artifact,
      issueCodes: opts.issue,
      matchedSnippets: opts.matchedSnippet,
      notes: opts.notes,
      payload,
    });
    validateStageRecord(stage);
    fs.appendFileSync(casePath(cwd, opts.case, "runs", opts.run, "stage_ledger.jsonl"), JSON.stringify(redactValue(stage)) + "\n", "utf8");
    appendEvent(cwd, opts.case, "stage_recorded", `Recorded ${stage.stage_name} for ${stage.section_id}`, [String(stage.stage_id)], "agent");
    console.log(JSON.stringify({ recorded: true, stage_id: stage.stage_id, input_hash: stage.input_hash, output_hash: stage.output_hash }, null, 2));
  });

program
  .command("finalize-run")
  .description("Validate stage coverage, close eligible machine gates, and mark a run fresh")
  .requiredOption("--case <case-id>", "Governance case ID")
  .requiredOption("--run <run-id>", "Run ID")
  .requiredOption("--artifact-hash <hash>", "Final artifact hash")
  .option("--cwd <path>", "Working directory", process.cwd())
  .action((opts: { case: string; run: string; artifactHash: string; cwd: string }) => {
    const cwd = path.resolve(opts.cwd);
    ensureCase(cwd, opts.case);
    ensureRun(cwd, opts.case, opts.run);
    const result = finalizeRun(cwd, opts.case, opts.run, opts.artifactHash);
    console.log(JSON.stringify(result, null, 2));
    if (!result.allowed) process.exitCode = 2;
  });

program
  .command("close-gate")
  .description("Close a gate from explicit evidence; human gates require signed L5 approval artifacts")
  .requiredOption("--case <case-id>", "Governance case ID")
  .requiredOption("--gate <gate-id>", "Gate ID")
  .requiredOption("--approval <json-file>", "Approval or evidence artifact JSON")
  .option("--cwd <path>", "Working directory", process.cwd())
  .action((opts: { case: string; gate: string; approval: string; cwd: string }) => {
    const cwd = path.resolve(opts.cwd);
    ensureCase(cwd, opts.case);
    const approvalPath = path.resolve(cwd, opts.approval);
    const approval = readJsonFile(approvalPath) as JsonRecord;
    const result = closeGate(cwd, opts.case, opts.gate, approval, approvalPath);
    console.log(JSON.stringify(result, null, 2));
    if (!result.allowed) process.exitCode = 2;
  });

program
  .command("trace")
  .description("Show stage lineage for a section")
  .requiredOption("--case <case-id>", "Governance case ID")
  .requiredOption("--run <run-id>", "Run ID")
  .requiredOption("--section <section-id>", "Section ID")
  .option("--cwd <path>", "Working directory", process.cwd())
  .action((opts: { case: string; run: string; section: string; cwd: string }) => {
    const cwd = path.resolve(opts.cwd);
    const rows = readJsonl(casePath(cwd, opts.case, "runs", opts.run, "stage_ledger.jsonl"))
      .filter((row) => row["section_id"] === opts.section);
    if (rows.length === 0) {
      console.log(`No lineage found for section ${opts.section} in run ${opts.run}.`);
      process.exitCode = 1;
      return;
    }
    for (const row of rows) {
      console.log([
        row["stage_name"] ?? "unknown_stage",
        `stage=${row["stage_id"] ?? "unknown"}`,
        `parent=${row["parent_stage_id"] ?? "none"}`,
        `input=${row["input_hash"] ?? "missing"}`,
        `output=${row["output_hash"] ?? "missing"}`,
        `issues=${Array.isArray(row["quality_issue_codes"]) ? row["quality_issue_codes"].join(",") : ""}`,
      ].join(" | "));
    }
  });

program
  .command("sync-linear")
  .description("Generate the Linear projection packet")
  .requiredOption("--case <case-id>", "Governance case ID")
  .option("--cwd <path>", "Working directory", process.cwd())
  .action((opts: { case: string; cwd: string }) => {
    const cwd = path.resolve(opts.cwd);
    const state = generateState(cwd, opts.case);
    console.log(`Generated Linear packet for ${state.case_id}: ${path.relative(cwd, casePath(cwd, opts.case, "linear_packet.generated.md"))}`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error("gov error:", err);
  process.exit(1);
});

function initCase(cwd: string, caseId: string): void {
  const dir = caseDir(cwd, caseId);
  mkdirp(path.join(dir, "runs"));
  const createdAt = now();
  writeYamlIfMissing(path.join(dir, "case.yaml"), {
    case_id: caseId,
    current_ticket: caseId === "pipeline3" ? "OB-1829" : "UNKNOWN",
    created_at: createdAt,
    owner: "unknown",
    description: caseId === "pipeline3"
      ? "Long-running pipeline3 report-quality governance case."
      : "Long-running agent-work governance case.",
  });
  writeYamlIfMissing(path.join(dir, "decisions.yaml"), {
    decisions: defaultDecisions(),
  });
  writeYamlIfMissing(path.join(dir, "invariants.yaml"), {
    invariants: defaultInvariants(),
  });
  writeYamlIfMissing(path.join(dir, "gates.yaml"), {
    required_stage_coverage: {
      per_final_section: [
        "provider_raw_output",
        "final_markdown",
        "validator_result",
      ],
    },
    machine_gates: [
      {
        id: "validator_passed",
        status: "open",
        source_stage: "validator_result",
        evidence_level_required: "L3",
        artifact_hash_required: true,
        pass_if: {
          any: [
            { field: "validator_passed", equals: true },
            { field: "status", in: ["passed", "pass"] },
            { field: "issue_count", equals: 0 },
          ],
        },
      },
      {
        id: "preview_issues_zero",
        status: "open",
        source_stage: "validator_result",
        evidence_level_required: "L3",
        artifact_hash_required: true,
        pass_if: {
          any: [
            { field: "preview_issues", equals: 0 },
            { field: "preview_issue_count", equals: 0 },
          ],
        },
      },
      {
        id: "gpt_pro_review_passed",
        status: "open",
        source_stage: "external_review_result",
        evidence_level_required: "L4",
        artifact_hash_required: true,
        profile_email_required: DEFAULT_PROFILE_EMAIL,
        profile_evidence_max_age_minutes: 60,
        pass_if: {
          any: [
            { field: "review_passed", equals: true },
            { field: "status", in: ["passed", "pass", "approved"] },
          ],
        },
      },
    ],
    human_gates: [
      { id: "final_acceptance", status: "open", evidence_level_required: "L5" },
      { id: "release_approval", status: "open", evidence_level_required: "L5" },
      { id: "payment_approval", status: "open", evidence_level_required: "L5" },
      { id: "deploy_approval", status: "open", evidence_level_required: "L5" },
      { id: "secret_mutation_approval", status: "open", evidence_level_required: "L5" },
    ],
  });
  touch(path.join(dir, "events.jsonl"));
}

function generateState(cwd: string, caseId: string): GeneratedState {
  ensureCase(cwd, caseId);
  const caseConfig = readYamlFile(casePath(cwd, caseId, "case.yaml"));
  const decisions = asArray(readYamlFile(casePath(cwd, caseId, "decisions.yaml"))["decisions"]);
  const invariants = asArray(readYamlFile(casePath(cwd, caseId, "invariants.yaml"))["invariants"]);
  const gates = readYamlFile(casePath(cwd, caseId, "gates.yaml")) as GateConfig;
  const events = readJsonl(casePath(cwd, caseId, "events.jsonl")) as GovEvent[];
  const latestRun = findLatestRun(cwd, caseId);
  const latestArtifact = latestRun ? latestRun["latest_artifact"] as JsonRecord | undefined ?? latestRun["artifact"] as JsonRecord | undefined ?? null : null;
  const latestReview = findLatestReview(latestRun, events);
  const closedGateIds = new Set(events.filter((event) => event.type === "gate_closed").map((event) => firstToken(event.message)));
  const gateRows = [...asArray(gates.machine_gates), ...asArray(gates.human_gates)];
  const closedGates = gateRows.filter((gate) => gate["status"] === "closed" || closedGateIds.has(String(gate["id"]))).map((gate) => String(gate["id"]));
  const openGates = gateRows.filter((gate) => !closedGates.includes(String(gate["id"]))).map((gate) => String(gate["id"]));
  const state: GeneratedState = {
    generated: true,
    generated_at: now(),
    source: GENERATED_BANNER,
    case_id: String(caseConfig["case_id"] ?? caseId),
    current_ticket: String(caseConfig["current_ticket"] ?? "UNKNOWN"),
    active_decisions: decisions.map(labelRecord),
    active_invariants: invariants.map(labelRecord),
    open_gates: openGates,
    closed_gates: closedGates,
    latest_run: latestRun,
    latest_artifact: latestArtifact,
    latest_review_result: latestReview,
    open_blockers: events.filter((event) => event.type === "blocker_opened").map((event) => event.message),
    do_not_do: invariants.flatMap((item) => asStringArray(item["do_not_do"] ?? item["rule"])),
    allowed_scope: asStringArray(caseConfig["allowed_scope"]).length > 0
      ? asStringArray(caseConfig["allowed_scope"])
      : ["section-scoped repair only", ".governance/cases/<case_id>/**", "run artifacts with matching manifest hash"],
    freshness_status: computeFreshness(latestRun, latestArtifact),
    evidence_index: buildEvidenceIndex(events, latestRun),
    next_recommended_action: "Collect missing evidence, close required human gates explicitly, then rerun gov check before risky actions.",
  };
  writeJson(casePath(cwd, caseId, "state.generated.json"), redactValue(state));
  fs.writeFileSync(casePath(cwd, caseId, "context_pack.generated.md"), renderContextPack(state), "utf8");
  fs.writeFileSync(casePath(cwd, caseId, "linear_packet.generated.md"), renderLinearPacket(state), "utf8");
  return state;
}

function checkAction(cwd: string, caseId: string, beforeTool: string, payload: JsonRecord): JsonRecord {
  const state = ensureFreshState(cwd, caseId);
  const text = JSON.stringify(payload).toLowerCase();
  const action = beforeTool.toLowerCase();
  const sectionId = String(payload["section_id"] ?? payload["sectionId"] ?? "");
  const affectedSections = Number(payload["affected_sections_count"] ?? payload["affectedSectionsCount"] ?? 0);
  const target = String(payload["target"] ?? payload["repair_target"] ?? payload["repairTarget"] ?? "");

  if (action.includes("repair") && (sectionId === "all" || target.toLowerCase().includes("full report") || affectedSections > 1 || mentionsWholeDocument(text))) {
    return block("FORBIDDEN_FULL_REPORT_REPAIR", "Full-report repair is forbidden. Use one section-scoped repair with lineage evidence.", ["section_id other than all", "affected_sections_count <= 1"]);
  }
  if (action.includes("gpt") && action.includes("submit")) {
    const profile = String(payload["profile_email"] ?? payload["account_email"] ?? payload["browser_account"] ?? "");
    const evidenceAt = String(payload["profile_evidence_timestamp_utc"] ?? payload["profileEvidenceTimestampUtc"] ?? "");
    if (profile !== DEFAULT_PROFILE_EMAIL || isStaleTimestamp(evidenceAt, 60 * 60 * 1000)) {
      return block("MISSING_OR_WRONG_GPT_PRO_PROFILE_EVIDENCE", `GPT Pro submission requires fresh visible browser/profile evidence for ${DEFAULT_PROFILE_EMAIL}.`, ["profile_email", "profile_evidence_timestamp_utc"]);
    }
  }
  if (requiresHumanGate(action)) {
    const required = requiredHumanGate(action);
    if (!state.closed_gates.includes(required)) {
      return block("MISSING_HUMAN_GATE", `${action} requires closed human gate ${required}.`, [required]);
    }
  }
  if ((action.includes("review") && action.includes("submit")) || action.includes("packet")) {
    const payloadHash = String(payload["artifact_hash"] ?? payload["artifactHash"] ?? "");
    const latestHash = latestArtifactHash(state);
    const staleLabel = Boolean(payload["stale"] ?? payload["stale_label"] ?? payload["staleLabel"]);
    if (!latestHash || !payloadHash || payloadHash !== latestHash || staleLabel || text.includes("\"freshness\":\"stale\"")) {
      return block("STALE_ARTIFACT_AS_FRESH", "Review packet submission requires a fresh artifact hash matching the latest registered run.", ["artifact_hash matching latest_run"]);
    }
  }
  if (text.includes("deterministic korean prose") || text.includes("deterministic_korean_prose") || text.includes("korean prose replacement")) {
    return block("FORBIDDEN_DETERMINISTIC_KOREAN_PROSE_REPLACEMENT", "Deterministic Korean prose replacement cannot be used as a quality repair shortcut.", ["section-scoped evidence-backed repair"]);
  }
  const claim = String(payload["claim"] ?? payload["message"] ?? "");
  if (/(release-ready|accepted|final acceptance)/i.test(claim)) {
    if (!state.closed_gates.includes("final_acceptance") && !state.closed_gates.includes("release_approval")) {
      return block("UNSUPPORTED_SUCCESS_CLAIM", "Release-ready or accepted claims require validator/review evidence and closed human gate.", ["final_acceptance or release_approval"]);
    }
  }
  if (/(done|fixed|passed)/i.test(claim) && state.evidence_index.length === 0) {
    return {
      allowed: true,
      severity: "warning",
      reason_code: "UNSUPPORTED_SUCCESS_CLAIM",
      reason: "Local draft success claim has no evidence yet. Record validator or review evidence before using it as proof.",
      required_evidence: ["validator_result or review_result"],
    };
  }
  return { allowed: true, reason_code: "ALLOWED", reason: "Governance checks passed for this action." };
}

function renderContextPack(state: GeneratedState): string {
  return [
    `<!-- ${GENERATED_BANNER} -->`,
    "",
    "# GovRuntime Context Pack",
    "",
    `Generated: ${state.generated_at}`,
    "",
    "## Current Case",
    `- ${state.case_id}`,
    "",
    "## Current Ticket",
    `- ${state.current_ticket}`,
    "",
    "## Active Decisions",
    list(state.active_decisions),
    "",
    "## Active Invariants",
    list(state.active_invariants),
    "",
    "## Latest Verified Run",
    `- ${state.latest_run ? state.latest_run["run_id"] ?? "unknown" : "not_enough_evidence"}`,
    "",
    "## Latest GPT Pro / External Review Result",
    `- ${state.latest_review_result ? JSON.stringify(redactValue(state.latest_review_result)) : "not_enough_evidence"}`,
    "",
    "## Open Blockers",
    list(state.open_blockers, "None recorded."),
    "",
    "## Human Gates",
    list(state.open_gates.filter((gate) => gate.includes("approval") || gate.includes("acceptance")), "None open."),
    "",
    "## Allowed Scope",
    list(state.allowed_scope),
    "",
    "## Do Not Do",
    list(state.do_not_do),
    "",
    "## Next Action",
    `- ${state.next_recommended_action}`,
    "",
    "## Explicit Non-Claims",
    "- GPT Pro score/pass is not final human acceptance.",
    "- Preview issue count zero is not release readiness.",
    "- Validator pass is not human acceptance.",
    "- Linear packet generation is not Linear approval.",
    "",
  ].join("\n");
}

function renderLinearPacket(state: GeneratedState): string {
  return [
    `<!-- ${GENERATED_BANNER} -->`,
    "",
    `# Linear Evidence Packet: ${state.current_ticket}`,
    "",
    "## Summary",
    `- Case ${state.case_id} generated a governance projection from append-only events and run manifests.`,
    "",
    "## Evidence",
    list(state.evidence_index.map((item) => `${item["level"] ?? "L0"} ${item["ref"] ?? item["event_id"] ?? "unknown"}`), "No evidence recorded."),
    "",
    "## Run/artifact hashes",
    `- Latest run: ${state.latest_run ? state.latest_run["run_id"] ?? "unknown" : "not_enough_evidence"}`,
    `- Latest artifact hash: ${latestArtifactHash(state) || "not_enough_evidence"}`,
    "",
    "## Review result",
    `- ${state.latest_review_result ? JSON.stringify(redactValue(state.latest_review_result)) : "not_enough_evidence"}`,
    "",
    "## Remaining blockers",
    list(state.open_blockers, "None recorded."),
    "",
    "## Remaining human gates",
    list(state.open_gates.filter((gate) => gate.includes("approval") || gate.includes("acceptance")), "None open."),
    "",
    "## What is NOT being claimed",
    "- Linear is not an approval surface.",
    "- Machine gates do not close human gates.",
    "- Freshness is not assumed without matching hashes.",
    "- Release readiness and acceptance remain human-gated until signed evidence exists.",
    "",
  ].join("\n");
}

function printStatus(state: GeneratedState): void {
  console.log(chalk.bold.cyan("\nGovRuntime Case Status\n"));
  console.log(`Current case: ${chalk.cyan(state.case_id)}`);
  console.log(`Current ticket: ${chalk.cyan(state.current_ticket)}`);
  console.log(`Active decisions: ${state.active_decisions.length}`);
  for (const item of state.active_decisions) console.log(`  - ${item}`);
  console.log(`Active invariants: ${state.active_invariants.length}`);
  for (const item of state.active_invariants) console.log(`  - ${item}`);
  console.log(`Latest live run: ${state.latest_run ? state.latest_run["run_id"] ?? "unknown" : "not_enough_evidence"}`);
  console.log(`Latest GPT Pro / external review: ${state.latest_review_result ? JSON.stringify(redactValue(state.latest_review_result)) : "not_enough_evidence"}`);
  console.log(`Open blockers: ${state.open_blockers.length === 0 ? "none" : state.open_blockers.join("; ")}`);
  console.log(`Open human gates: ${state.open_gates.filter((gate) => gate.includes("approval") || gate.includes("acceptance")).join(", ") || "none"}`);
  console.log(`Allowed scope: ${state.allowed_scope.join("; ")}`);
  console.log(`Do-not-do rules: ${state.do_not_do.join("; ")}`);
  console.log(`Next recommended action: ${state.next_recommended_action}`);
  console.log("");
}

function defaultDecisions(): JsonRecord[] {
  return [
    { id: "linear-proof-ledger", text: "Linear is not where the agent asks permission. Linear is where the agent records proof." },
    { id: "no-full-report-repair", text: "section_id=all full-report repair is forbidden." },
    { id: "no-deterministic-korean-prose", text: "deterministic Korean prose replacement is forbidden." },
    { id: "gpt-pro-profile", text: `ChatGPT Pro review must use the ${DEFAULT_PROFILE_EMAIL} profile.` },
    { id: "gpt-pro-not-acceptance", text: "GPT Pro score/pass does not equal final acceptance." },
    { id: "human-release-gate", text: "Release readiness requires a separate human gate." },
    { id: "freshness-required", text: "Stale artifact must not be submitted as fresh review evidence." },
    { id: "no-probably-done", text: "Probably done is not an acceptable status claim without validator/review evidence." },
  ];
}

function defaultInvariants(): JsonRecord[] {
  return [
    { id: "forbidden-full-report-repair", rule: "Block section_id=all and whole-document repair actions.", do_not_do: ["full-report repair", "section_id=all repair", "whole-document rewrite as repair"] },
    { id: "gpt-pro-profile-evidence", rule: `GPT Pro submission requires fresh ${DEFAULT_PROFILE_EMAIL} profile evidence.`, do_not_do: ["submit GPT Pro review without profile evidence"] },
    { id: "human-gates-are-human", rule: "Machine gate pass never closes final acceptance, release, deploy, payment, or credential mutation gates.", do_not_do: ["claim release-ready without human gate"] },
    { id: "fresh-artifact-hash", rule: "Review packet artifact hash must match the latest registered run.", do_not_do: ["submit stale artifact as fresh"] },
    { id: "stage-lineage-required", rule: "Stage ledger must preserve provider, repair, normalization, trim, assembly, validator, and review lineage.", do_not_do: ["lose birth-stage lineage"] },
  ];
}

function ensureFreshState(cwd: string, caseId: string): GeneratedState {
  if (isGeneratedStale(cwd, caseId)) return generateState(cwd, caseId);
  return readJsonFile(casePath(cwd, caseId, "state.generated.json")) as GeneratedState;
}

function isGeneratedStale(cwd: string, caseId: string): boolean {
  const generated = casePath(cwd, caseId, "state.generated.json");
  if (!fs.existsSync(generated)) return true;
  const generatedMtime = fs.statSync(generated).mtimeMs;
  return sourceFiles(cwd, caseId).some((file) => fs.existsSync(file) && fs.statSync(file).mtimeMs > generatedMtime);
}

function sourceFiles(cwd: string, caseId: string): string[] {
  return [
    casePath(cwd, caseId, "case.yaml"),
    casePath(cwd, caseId, "decisions.yaml"),
    casePath(cwd, caseId, "invariants.yaml"),
    casePath(cwd, caseId, "gates.yaml"),
    casePath(cwd, caseId, "events.jsonl"),
  ];
}

function appendEvent(cwd: string, caseId: string, type: string, message: string, evidenceRefs: string[], actor: string): GovEvent {
  const event: GovEvent = {
    event_id: `evt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    timestamp_utc: now(),
    case_id: caseId,
    type,
    message: String(redactString(message)),
    evidence_refs: evidenceRefs.map((ref) => String(redactString(ref))),
    actor: actor || "agent",
  };
  fs.appendFileSync(casePath(cwd, caseId, "events.jsonl"), JSON.stringify(event) + "\n", "utf8");
  return event;
}

function findLatestRun(cwd: string, caseId: string): JsonRecord | null {
  const runsDir = casePath(cwd, caseId, "runs");
  if (!fs.existsSync(runsDir)) return null;
  const manifests = fs.readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsDir, entry.name, "manifest.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => readJsonFile(file) as JsonRecord)
    .sort((a, b) => String(b["registered_at"] ?? b["created_at"] ?? "").localeCompare(String(a["registered_at"] ?? a["created_at"] ?? "")));
  return manifests[0] ?? null;
}

function findLatestReview(latestRun: JsonRecord | null, events: GovEvent[]): JsonRecord | null {
  if (latestRun?.["latest_review_result"] && typeof latestRun["latest_review_result"] === "object") return latestRun["latest_review_result"] as JsonRecord;
  const review = [...events].reverse().find((event) => event.type.includes("review"));
  return review ? { event_id: review.event_id, message: review.message, evidence_refs: review.evidence_refs } : null;
}

function buildEvidenceIndex(events: GovEvent[], latestRun: JsonRecord | null): JsonRecord[] {
  const eventEvidence: JsonRecord[] = events.flatMap((event) =>
    event.evidence_refs.map((ref) => ({ event_id: event.event_id, type: event.type, ref, level: evidenceLevel(ref) })),
  );
  const runHash = latestRun ? latestArtifactHashFromRun(latestRun) : "";
  if (runHash) eventEvidence.push({ type: "latest_artifact", ref: runHash, level: "L2" });
  return eventEvidence;
}

function buildStageRecord(params: {
  cwd: string;
  caseId: string;
  runId: string;
  sectionId: string;
  stageName: string;
  parentStageId?: string;
  modelCallId?: string;
  inputPath?: string;
  outputPath?: string;
  artifactId?: string;
  issueCodes?: string[];
  matchedSnippets?: string[];
  notes?: string;
  payload: JsonRecord;
}): JsonRecord {
  const inputBody = params.inputPath && fs.existsSync(params.inputPath) ? fs.readFileSync(params.inputPath, "utf8") : stringValue(params.payload["input_excerpt"]);
  const outputBody = params.outputPath && fs.existsSync(params.outputPath) ? fs.readFileSync(params.outputPath, "utf8") : stringValue(params.payload["output_excerpt"]);
  return {
    ...params.payload,
    stage_id: stringValue(params.payload["stage_id"]) || `stage_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    parent_stage_id: params.parentStageId ?? params.payload["parent_stage_id"] ?? null,
    run_id: params.runId,
    case_id: params.caseId,
    section_id: params.sectionId,
    stage_name: params.stageName,
    timestamp_utc: now(),
    model_call_id: params.modelCallId ?? params.payload["model_call_id"] ?? null,
    input_hash: params.inputPath && fs.existsSync(params.inputPath) ? hashFile(params.inputPath) : stringValue(params.payload["input_hash"]) || hashText(inputBody),
    output_hash: params.outputPath && fs.existsSync(params.outputPath) ? hashFile(params.outputPath) : stringValue(params.payload["output_hash"]) || hashText(outputBody),
    input_excerpt: excerpt(inputBody),
    output_excerpt: excerpt(outputBody),
    full_input_path: params.inputPath ? path.relative(params.cwd, params.inputPath) : params.payload["full_input_path"] ?? null,
    full_output_path: params.outputPath ? path.relative(params.cwd, params.outputPath) : params.payload["full_output_path"] ?? null,
    quality_issue_codes: params.issueCodes ?? asStringArray(params.payload["quality_issue_codes"]),
    matched_snippets: params.matchedSnippets ?? asStringArray(params.payload["matched_snippets"]),
    artifact_id: params.artifactId ?? params.payload["artifact_id"] ?? null,
    artifact_hash: params.payload["artifact_hash"] ?? null,
    notes: params.notes ?? params.payload["notes"] ?? "",
  };
}

function validateStageRecord(stage: JsonRecord): void {
  const required = ["stage_id", "run_id", "case_id", "section_id", "stage_name", "timestamp_utc", "input_hash", "output_hash"];
  const missing = required.filter((key) => !stage[key]);
  if (missing.length > 0) {
    throw new Error(`stage_record_invalid: missing ${missing.join(", ")}`);
  }
  const stageName = String(stage["stage_name"]);
  const allowed = new Set([
    "provider_raw_output",
    "repair_input",
    "repair_output",
    "normalization_before",
    "normalization_after",
    "trim_before",
    "trim_after",
    "assembly_before",
    "assembly_after",
    "final_markdown",
    "validator_result",
    "review_packet",
    "external_review_result",
  ]);
  if (!allowed.has(stageName)) {
    throw new Error(`stage_record_invalid: unsupported stage_name ${stageName}`);
  }
}

function finalizeRun(cwd: string, caseId: string, runId: string, artifactHash: string): JsonRecord {
  const manifestPath = casePath(cwd, caseId, "runs", runId, "manifest.json");
  const manifest = readJsonFile(manifestPath) as JsonRecord;
  const manifestHash = latestArtifactHashFromRun(manifest);
  if (manifestHash && manifestHash !== artifactHash) {
    return block("STALE_ARTIFACT_AS_FRESH", "Finalize artifact hash does not match the registered run manifest.", ["artifact_hash matching manifest"]);
  }
  const ledger = readJsonl(casePath(cwd, caseId, "runs", runId, "stage_ledger.jsonl"));
  const coverage = computeStageCoverage(ledger, requiredStageCoverage(cwd, caseId));
  if (!coverage.ok) {
    writeJson(casePath(cwd, caseId, "runs", runId, "finalize_result.json"), {
      allowed: false,
      reason_code: "INSTRUMENTATION_MISSING",
      coverage,
    });
    return {
      allowed: false,
      reason_code: "INSTRUMENTATION_MISSING",
      reason: "Run cannot be marked fresh until required stage coverage exists for each final section.",
      required_evidence: coverage.missing,
      coverage,
    };
  }
  const closed = closeEligibleMachineGates(cwd, caseId, ledger, artifactHash);
  const finalized = {
    ...manifest,
    run_id: runId,
    case_id: caseId,
    artifact_hash: artifactHash,
    latest_artifact: { hash: artifactHash, stale: false, finalized_at: now() },
    finalized_at: now(),
    stage_coverage: coverage,
    stale: false,
  };
  writeJson(manifestPath, finalized);
  writeJson(casePath(cwd, caseId, "runs", runId, "finalize_result.json"), {
    allowed: true,
    artifact_hash: artifactHash,
    coverage,
    closed_machine_gates: closed,
  });
  appendEvent(cwd, caseId, "run_finalized", `Finalized run ${runId}`, [`artifact#sha256:${artifactHash}`], "agent");
  generateState(cwd, caseId);
  return {
    allowed: true,
    reason_code: "RUN_FINALIZED",
    artifact_hash: artifactHash,
    coverage,
    closed_machine_gates: closed,
  };
}

function closeGate(cwd: string, caseId: string, gateId: string, approval: JsonRecord, approvalPath: string): JsonRecord {
  const gates = readYamlFile(casePath(cwd, caseId, "gates.yaml")) as GateConfig;
  const humanGateIds = new Set(asArray(gates.human_gates).map((gate) => String(gate["id"])));
  const machineGateIds = new Set(asArray(gates.machine_gates).map((gate) => String(gate["id"])));
  if (!humanGateIds.has(gateId) && !machineGateIds.has(gateId)) {
    return block("UNKNOWN_GATE", `Gate ${gateId} is not declared in gates.yaml.`, ["declared gate"]);
  }
  if (humanGateIds.has(gateId)) {
    const validation = validateHumanApproval(caseId, gateId, approval);
    if (!validation.allowed) return validation;
  } else if (String(approval["evidence_level"]) === "L0") {
    return block("INSUFFICIENT_EVIDENCE_LEVEL", "Machine gates cannot be closed with L0 assertion-only evidence.", ["L1 or higher evidence"]);
  }
  const evidenceRef = `${path.relative(cwd, approvalPath)}#sha256:${hashFile(approvalPath)}`;
  appendEvent(cwd, caseId, "gate_closed", gateId, [evidenceRef], "agent");
  generateState(cwd, caseId);
  return { allowed: true, reason_code: "GATE_CLOSED", gate_id: gateId, evidence_ref: evidenceRef };
}

function validateHumanApproval(caseId: string, gateId: string, approval: JsonRecord): JsonRecord {
  const missing = ["case_id", "gate_id", "approved_by", "signed_at", "statement", "evidence_level", "signature"].filter((key) => !approval[key]);
  if (missing.length > 0) {
    return block("MISSING_HUMAN_GATE", `Human gate ${gateId} requires a signed approval artifact.`, missing);
  }
  if (approval["case_id"] !== caseId || approval["gate_id"] !== gateId) {
    return block("MISSING_HUMAN_GATE", "Approval artifact case_id/gate_id does not match the requested gate.", ["matching case_id", "matching gate_id"]);
  }
  if (approval["evidence_level"] !== "L5") {
    return block("MISSING_HUMAN_GATE", "Human gate closure requires L5: human_gate_signed evidence.", ["evidence_level=L5"]);
  }
  if (isStaleTimestamp(String(approval["signed_at"]), 7 * 24 * 60 * 60 * 1000)) {
    return block("MISSING_HUMAN_GATE", "Human approval artifact is missing or older than the allowed signing window.", ["fresh signed_at"]);
  }
  return { allowed: true };
}

function computeStageCoverage(ledger: JsonRecord[], required: string[]): JsonRecord {
  const bySection = new Map<string, Set<string>>();
  for (const row of ledger) {
    const section = String(row["section_id"] ?? "");
    const stage = String(row["stage_name"] ?? "");
    if (!section || !stage) continue;
    const stages = bySection.get(section) ?? new Set<string>();
    stages.add(stage);
    bySection.set(section, stages);
  }
  const missing: string[] = [];
  for (const [section, stages] of bySection.entries()) {
    if (!stages.has("final_markdown") && !stages.has("validator_result") && !stages.has("review_packet")) continue;
    for (const stage of required) {
      if (!stages.has(stage)) missing.push(`${section}:${stage}`);
    }
  }
  if (bySection.size === 0) missing.push("run:any_stage");
  return {
    ok: missing.length === 0,
    required_per_final_section: required,
    sections: [...bySection.entries()].map(([section, stages]) => ({ section_id: section, stages: [...stages].sort() })),
    missing,
  };
}

function requiredStageCoverage(cwd: string, caseId: string): string[] {
  const gates = readYamlFile(casePath(cwd, caseId, "gates.yaml"));
  const configured = gates["required_stage_coverage"];
  if (isRecord(configured)) {
    const perFinalSection = asStringArray(configured["per_final_section"]);
    if (perFinalSection.length > 0) return perFinalSection;
  }
  const legacy = asStringArray(gates["required_stage_coverage"]);
  if (legacy.length > 0) return legacy;
  return ["provider_raw_output", "final_markdown", "validator_result"];
}

function closeEligibleMachineGates(cwd: string, caseId: string, ledger: JsonRecord[], artifactHash: string): string[] {
  const closed: string[] = [];
  for (const gate of machineGateRules(cwd, caseId)) {
    const gateId = String(gate["id"] ?? "");
    const sourceStage = String(gate["source_stage"] ?? defaultMachineGateSourceStage(gateId));
    if (!gateId || !sourceStage) continue;
    const rows = ledger.filter((row) => row["stage_name"] === sourceStage && machineGateRowEligible(gate, row, artifactHash));
    if (rows.some((row) => machineGatePasses(gate, row))) {
      closed.push(closeMachineGate(cwd, caseId, gateId, sourceStage, artifactHash));
    }
  }
  return closed.filter(Boolean);
}

function machineGateRules(cwd: string, caseId: string): JsonRecord[] {
  const gates = readYamlFile(casePath(cwd, caseId, "gates.yaml"));
  return asArray(gates["machine_gates"]);
}

function machineGateRowEligible(gate: JsonRecord, row: JsonRecord, artifactHash: string): boolean {
  const hashRequired = gate["artifact_hash_required"] !== false;
  if (hashRequired && !stageArtifactMatches(row, artifactHash)) return false;
  const requiredLevel = String(gate["evidence_level_required"] ?? "L0");
  const rowLevel = String(row["evidence_level"] ?? inferEvidenceLevelForStage(String(row["stage_name"] ?? "")));
  if (evidenceRank(rowLevel) < evidenceRank(requiredLevel)) return false;
  const requiredProfile = stringValue(gate["profile_email_required"]);
  if (requiredProfile) {
    const actualProfile = String(row["profile_email"] ?? "");
    if (actualProfile !== requiredProfile) return false;
    const maxAgeMinutes = Number(gate["profile_evidence_max_age_minutes"] ?? 60);
    if (isStaleTimestamp(String(row["profile_evidence_timestamp_utc"] ?? ""), maxAgeMinutes * 60 * 1000)) return false;
  }
  return true;
}

function machineGatePasses(gate: JsonRecord, row: JsonRecord): boolean {
  const passIf = gate["pass_if"];
  if (!isRecord(passIf)) return legacyMachineGatePasses(String(gate["id"] ?? ""), row);
  const any = Array.isArray(passIf["any"]) ? passIf["any"].filter(isRecord) : [];
  const all = Array.isArray(passIf["all"]) ? passIf["all"].filter(isRecord) : [];
  if (any.length > 0 && any.some((condition) => conditionMatches(condition, row))) return true;
  if (all.length > 0 && all.every((condition) => conditionMatches(condition, row))) return true;
  return false;
}

function conditionMatches(condition: JsonRecord, row: JsonRecord): boolean {
  const field = stringValue(condition["field"]);
  if (!field) return false;
  const value = row[field];
  if ("equals" in condition) return normalizeComparable(value) === normalizeComparable(condition["equals"]);
  if (Array.isArray(condition["in"])) {
    const normalized = normalizeComparable(value);
    return condition["in"].map(normalizeComparable).includes(normalized);
  }
  if ("max" in condition) return Number(value) <= Number(condition["max"]);
  if ("min" in condition) return Number(value) >= Number(condition["min"]);
  if (condition["empty_array"] === true) return Array.isArray(value) && value.length === 0;
  return false;
}

function normalizeComparable(value: unknown): string | number | boolean {
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).toLowerCase();
}

function legacyMachineGatePasses(gateId: string, row: JsonRecord): boolean {
  if (gateId === "validator_passed") {
    return Boolean(row["validator_passed"]) ||
      ["passed", "pass"].includes(String(row["status"] ?? "").toLowerCase()) ||
      (asStringArray(row["quality_issue_codes"]).length === 0 && Number(row["issue_count"] ?? 0) === 0);
  }
  if (gateId === "preview_issues_zero") {
    return Number(row["preview_issues"] ?? row["preview_issue_count"] ?? row["issue_count"] ?? -1) === 0;
  }
  if (gateId === "gpt_pro_review_passed") {
    return Boolean(row["review_passed"]) || ["passed", "pass", "approved"].includes(String(row["status"] ?? "").toLowerCase());
  }
  return false;
}

function defaultMachineGateSourceStage(gateId: string): string {
  if (gateId === "validator_passed" || gateId === "preview_issues_zero") return "validator_result";
  if (gateId === "gpt_pro_review_passed") return "external_review_result";
  return "";
}

function inferEvidenceLevelForStage(stageName: string): string {
  if (stageName === "external_review_result") return "L4";
  if (stageName === "validator_result") return "L3";
  if (stageName === "final_markdown") return "L2";
  return "L1";
}

function closeMachineGate(cwd: string, caseId: string, gateId: string, source: string, artifactHash: string): string {
  const state = ensureFreshState(cwd, caseId);
  if (state.closed_gates.includes(gateId)) return "";
  appendEvent(cwd, caseId, "gate_closed", gateId, [`${source}#sha256:${artifactHash}`], "agent");
  return gateId;
}

function stageArtifactMatches(row: JsonRecord, artifactHash: string): boolean {
  const rowHash = String(row["artifact_hash"] ?? row["output_hash"] ?? "");
  return rowHash === artifactHash || rowHash === `sha256:${artifactHash}`;
}

function evidenceRank(level: string): number {
  const match = /^L([0-5])$/.exec(level);
  return match ? Number(match[1]) : 0;
}

function computeFreshness(latestRun: JsonRecord | null, latestArtifact: JsonRecord | null): JsonRecord {
  if (!latestRun) return { status: "not_enough_evidence", reason: "No run manifest registered." };
  const hash = latestArtifactHashFromRun(latestRun) || latestArtifactHashFromArtifact(latestArtifact);
  if (!hash) return { status: "instrumentation_missing", reason: "Latest run has no artifact hash." };
  if (latestArtifact?.["stale"] === true || latestRun["stale"] === true) return { status: "stale_evidence", reason: "Latest artifact is marked stale.", artifact_hash: hash };
  return { status: "fresh", artifact_hash: hash };
}

function evidenceLevel(ref: string): string {
  if (/human|signed/i.test(ref)) return "L5";
  if (/external|review/i.test(ref) && /sha256|hash/i.test(ref)) return "L4";
  if (/validator|repro/i.test(ref)) return "L3";
  if (/sha256|hash|artifact/i.test(ref)) return "L2";
  if (/log|run/i.test(ref)) return "L1";
  return "L0";
}

function latestArtifactHash(state: GeneratedState): string {
  return latestArtifactHashFromArtifact(state.latest_artifact) || latestArtifactHashFromRun(state.latest_run);
}

function latestArtifactHashFromRun(run: JsonRecord | null): string {
  if (!run) return "";
  return String(run["artifact_hash"] ?? run["latest_artifact_hash"] ?? (isRecord(run["latest_artifact"]) ? run["latest_artifact"]["hash"] : "") ?? "");
}

function latestArtifactHashFromArtifact(artifact: JsonRecord | null): string {
  if (!artifact) return "";
  return String(artifact["hash"] ?? artifact["sha256"] ?? artifact["artifact_hash"] ?? "");
}

function requiresHumanGate(action: string): boolean {
  return ["release", "deploy", "payment", "secret", "credential", "production write", "final acceptance"].some((needle) => action.includes(needle));
}

function requiredHumanGate(action: string): string {
  if (action.includes("release")) return "release_approval";
  if (action.includes("deploy")) return "deploy_approval";
  if (action.includes("payment")) return "payment_approval";
  if (action.includes("secret") || action.includes("credential")) return "secret_mutation_approval";
  if (action.includes("production write")) return "deploy_approval";
  return "final_acceptance";
}

function mentionsWholeDocument(text: string): boolean {
  return ["whole-document", "whole document", "full-report", "full report", "entire report", "replace all"].some((needle) => text.includes(needle));
}

function block(reasonCode: string, reason: string, requiredEvidence: string[]): JsonRecord {
  return { allowed: false, reason_code: reasonCode, reason, required_evidence: requiredEvidence };
}

function isStaleTimestamp(value: string, maxAgeMs: number): boolean {
  if (!value) return true;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return true;
  return Date.now() - parsed > maxAgeMs;
}

function readYamlFile(filePath: string): JsonRecord {
  const data = yaml.load(fs.readFileSync(filePath, "utf8"));
  return isRecord(data) ? data : {};
}

function writeYamlIfMissing(filePath: string, data: unknown): void {
  if (fs.existsSync(filePath)) return;
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, yaml.dump(data, { indent: 2, lineWidth: 120, noRefs: true }), "utf8");
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath: string, data: unknown): void {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(redactValue(data), null, 2) + "\n", "utf8");
}

function readJsonl(filePath: string): JsonRecord[] {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as JsonRecord);
}

function caseDir(cwd: string, caseId: string): string {
  return path.join(cwd, GOVERNANCE_DIR, "cases", caseId);
}

function casePath(cwd: string, caseId: string, ...parts: string[]): string {
  return path.join(caseDir(cwd, caseId), ...parts);
}

function ensureCase(cwd: string, caseId: string): void {
  if (!fs.existsSync(casePath(cwd, caseId, "case.yaml"))) initCase(cwd, caseId);
}

function mkdirp(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function touch(filePath: string): void {
  mkdirp(path.dirname(filePath));
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "", "utf8");
}

function now(): string {
  return new Date().toISOString();
}

function labelRecord(item: unknown): string {
  if (!isRecord(item)) return String(item);
  return String(item["text"] ?? item["rule"] ?? item["title"] ?? item["id"] ?? JSON.stringify(item));
}

function firstToken(value: string): string {
  return value.trim().split(/\s+/)[0] ?? "";
}

function list(items: string[], empty = "None."): string {
  return items.length > 0 ? items.map((item) => `- ${redactString(item)}`).join("\n") : `- ${empty}`;
}

function asArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function relativeOrHash(cwd: string, filePath: string): string {
  return fs.existsSync(filePath) ? `${path.relative(cwd, filePath)}#sha256:${hashFile(filePath)}` : filePath;
}

function hashFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function excerpt(value: string): string {
  return String(redactString(value)).replace(/\s+/g, " ").trim().slice(0, 500);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function ensureRun(cwd: string, caseId: string, runId: string): void {
  const runDir = casePath(cwd, caseId, "runs", runId);
  if (!fs.existsSync(path.join(runDir, "manifest.json"))) {
    throw new Error(`run_not_registered: ${runId}`);
  }
  touch(path.join(runDir, "stage_ledger.jsonl"));
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shouldRedactKey(key) ? "[REDACTED]" : redactValue(item)]));
  }
  return value;
}

function redactString(value: string): string {
  return value
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/(api[_-]?key|token|session[_-]?id|cookie|password|secret)(["':=\s]+)[^"',\s)]+/gi, "$1$2[REDACTED]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED_PAYMENT]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => email === DEFAULT_PROFILE_EMAIL ? email : partialEmail(email));
}

function shouldRedactKey(key: string): boolean {
  return /password|secret|token|cookie|session|credential|api[_-]?key/i.test(key);
}

function partialEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "[REDACTED_EMAIL]";
  return `${name.slice(0, 2)}***@${domain}`;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
