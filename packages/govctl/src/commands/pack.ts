/**
 * govctl pack — Install reusable governance packs into a repo-local .governance directory.
 */
import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import {
  govPath,
  loadState,
  recordDocketEvent,
  syncAgentRules,
  writeYamlFile,
} from "@govruntime/govd";

const PACKS: Record<string, {
  description: string;
  statutes?: Record<string, unknown>;
  invariants?: Record<string, unknown>;
  precedents?: Record<string, unknown>;
  skills?: Record<string, string>;
}> = {
  "long-term-architecture-correctness": {
    description: "Prefer durable architecture correctness over short-term gate passing.",
    statutes: {
      "long_term_architecture_correctness.yaml": {
        id: "ARCH-LONGTERM-001",
        name: "prefer_long_term_architecture_correctness",
        version: "0.1",
        rule: "When a quick patch conflicts with an active architecture decision or invariant, preserve the invariant and record any temporary exception explicitly.",
        applies_when: ["repeated_failure", "release_gate_pressure", "repair_fallback", "high_token_cost", "provenance_loss"],
        enforcement: {
          action: "warn_or_block_by_mode",
          message: "Do not trade away long-term architecture correctness for short-term gate passing without a recorded exception.",
        },
      },
    },
  },
  "sectioned-generation": {
    description: "Protect sectioned generation from full-report repair fallback regressions.",
    invariants: {
      "INV-REPORT-SECTIONED-001.yaml": {
        invariant_id: "INV-REPORT-SECTIONED-001",
        status: "active",
        name: "no-full-report-repair-in-sectioned-flow",
        title: "Sectioned generation must repair only invalid sections",
        scope: ["src/lib/reporting/**", "packages/**"],
        rule: [
          "Sectioned generation may call the model per section.",
          "Assembly must remain deterministic.",
          "Assembly failure may identify invalid sections.",
          "Repair may call the model only for invalid sections.",
          "Full-report schema repair after section generation is prohibited unless explicitly reauthorized.",
        ],
        blocked_patterns: [
          {
            path: "src/lib/reporting/service.ts",
            pattern: "section_id\\s*:\\s*[\"']all[\"']",
            reason: "section_id=all indicates full-report repair inside a sectioned flow.",
          },
          {
            path: "src/lib/reporting/service.ts",
            pattern: "phase\\s*:\\s*[\"']assembly_repair[\"']",
            reason: "assembly_repair must not become a full-report LLM rewrite fallback.",
          },
        ],
        required_checks: [
          "Regression test fails if full-report repair fallback is reintroduced.",
          "Telemetry records concrete section_id for every section repair.",
          "Live run proves no section_id=all repair in sectioned flow.",
        ],
        required_ticket_acceptance_criteria: [
          "Sectioned flow never calls full report schema repair after section generation.",
          "Assembly underfill identifies concrete invalid section ids.",
          "Only invalid sections are retried.",
          "Usage telemetry records section_target_repair with section_id != all.",
          "Regression test blocks section_id=all repair fallback.",
        ],
        override_requires: ["explicit user architecture change", "ticket reissue", "docket event", "human review for release impact"],
        linked_tickets: [],
        created_at: new Date().toISOString(),
      },
    },
    precedents: {
      "P-REPORT-001-sectioned-generation-boundary.yaml": {
        precedent_id: "P-REPORT-001",
        case_id: "BOOTSTRAP",
        status: "active",
        issue: ["May a sectioned report generation flow fall back to full-report LLM repair after assembly failure?"],
        holding: ["No. Sectioned generation requires section-scoped repair only."],
        material_facts: [
          "The user explicitly chose section-by-section generation followed by assembly.",
          "Full-report repair can obscure provider/repair/assembly provenance.",
          "Full-report repair can inflate token/runtime cost and reintroduce duplicate prose.",
        ],
        rule: [
          "Sectioned generation must preserve section boundaries.",
          "Repair after section generation must target invalid sections only.",
        ],
        applies_when: ["sectioned_generation_enabled", "assembly_underfill", "schema_or_preview_failure_after_assembly"],
        overridable_by: ["explicit_current_user_architecture_change", "enterprise_policy_update", "new_case_judgment"],
        created_at: new Date().toISOString(),
      },
    },
  },
  "report-quality-stage-ledger": {
    description: "Require stage provenance for provider, repair, trim, assembly, and final artifact failures.",
    invariants: {
      "INV-REPORT-STAGE-LEDGER-001.yaml": {
        invariant_id: "INV-REPORT-STAGE-LEDGER-001",
        status: "active",
        name: "report-failure-stage-provenance-required",
        title: "Report failures must preserve stage evidence",
        scope: ["src/lib/reporting/**", "scripts/**"],
        rule: [
          "If generation fails, record whether the first observed failure came from provider, repair, trim, assembly, preview, or persistence.",
          "If the stage cannot be proven, record instrumentation_missing or message_localized; do not guess.",
        ],
        blocked_patterns: [],
        required_checks: [
          "Failure artifact contains stage classification.",
          "Unproven message-derived classification is not marked stage_proven=true.",
        ],
        required_ticket_acceptance_criteria: [
          "Fresh failed artifacts include provider/repair/trim/assembly/final evidence when available.",
          "Unproven failures are marked instrumentation_missing or message_localized, not guessed.",
        ],
        override_requires: ["explicit release exception", "docket event"],
        linked_tickets: [],
        created_at: new Date().toISOString(),
      },
    },
  },
  "linear-ops-standing-authorization": {
    description: "Treat evidence-backed Linear bookkeeping as not approval-gated while preserving sensitive human gates.",
    statutes: {
      "linear_ops_standing_authorization.yaml": {
        id: "LINEAR-OPS-001",
        name: "linear_bookkeeping_not_approval_gated",
        version: "0.1",
        rule: "Evidence-backed Linear issue creation, comments, status updates, and child issue splitting are routine bookkeeping and should proceed without asking the user for approval.",
        human_gates_remain: ["payments", "secrets", "account_changes", "deploy_or_traffic", "public_posting", "final_human_quality_acceptance"],
      },
    },
  },
  "chrome-profile-routing": {
    description: "Require visible account/profile verification before profile-dependent browser work.",
    statutes: {
      "chrome_profile_routing.yaml": {
        id: "CHROME-PROFILE-001",
        name: "verify_profile_before_sensitive_browser_action",
        version: "0.1",
        rule: "Before authenticated browser actions, verify the intended Chrome profile or visible account context.",
        applies_to: ["merchant_console", "oauth_console", "chatgpt_pro_review", "gmail", "admin_console", "social_posting"],
        enforcement: { action: "stop_on_wrong_profile", message: "Wrong or unverified browser profile is a real blocker." },
      },
    },
  },
};

export function registerPack(program: Command): void {
  const packCmd = program.command("pack").description("Install reusable governance packs");

  packCmd.command("list").description("List built-in packs").action(() => {
    console.log(chalk.bold.cyan("\n⚖️  Built-in Governance Packs\n"));
    for (const [name, pack] of Object.entries(PACKS)) {
      console.log(`  ${chalk.cyan(name)} — ${pack.description}`);
    }
    console.log("");
  });

  packCmd
    .command("install <pack-name>")
    .description("Install a built-in pack into .governance/")
    .option("--cwd <path>", "Working directory", process.cwd())
    .action((packName: string, opts: { cwd: string }) => {
      const cwd = path.resolve(opts.cwd);
      const pack = PACKS[packName];
      if (!pack) {
        console.log(chalk.red(`\n  Unknown pack: ${packName}\n`));
        process.exitCode = 1;
        return;
      }

      writeRecords(cwd, "statutes", pack.statutes);
      writeRecords(cwd, "invariants", pack.invariants);
      writeRecords(cwd, path.join("precedents", "active"), pack.precedents);
      writeTextRecords(cwd, "skills", pack.skills);

      const state = loadState(cwd);
      if (state.active_case) {
        recordDocketEvent(cwd, {
          case_id: state.active_case.case_id,
          ticket_id: state.active_ticket?.ticket_id,
          event_type: "pack_installed",
          actor: "system",
          reason: `Governance pack installed: ${packName}`,
          evidence: [],
          metadata: { pack: packName },
        });
      }
      syncAgentRules(loadState(cwd));

      console.log(chalk.bold.cyan("\n⚖️  Governance Pack Installed\n"));
      console.log(`  Pack: ${chalk.cyan(packName)}`);
      console.log(`  ${pack.description}`);
      console.log("");
    });
}

function writeRecords(cwd: string, dir: string, records: Record<string, unknown> | undefined): void {
  if (!records) return;
  for (const [filename, record] of Object.entries(records)) {
    writeYamlFile(govPath(cwd, dir, filename), record);
  }
}

function writeTextRecords(cwd: string, dir: string, records: Record<string, string> | undefined): void {
  if (!records) return;
  for (const [filename, content] of Object.entries(records)) {
    const filePath = govPath(cwd, dir, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
}
