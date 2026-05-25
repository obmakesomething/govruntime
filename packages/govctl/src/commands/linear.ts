/**
 * govctl linear — Produce Linear-ready governance packets without requiring API access.
 */
import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import {
  govPath,
  loadState,
  recordDocketEvent,
} from "@govruntime/govd";

export function registerLinear(program: Command): void {
  const linearCmd = program.command("linear").description("Prepare Linear-ready governance packets");

  linearCmd
    .command("packet")
    .description("Write a Linear issue/comment packet from active governance state")
    .option("--cwd <path>", "Working directory", process.cwd())
    .option("--ticket <ticket-id>", "Ticket ID; defaults to active ticket")
    .option("--issue <linear-id>", "Linear issue ID or key")
    .action((opts: { cwd: string; ticket?: string; issue?: string }) => {
      const cwd = path.resolve(opts.cwd);
      const state = loadState(cwd);
      const ticket = opts.ticket
        ? state.tickets.find((item) => item.ticket_id === opts.ticket)
        : state.active_ticket;
      if (!ticket) {
        console.log(chalk.red("\n  No target ticket. Use --ticket or create an active ticket.\n"));
        process.exitCode = 1;
        return;
      }

      const relevantInvariants = state.invariants.filter((invariant) =>
        invariant.status === "active" &&
        (invariant.linked_tickets.length === 0 || invariant.linked_tickets.includes(ticket.ticket_id)),
      );
      const packet = renderLinearPacket({
        issue: opts.issue,
        ticket,
        invariants: relevantInvariants,
      });
      const filename = `${opts.issue ?? ticket.ticket_id}-governance-packet.md`.replace(/[^A-Za-z0-9_.-]+/g, "-");
      const filePath = govPath(cwd, "linear", filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, packet, "utf8");

      if (state.active_case) {
        recordDocketEvent(cwd, {
          case_id: state.active_case.case_id,
          ticket_id: ticket.ticket_id,
          event_type: "linear_packet_created",
          actor: "system",
          reason: `Linear governance packet created for ${opts.issue ?? ticket.ticket_id}`,
          evidence: [],
          metadata: { issue: opts.issue, file: path.relative(cwd, filePath) },
        });
      }

      console.log(chalk.bold.cyan("\n⚖️  Linear Governance Packet\n"));
      console.log(`  File: ${chalk.cyan(path.relative(cwd, filePath))}`);
      console.log(`  Ticket: ${ticket.ticket_id}`);
      console.log(`  Invariants: ${relevantInvariants.length}`);
      console.log("");
    });
}

function renderLinearPacket(params: {
  issue?: string;
  ticket: { ticket_id: string; title: string; objective: string; acceptance_criteria: string[]; non_goals: string[] };
  invariants: Array<{ invariant_id: string; name: string; title: string; rule: string[]; required_ticket_acceptance_criteria: string[] }>;
}): string {
  const lines: string[] = [];
  lines.push(`# Linear Governance Packet${params.issue ? `: ${params.issue}` : ""}`);
  lines.push("");
  lines.push(`Ticket: \`${params.ticket.ticket_id}\``);
  lines.push(`Title: ${params.ticket.title}`);
  lines.push("");
  lines.push("## Objective");
  lines.push(params.ticket.objective);
  lines.push("");
  lines.push("## Active Invariants");
  if (params.invariants.length === 0) {
    lines.push("- None linked or active.");
  }
  for (const invariant of params.invariants) {
    lines.push(`- \`${invariant.invariant_id}\` ${invariant.name}: ${invariant.title}`);
    for (const rule of invariant.rule) lines.push(`  - ${rule}`);
  }
  lines.push("");
  lines.push("## Required Acceptance Criteria");
  const criteria = [
    ...params.ticket.acceptance_criteria,
    ...params.invariants.flatMap((invariant) => invariant.required_ticket_acceptance_criteria),
  ];
  if (criteria.length === 0) lines.push("- Define acceptance criteria before delegation.");
  for (const criterion of dedupe(criteria)) lines.push(`- ${criterion}`);
  lines.push("");
  lines.push("## Non-goals");
  if (params.ticket.non_goals.length === 0) lines.push("- No unrelated refactor, formatting-only change, or speculative optimization.");
  for (const nonGoal of params.ticket.non_goals) lines.push(`- ${nonGoal}`);
  lines.push("");
  lines.push("## Proof Of Work Required");
  lines.push("- files changed or inspected");
  lines.push("- evidence supporting the root cause");
  lines.push("- validation run or explicit skipped-check reason");
  lines.push("- invariant satisfaction or explicit exception");
  lines.push("- remaining human gates");
  lines.push("");
  return lines.join("\n");
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
