/**
 * govctl timeline — Ordered procedural history for current case
 */

import type { Command } from "commander";
import path from "node:path";
import chalk from "chalk";
import { loadState, readJsonlFile, govPath } from "@govruntime/govd";
import type { DocketEvent } from "@govruntime/govd";

const EVENT_ICONS: Record<string, string> = {
  case_opened: "📂",
  case_reframed: "🔄",
  ticket_issued: "🎫",
  ticket_reissued: "↻",
  ticket_paused: "⏸",
  ticket_resumed: "▶",
  ticket_superseded: "🚫",
  ticket_merged: "⤵",
  ticket_split: "⤴",
  workstream_deepened: "↓",
  workstream_deferred: "🔜",
  branch_created: "🌿",
  branch_merged: "✅",
  branch_abandoned: "🗑",
  worktree_created: "📁",
  worktree_removed: "🗑",
  conflict_detected: "⚡",
  conflict_resolved: "✓",
  judgment_rendered: "⚖️",
  precedent_created: "📜",
  execution_blocked: "🚫",
  execution_allowed: "✓",
  session_started: "🚀",
  human_review_required: "👁",
  appeal_requested: "📣",
  simulation_run: "🎲",
  evidence_admitted: "📋",
};

export function registerTimeline(program: Command): void {
  program
    .command("timeline")
    .description("Show ordered procedural history for the current case")
    .option("--cwd <path>", "Working directory", process.cwd())
    .option("--case <case-id>", "Specific case ID")
    .option("--limit <n>", "Number of events to show", "50")
    .option("--type <type>", "Filter by event type")
    .action(
      (opts: { cwd: string; case?: string; limit: string; type?: string }) => {
        const cwd = path.resolve(opts.cwd);
        const state = loadState(cwd);
        const limit = parseInt(opts.limit, 10);

        const targetCaseId =
          opts.case ?? state.active_case?.case_id;

        if (!targetCaseId) {
          console.log(chalk.yellow("\n  No active case. Run govctl init.\n"));
          return;
        }

        const docketPath = govPath(cwd, "docket", "docket_events.jsonl");
        let events = readJsonlFile<DocketEvent>(docketPath).filter(
          (e) => e.case_id === targetCaseId
        );

        if (opts.type) {
          events = events.filter((e) => e.event_type.includes(opts.type!));
        }

        events = events.slice(-limit);

        console.log(chalk.bold.cyan(`\n⚖️  Timeline — ${targetCaseId}\n`));
        console.log(
          chalk.gray(
            `  Showing ${events.length} event(s)${opts.type ? ` (type: ${opts.type})` : ""}\n`
          )
        );

        if (events.length === 0) {
          console.log(chalk.gray("  No events recorded yet."));
          console.log(chalk.gray("  Events are recorded automatically by hooks.\n"));
          return;
        }

        for (const event of events) {
          const icon = EVENT_ICONS[event.event_type] ?? "·";
          const eventColor = getEventColor(event.event_type);
          const timeStr = event.created_at.slice(0, 16).replace("T", " ");

          console.log(
            `  ${icon}  ${eventColor(event.event_type.replace(/_/g, " "))}  ${chalk.gray(timeStr)}`
          );
          console.log(`     ${chalk.white(event.reason)}`);

          if (event.ticket_id) {
            console.log(`     ${chalk.gray("Ticket:")} ${chalk.cyan(event.ticket_id)}`);
          }
          if (event.evidence && event.evidence.length > 0) {
            console.log(`     ${chalk.gray("Evidence:")} ${event.evidence.join(", ")}`);
          }
          if (event.decision) {
            console.log(
              `     ${chalk.gray("Decision:")} ${event.decision.type} — ${event.decision.rationale}`
            );
          }
          console.log("");
        }
      }
    );
}

function getEventColor(type: string): (s: string) => string {
  if (type.includes("blocked") || type.includes("conflict") || type.includes("superseded")) {
    return chalk.red;
  }
  if (type.includes("paused") || type.includes("deferred") || type.includes("stayed")) {
    return chalk.yellow;
  }
  if (type.includes("opened") || type.includes("issued") || type.includes("created") || type.includes("deepened")) {
    return chalk.cyan;
  }
  if (type.includes("resolved") || type.includes("allowed") || type.includes("merged") || type.includes("judgment")) {
    return chalk.green;
  }
  return chalk.white;
}
