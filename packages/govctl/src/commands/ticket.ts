/**
 * govctl ticket — List, show, and reissue tickets
 */
import path from "node:path";
import chalk from "chalk";
import { loadState, reissueTicket, issueTicket, recordTicketReissued, recordTicketIssued, syncAgentRules, } from "@govruntime/govd";
export function registerTicket(program) {
    const ticketCmd = program.command("ticket").description("Manage tickets");
    // govctl ticket list
    ticketCmd
        .command("list")
        .description("List all tickets")
        .option("--cwd <path>", "Working directory", process.cwd())
        .option("--status <status>", "Filter by status")
        .action((opts) => {
        const cwd = path.resolve(opts.cwd);
        const state = loadState(cwd);
        let tickets = state.tickets;
        if (opts.status) {
            tickets = tickets.filter((t) => t.status.toLowerCase().includes(opts.status.toLowerCase()) ||
                t.workstream_status.toLowerCase().includes(opts.status.toLowerCase()));
        }
        console.log(chalk.bold.cyan("\n⚖️  Tickets\n"));
        if (tickets.length === 0) {
            console.log(chalk.gray("  No tickets yet.\n"));
            return;
        }
        for (const t of tickets) {
            const isActive = state.active_ticket?.ticket_id === t.ticket_id;
            const marker = isActive ? chalk.cyan("▶ ") : "  ";
            const statusStr = ticketStatusColor(t.status);
            const wsStr = workstreamColor(t.workstream_status);
            console.log(`${marker}${chalk.bold(t.ticket_id)}  ${statusStr}  ${wsStr}`);
            console.log(`   ${chalk.gray("Title:")} ${t.title}`);
            console.log(`   ${chalk.gray("Case:")} ${t.case_id}  ${chalk.gray("Rev:")} ${t.revision}  ${chalk.gray("Criteria:")} ${t.acceptance_criteria.length}`);
            console.log("");
        }
    });
    // govctl ticket show <ticket-id>
    ticketCmd
        .command("show <ticket-id>")
        .description("Show ticket details")
        .option("--cwd <path>", "Working directory", process.cwd())
        .action((ticketId, opts) => {
        const cwd = path.resolve(opts.cwd);
        const state = loadState(cwd);
        const ticket = state.tickets.find((t) => t.ticket_id === ticketId);
        if (!ticket) {
            console.log(chalk.red(`\n  Ticket ${ticketId} not found.\n`));
            return;
        }
        console.log(chalk.bold.cyan(`\n⚖️  Ticket: ${ticket.ticket_id}\n`));
        console.log(`  ${chalk.bold("Title:")}     ${ticket.title}`);
        console.log(`  ${chalk.bold("Revision:")}  ${ticket.revision}`);
        console.log(`  ${chalk.bold("Status:")}    ${ticketStatusColor(ticket.status)}`);
        console.log(`  ${chalk.bold("Workstream:")}${workstreamColor(ticket.workstream_status)}`);
        console.log(`  ${chalk.bold("Case:")}      ${ticket.case_id}`);
        console.log(`  ${chalk.bold("Objective:")}`);
        console.log(`    ${ticket.objective}`);
        console.log("");
        console.log(`  ${chalk.bold("Acceptance Criteria:")}`);
        if (ticket.acceptance_criteria.length === 0) {
            console.log(chalk.yellow("    ⚠ None defined"));
        }
        for (const c of ticket.acceptance_criteria) {
            console.log(`    - ${c}`);
        }
        console.log("");
        if (ticket.non_goals.length > 0) {
            console.log(`  ${chalk.bold("Non-Goals:")}`);
            for (const ng of ticket.non_goals) {
                console.log(`    - ${ng}`);
            }
            console.log("");
        }
        if (ticket.reason_for_reissue) {
            console.log(`  ${chalk.bold("Reissue Reason:")}`);
            console.log(`    ${ticket.reason_for_reissue}`);
            console.log("");
        }
        console.log(`  ${chalk.bold("Risk Profile:")}`);
        const r = ticket.risk_profile;
        console.log(`    Ambiguity: ${pct(r.ambiguity)}  Scope Drift: ${pct(r.scope_drift)}  Blast: ${r.blast_radius}`);
        console.log("");
    });
    // govctl ticket reissue <ticket-id>
    ticketCmd
        .command("reissue <ticket-id>")
        .description("Reissue a ticket (immutable revision)")
        .requiredOption("--reason <reason>", "Reason for reissue")
        .option("--cwd <path>", "Working directory", process.cwd())
        .option("--title <title>", "Updated title")
        .action((ticketId, opts) => {
        const cwd = path.resolve(opts.cwd);
        const state = loadState(cwd);
        const oldTicket = state.tickets.find((t) => t.ticket_id === ticketId);
        if (!oldTicket) {
            console.log(chalk.red(`\n  Ticket ${ticketId} not found.\n`));
            return;
        }
        const reissueOpts: any = {
            reason: opts.reason,
        };
        if (opts.title)
            reissueOpts.patch = { title: opts.title };
        const newTicket = reissueTicket(cwd, oldTicket, reissueOpts);
        recordTicketReissued(cwd, oldTicket.case_id, oldTicket.ticket_id, newTicket.ticket_id, opts.reason);
        // Sync agent rules
        try {
            syncAgentRules(loadState(cwd));
        }
        catch (err) {
            console.error("Failed to sync agent rules:", err);
        }
        console.log(chalk.bold.cyan("\n⚖️  Ticket Reissued\n"));
        console.log(`  ${chalk.gray("Old:")} ${ticketId}  → ${chalk.cyan("SUPERSEDED")}`);
        console.log(`  ${chalk.green("New:")} ${chalk.cyan(newTicket.ticket_id)}  (Revision ${newTicket.revision})`);
        console.log(`  ${chalk.gray("Reason:")} ${opts.reason}`);
        console.log("");
    });
    // govctl ticket create
    ticketCmd
        .command("create")
        .description("Issue a new ticket")
        .requiredOption("--title <title>", "Ticket title")
        .requiredOption("--objective <objective>", "Ticket objective")
        .requiredOption("--area <area>", "Area code (e.g. ARCH, PROC, HOOK)")
        .requiredOption("--seq <n>", "Sequence number")
        .option("--cwd <path>", "Working directory", process.cwd())
        .option("--criteria <criteria...>", "Acceptance criteria (can repeat)")
        .action((opts) => {
        const cwd = path.resolve(opts.cwd);
        const state = loadState(cwd);
        if (!state.active_case) {
            console.log(chalk.red("\n  No active case. Create a case first.\n"));
            return;
        }
        const ticket = issueTicket(cwd, {
            area: opts.area,
            seq: parseInt(opts.seq, 10),
            case_id: state.active_case.case_id,
            title: opts.title,
            objective: opts.objective,
            acceptance_criteria: opts.criteria ?? [],
        });
        recordTicketIssued(cwd, state.active_case.case_id, ticket.ticket_id, `Ticket issued: ${opts.title}`);
        // Sync agent rules
        try {
            syncAgentRules(loadState(cwd));
        }
        catch (err) {
            console.error("Failed to sync agent rules:", err);
        }
        console.log(chalk.bold.cyan("\n⚖️  Ticket Created\n"));
        console.log(`  ID:        ${chalk.cyan(ticket.ticket_id)}`);
        console.log(`  Title:     ${ticket.title}`);
        console.log(`  Case:      ${ticket.case_id}`);
        console.log(`  Criteria:  ${ticket.acceptance_criteria.length} defined`);
        console.log("");
    });
}
function ticketStatusColor(status) {
    const s = status.toLowerCase();
    if (s === "in_progress" || s === "assigned")
        return chalk.green(status);
    if (s === "paused" || s === "blocked_by_conflict")
        return chalk.yellow(status);
    if (s === "superseded" || s === "cancelled")
        return chalk.red(status);
    if (s === "done")
        return chalk.gray(status);
    return chalk.white(status);
}
function workstreamColor(ws) {
    if (ws === "ACTIVE")
        return chalk.green(ws);
    if (ws === "PAUSED" || ws === "STAYED" || ws === "BLOCKED")
        return chalk.yellow(ws);
    if (ws === "SUPERSEDED" || ws === "ABANDONED" || ws === "OVERRULED")
        return chalk.red(ws);
    if (ws === "DONE")
        return chalk.gray(ws);
    return chalk.white(ws);
}
function pct(n) {
    return `${Math.round(n * 100)}%`;
}
