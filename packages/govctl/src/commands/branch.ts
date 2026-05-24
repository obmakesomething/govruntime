/**
 * govctl branch — List and create branch ledger entries
 */

import type { Command } from "commander";
import path from "node:path";
import chalk from "chalk";
import {
  loadState,
  createBranchEntry,
  recordDocketEvent,
  buildBranchName,
  buildWorktreePath,
  syncAgentRules,
} from "@govruntime/govd";

export function registerBranch(program: Command): void {
  const branchCmd = program.command("branch").description("Manage branch ledger");

  branchCmd
    .command("list")
    .description("List all branches in the ledger")
    .option("--cwd <path>", "Working directory", process.cwd())
    .option("--status <status>", "Filter by status")
    .action((opts: { cwd: string; status?: string }) => {
      const cwd = path.resolve(opts.cwd);
      const state = loadState(cwd);
      let branches = state.branch_ledger.branches;

      if (opts.status) {
        branches = branches.filter((b) =>
          b.status.toLowerCase().includes(opts.status!.toLowerCase())
        );
      }

      console.log(chalk.bold.cyan("\n⚖️  Branch Ledger\n"));

      if (branches.length === 0) {
        console.log(chalk.gray("  No branches registered."));
        console.log(chalk.gray("  Use: govctl branch create --case ... --ticket ... --purpose ...\n"));
        return;
      }

      for (const b of branches) {
        const isActive = state.active_branch?.branch === b.branch;
        const marker = isActive ? chalk.cyan("▶ ") : "  ";
        const statusStr = b.status === "active" ? chalk.green(b.status) : chalk.gray(b.status);

        console.log(`${marker}${chalk.bold(b.branch)}  [${statusStr}]`);
        console.log(`   ${chalk.gray("Case:")} ${b.case_id}  ${chalk.gray("Ticket:")} ${b.ticket_id}`);
        if (b.worktree) {
          console.log(`   ${chalk.gray("Worktree:")} ${b.worktree}`);
        }
        console.log(`   ${chalk.gray("Scope:")} ${b.intended_scope.join(", ") || "not defined"}`);
        if (b.reason_created.length > 0) {
          console.log(`   ${chalk.gray("Created because:")} ${b.reason_created[0]}`);
        }
        console.log("");
      }
    });

  branchCmd
    .command("create")
    .description("Create a branch with a governance ledger entry")
    .requiredOption("--purpose <purpose>", "Short purpose description (used in branch name)")
    .option("--cwd <path>", "Working directory", process.cwd())
    .option("--case <case-id>", "Case ID (defaults to active case)")
    .option("--ticket <ticket-id>", "Ticket ID (defaults to active ticket)")
    .option("--type <type>", "Branch type", "feature")
    .option("--scope <patterns...>", "Intended file scope patterns (glob)")
    .option("--forbidden <patterns...>", "Forbidden file scope patterns (glob)")
    .option("--reason <reason...>", "Reason(s) for creation")
    .option("--parent <branch>", "Parent branch", "main")
    .option("--with-worktree", "Also register a worktree entry", false)
    .action(
      (opts: {
        purpose: string;
        cwd: string;
        case?: string;
        ticket?: string;
        type: string;
        scope?: string[];
        forbidden?: string[];
        reason?: string[];
        parent: string;
        withWorktree: boolean;
      }) => {
        const cwd = path.resolve(opts.cwd);
        const state = loadState(cwd);

        const caseId = opts.case ?? state.active_case?.case_id;
        const ticketId = opts.ticket ?? state.active_ticket?.ticket_id;

        if (!caseId) {
          console.log(chalk.red("\n  No active case. Specify --case or create a case first.\n"));
          return;
        }
        if (!ticketId) {
          console.log(chalk.red("\n  No active ticket. Specify --ticket or create a ticket first.\n"));
          return;
        }

        const branchName = buildBranchName(caseId, ticketId, opts.purpose);
        const worktreePath = opts.withWorktree
          ? buildWorktreePath(caseId, ticketId)
          : undefined;

        const entry = createBranchEntry(cwd, {
          case_id: caseId,
          ticket_id: ticketId,
          purpose: opts.purpose,
          branch_type: opts.type,
          reason_created: opts.reason ?? [`Created for ticket ${ticketId}: ${opts.purpose}`],
          intended_scope: opts.scope ?? [".governance/**", "docs/**"],
          forbidden_scope: opts.forbidden ?? [],
          parent_branch: opts.parent,
          with_worktree: opts.withWorktree,
        });

        recordDocketEvent(cwd, {
          case_id: caseId,
          ticket_id: ticketId,
          event_type: "branch_created",
          actor: "system",
          reason: `Branch created for ${opts.purpose}: ${entry.branch}`,
          evidence: [],
          affected_branches: [entry.branch],
        });

        // Sync agent rules
        try {
          syncAgentRules(loadState(cwd));
        } catch (err) {
          console.error("Failed to sync agent rules:", err);
        }

        console.log(chalk.bold.cyan("\n⚖️  Branch Registered\n"));
        console.log(`  ${chalk.bold("Branch:")}   ${chalk.cyan(entry.branch)}`);
        if (worktreePath) {
          console.log(`  ${chalk.bold("Worktree:")} ${chalk.gray(worktreePath)}`);
        }
        console.log(`  ${chalk.bold("Case:")}     ${caseId}`);
        console.log(`  ${chalk.bold("Ticket:")}   ${ticketId}`);
        console.log(`  ${chalk.bold("Scope:")}    ${entry.intended_scope.join(", ")}`);
        console.log("");
        console.log(chalk.gray("  Now create the git branch:"));
        console.log(chalk.cyan(`  git checkout -b "${entry.branch}"`));
        if (worktreePath) {
          console.log(chalk.cyan(`  git worktree add "${worktreePath}" "${entry.branch}"`));
        }
        console.log("");
      }
    );
}
