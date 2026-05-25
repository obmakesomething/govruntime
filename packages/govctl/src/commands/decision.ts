/**
 * govctl decision — Promote important user/project choices into governance records.
 */
import type { Command } from "commander";
import path from "node:path";
import chalk from "chalk";
import {
  loadState,
  recordDecision,
  recordDocketEvent,
  syncAgentRules,
} from "@govruntime/govd";

export function registerDecision(program: Command): void {
  const decisionCmd = program.command("decision").description("Record and inspect architecture decisions");

  decisionCmd
    .command("record")
    .description("Record an executable architecture decision")
    .requiredOption("--title <title>", "Decision title")
    .option("--statement <statement>", "Decision statement")
    .option("--cwd <path>", "Working directory", process.cwd())
    .option("--scope <patterns...>", "File or workflow scope")
    .option("--evidence <ids...>", "Evidence IDs supporting this decision")
    .option("--rationale <items...>", "Decision rationale")
    .action((opts: { cwd: string; title: string; statement?: string; scope?: string[]; evidence?: string[]; rationale?: string[] }) => {
      const cwd = path.resolve(opts.cwd);
      const state = loadState(cwd);
      const decision = recordDecision(cwd, {
        title: opts.title,
        statement: opts.statement,
        scope: opts.scope ?? [],
        evidence: opts.evidence ?? [],
        rationale: opts.rationale ?? [],
        case_id: state.active_case?.case_id,
        ticket_id: state.active_ticket?.ticket_id,
      });
      if (state.active_case) {
        recordDocketEvent(cwd, {
          case_id: state.active_case.case_id,
          ticket_id: state.active_ticket?.ticket_id,
          event_type: "decision_recorded",
          actor: "system",
          reason: `Decision recorded: ${decision.title}`,
          evidence: decision.evidence,
          decision: { type: "architecture_decision", rationale: decision.statement },
          metadata: { decision_id: decision.decision_id },
        });
      }
      syncAgentRules(loadState(cwd));

      console.log(chalk.bold.cyan("\n⚖️  Decision Recorded\n"));
      console.log(`  ID:    ${chalk.cyan(decision.decision_id)}`);
      console.log(`  Title: ${decision.title}`);
      console.log(`  Scope: ${decision.scope.join(", ") || "not specified"}`);
      console.log("");
    });

  decisionCmd
    .command("list")
    .description("List recorded decisions")
    .option("--cwd <path>", "Working directory", process.cwd())
    .action((opts: { cwd: string }) => {
      const state = loadState(path.resolve(opts.cwd));
      console.log(chalk.bold.cyan("\n⚖️  Decisions\n"));
      if (state.decisions.length === 0) {
        console.log(chalk.gray("  No decisions recorded.\n"));
        return;
      }
      for (const decision of state.decisions) {
        const status = decision.status === "active" ? chalk.green(decision.status) : chalk.gray(decision.status);
        console.log(`  ${chalk.cyan(decision.decision_id)}  [${status}] ${decision.title}`);
        if (decision.scope.length > 0) console.log(`    ${chalk.gray("Scope:")} ${decision.scope.join(", ")}`);
      }
      console.log("");
    });
}
