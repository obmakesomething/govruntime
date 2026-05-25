/**
 * govctl invariant — Manage executable architecture invariants.
 */
import type { Command } from "commander";
import path from "node:path";
import chalk from "chalk";
import {
  checkInvariants,
  createInvariant,
  loadState,
  recordDocketEvent,
  syncAgentRules,
} from "@govruntime/govd";

export function registerInvariant(program: Command): void {
  const invariantCmd = program.command("invariant").description("Manage executable architecture invariants");

  invariantCmd
    .command("create")
    .description("Create an invariant from a decision or direct rule")
    .requiredOption("--name <name>", "Stable invariant name")
    .option("--title <title>", "Human-readable title")
    .option("--cwd <path>", "Working directory", process.cwd())
    .option("--decision <decision-id>", "Source decision ID")
    .option("--scope <patterns...>", "Scope patterns")
    .option("--rule <rules...>", "Rules this invariant enforces")
    .option("--blocked-pattern <patterns...>", "Blocked regex patterns; use --blocked-path to bind them to a file/path")
    .option("--blocked-path <path>", "Path or glob for blocked patterns")
    .option("--required-check <checks...>", "Required checks")
    .option("--criteria <criteria...>", "Required ticket acceptance criteria")
    .action((opts: {
      cwd: string;
      name: string;
      title?: string;
      decision?: string;
      scope?: string[];
      rule?: string[];
      blockedPattern?: string[];
      blockedPath?: string;
      requiredCheck?: string[];
      criteria?: string[];
    }) => {
      const cwd = path.resolve(opts.cwd);
      const state = loadState(cwd);
      const blockedPatterns = (opts.blockedPattern ?? []).map((pattern) =>
        opts.blockedPath ? { path: opts.blockedPath, pattern } : pattern,
      );
      const invariant = createInvariant(cwd, {
        name: opts.name,
        title: opts.title,
        decision_id: opts.decision,
        case_id: state.active_case?.case_id,
        ticket_id: state.active_ticket?.ticket_id,
        linked_tickets: state.active_ticket ? [state.active_ticket.ticket_id] : [],
        scope: opts.scope ?? [],
        rule: opts.rule ?? [],
        blocked_patterns: blockedPatterns,
        required_checks: opts.requiredCheck ?? [],
        required_ticket_acceptance_criteria: opts.criteria ?? [],
      });
      if (state.active_case) {
        recordDocketEvent(cwd, {
          case_id: state.active_case.case_id,
          ticket_id: state.active_ticket?.ticket_id,
          event_type: "invariant_created",
          actor: "system",
          reason: `Invariant created: ${invariant.name}`,
          evidence: [],
          decision: { type: "architecture_invariant", rationale: invariant.rule.join(" ") || invariant.title },
          metadata: { invariant_id: invariant.invariant_id, decision_id: invariant.decision_id },
        });
      }
      syncAgentRules(loadState(cwd));

      console.log(chalk.bold.cyan("\n⚖️  Invariant Created\n"));
      console.log(`  ID:    ${chalk.cyan(invariant.invariant_id)}`);
      console.log(`  Name:  ${invariant.name}`);
      console.log(`  Rules: ${invariant.rule.length}`);
      console.log(`  AC:    ${invariant.required_ticket_acceptance_criteria.length}`);
      console.log("");
    });

  invariantCmd
    .command("list")
    .description("List invariants")
    .option("--cwd <path>", "Working directory", process.cwd())
    .action((opts: { cwd: string }) => {
      const state = loadState(path.resolve(opts.cwd));
      console.log(chalk.bold.cyan("\n⚖️  Invariants\n"));
      if (state.invariants.length === 0) {
        console.log(chalk.gray("  No invariants recorded.\n"));
        return;
      }
      for (const invariant of state.invariants) {
        const status = invariant.status === "active" ? chalk.green(invariant.status) : chalk.gray(invariant.status);
        console.log(`  ${chalk.cyan(invariant.invariant_id)}  [${status}] ${invariant.name}`);
        console.log(`    ${invariant.title}`);
      }
      console.log("");
    });

  invariantCmd
    .command("explain <invariant-id>")
    .description("Explain an invariant")
    .option("--cwd <path>", "Working directory", process.cwd())
    .action((invariantId: string, opts: { cwd: string }) => {
      const state = loadState(path.resolve(opts.cwd));
      const invariant = state.invariants.find((item) => item.invariant_id === invariantId || item.name === invariantId);
      if (!invariant) {
        console.log(chalk.red(`\n  Invariant ${invariantId} not found.\n`));
        return;
      }
      console.log(chalk.bold.cyan(`\n⚖️  Invariant: ${invariant.invariant_id}\n`));
      console.log(`  ${chalk.bold("Name:")} ${invariant.name}`);
      console.log(`  ${chalk.bold("Title:")} ${invariant.title}`);
      console.log(`  ${chalk.bold("Status:")} ${invariant.status}`);
      console.log("");
      console.log(chalk.bold("  Rules"));
      for (const rule of invariant.rule) console.log(`    - ${rule}`);
      if (invariant.required_ticket_acceptance_criteria.length > 0) {
        console.log("");
        console.log(chalk.bold("  Required Acceptance Criteria"));
        for (const criterion of invariant.required_ticket_acceptance_criteria) console.log(`    - ${criterion}`);
      }
      if (invariant.override_requires.length > 0) {
        console.log("");
        console.log(chalk.bold("  Override Requires"));
        for (const item of invariant.override_requires) console.log(`    - ${item}`);
      }
      console.log("");
    });

  invariantCmd
    .command("check")
    .description("Run local static invariant checks")
    .option("--cwd <path>", "Working directory", process.cwd())
    .action((opts: { cwd: string }) => {
      const state = loadState(path.resolve(opts.cwd));
      const findings = checkInvariants(state);
      const failed = findings.filter((finding) => finding.status === "fail");
      console.log(chalk.bold.cyan("\n⚖️  Invariant Check\n"));
      for (const finding of findings) {
        const icon = finding.status === "fail" ? chalk.red("✗") : finding.status === "pass" ? chalk.green("✓") : chalk.gray("-");
        console.log(`  ${icon} ${finding.rule}: ${finding.reason}`);
        if (finding.path) console.log(`    ${chalk.gray("Path:")} ${finding.path}`);
      }
      console.log("");
      if (failed.length > 0) process.exitCode = 1;
    });
}
