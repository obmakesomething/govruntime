/**
 * govctl why — Docket-derived explanation of why current work exists
 */

import type { Command } from "commander";
import path from "node:path";
import chalk from "chalk";
import { loadState, readJsonlFile, govPath } from "@govruntime/govd";
import type { DocketEvent } from "@govruntime/govd";

export function registerWhy(program: Command): void {
  program
    .command("why")
    .description("Explain why current work exists, based on the procedural docket")
    .option("--cwd <path>", "Working directory", process.cwd())
    .option("--case <case-id>", "Specific case ID to explain")
    .action((opts: { cwd: string; case?: string }) => {
      const cwd = path.resolve(opts.cwd);
      const state = loadState(cwd);

      const targetCase = opts.case
        ? state.cases.find((c) => c.case_id === opts.case) ?? state.active_case
        : state.active_case;

      console.log(chalk.bold.cyan("\n⚖️  Why This Work Exists\n"));

      if (!targetCase) {
        console.log(chalk.yellow("  No active case. Governance context not established."));
        console.log(chalk.gray("  Run: govctl init\n"));
        return;
      }

      console.log(chalk.bold(`  Case: ${chalk.cyan(targetCase.case_id)}`));
      if (targetCase.issue.length > 0) {
        console.log(chalk.bold(`  Issue: ${targetCase.issue[0]}\n`));
      }

      const docketPath = govPath(cwd, "docket", "docket_events.jsonl");
      const allEvents = readJsonlFile<DocketEvent>(docketPath);
      const caseEvents = allEvents.filter((e) => e.case_id === targetCase.case_id);

      if (caseEvents.length === 0) {
        console.log(chalk.gray("  Docket is empty for this case."));
        console.log(chalk.gray("  Events are recorded automatically by hooks when you use the agent.\n"));
        return;
      }

      // Group events by type for narrative
      const opening = caseEvents.filter(
        (e) => e.event_type === "case_opened" || e.event_type === "ticket_issued"
      );
      const refinements = caseEvents.filter(
        (e) =>
          e.event_type === "ticket_reissued" ||
          e.event_type === "case_reframed" ||
          e.event_type === "workstream_deepened"
      );
      const blocks = caseEvents.filter((e) => e.event_type === "execution_blocked");
      const pauses = caseEvents.filter(
        (e) => e.event_type === "ticket_paused" || e.event_type === "workstream_deferred"
      );

      if (opening.length > 0) {
        console.log(chalk.bold("  Origin"));
        for (const e of opening.slice(0, 3)) {
          console.log(`    ${chalk.green("→")} ${e.reason}`);
          console.log(chalk.gray(`      ${formatActor(e.actor)} · ${e.created_at.slice(0, 10)}`));
        }
        console.log("");
      }

      if (refinements.length > 0) {
        console.log(chalk.bold("  How the Work Evolved"));
        for (const e of refinements) {
          const icon = e.event_type === "workstream_deepened" ? "↓" : "↻";
          console.log(`    ${chalk.cyan(icon)} ${e.reason}`);
          console.log(chalk.gray(`      ${formatEventType(e.event_type)} · ${e.created_at.slice(0, 10)}`));
        }
        console.log("");
      }

      if (pauses.length > 0) {
        console.log(chalk.bold("  Paused / Deferred"));
        for (const e of pauses) {
          console.log(`    ${chalk.yellow("⏸")} ${e.reason}`);
        }
        console.log("");
      }

      if (blocks.length > 0) {
        console.log(chalk.bold(`  Blocked Executions (${blocks.length})`));
        for (const e of blocks.slice(-3)) {
          console.log(`    ${chalk.red("✗")} ${e.reason}`);
        }
        console.log("");
      }

      // Current state
      if (state.active_ticket) {
        console.log(chalk.bold("  Current State"));
        console.log(`    Active ticket: ${chalk.cyan(state.active_ticket.ticket_id)}`);
        console.log(`    Title: ${state.active_ticket.title}`);
        console.log(`    Objective: ${state.active_ticket.objective}\n`);
      }
    });
}

function formatActor(actor: string): string {
  const map: Record<string, string> = {
    user: "User",
    agent: "Agent",
    system: "System",
    hook: "Hook",
  };
  return map[actor] ?? actor;
}

function formatEventType(type: string): string {
  return type.replace(/_/g, " ");
}
