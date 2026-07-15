/**
 * govctl status — Show current governance posture
 */
import path from "node:path";
import chalk from "chalk";
import { loadState, readJsonlFile, govPath } from "@govruntime/govd";
import type { SourceReadTrace } from "@govruntime/govd";
import type { GovernanceSourceDebug } from "./diagnostics.js";
import { buildStateDebug, captureGovernanceInventory } from "./diagnostics.js";
export function registerStatus(program) {
    program
        .command("status")
        .description("Show current governance posture")
        .option("--cwd <path>", "Working directory", process.cwd())
        .option("--debug-state", "Show loader inputs and active-state selection details")
        .action((opts) => {
        const cwd = path.resolve(opts.cwd);
        let debug: GovernanceSourceDebug | null = null;
        let state;
        if (opts.debugState) {
            const inventory = captureGovernanceInventory(cwd);
            const trace: SourceReadTrace[] = [];
            state = loadState(cwd, { onSourceRead: (event) => trace.push(event) });
            debug = buildStateDebug(cwd, state, inventory, trace);
        }
        else {
            state = loadState(cwd);
        }
        console.log(chalk.bold.cyan("\n⚖️  Governance Status\n"));
        // Current Case
        console.log(chalk.bold("Current Case"));
        if (state.active_case) {
            console.log(`  ${chalk.cyan(state.active_case.case_id)}`);
            console.log(`  Status: ${statusColor(state.active_case.status)}`);
            if (state.active_case.issue.length > 0) {
                console.log(`  Issue:  ${state.active_case.issue[0]}`);
            }
        }
        else {
            console.log(`  ${chalk.yellow("⚠ No active case")}  — run ${chalk.cyan("govctl case create")}`);
        }
        console.log("");
        // Active Ticket
        console.log(chalk.bold("Active Ticket"));
        if (state.active_ticket) {
            const t = state.active_ticket;
            console.log(`  ${chalk.cyan(t.ticket_id)}  (Revision ${t.revision})`);
            console.log(`  Status: ${statusColor(t.status)}`);
            console.log(`  Title:  ${t.title}`);
            console.log(`  Work:   ${statusColor(t.workstream_status)}`);
            const done = t.acceptance_criteria.length;
            console.log(`  Criteria: ${done} acceptance criteria defined`);
        }
        else {
            console.log(`  ${chalk.yellow("⚠ No active ticket")}  — run ${chalk.cyan("govctl ticket list")}`);
        }
        console.log("");
        // Branch / Worktree
        console.log(chalk.bold("Current Branch / Worktree"));
        if (state.active_branch) {
            const b = state.active_branch;
            console.log(`  Branch:   ${chalk.cyan(b.branch)}`);
            if (b.worktree) {
                console.log(`  Worktree: ${chalk.gray(b.worktree)}`);
            }
            console.log(`  Scope:    ${b.intended_scope.join(", ") || "not defined"}`);
        }
        else {
            console.log(`  ${chalk.gray("No active branch ledger entry")}  — run ${chalk.cyan("govctl branch create")}`);
        }
        console.log("");
        // Why
        console.log(chalk.bold("Why This Work Exists"));
        const why = computeWhy(cwd, state);
        console.log(`  ${chalk.white(why)}`);
        console.log("");
        // Paused / Superseded
        const paused = state.tickets.filter((t) => t.workstream_status === "PAUSED" ||
            t.workstream_status === "SUPERSEDED" ||
            t.workstream_status === "DEFERRED");
        if (paused.length > 0) {
            console.log(chalk.bold("Paused / Superseded Workstreams"));
            for (const t of paused) {
                console.log(`  ${chalk.gray(t.ticket_id)} — ${t.title}  [${statusColor(t.workstream_status)}]`);
            }
            console.log("");
        }
        // Active precedents count
        const activePrecedents = state.precedents.filter((p) => p.status === "active");
        if (activePrecedents.length > 0) {
            console.log(chalk.bold("Active Precedents"));
            console.log(`  ${activePrecedents.length} active precedent(s) in force`);
            console.log("");
        }
        // Next action
        console.log(chalk.bold("Next"));
        if (state.active_ticket) {
            const firstCriteria = state.active_ticket.acceptance_criteria[0];
            if (firstCriteria) {
                console.log(`  Satisfy: ${firstCriteria}`);
            }
            else {
                console.log(`  Continue work on ${chalk.cyan(state.active_ticket.ticket_id)}`);
            }
        }
        else if (state.active_case) {
            console.log(`  Issue a ticket: ${chalk.cyan("govctl ticket list")}`);
        }
        else {
            console.log(`  Initialize governance: ${chalk.cyan("govctl init")}`);
        }
        if (debug) {
            printDebugState(debug);
        }
        console.log("");
    });
}
function printDebugState(debug) {
    console.log("");
    console.log(chalk.bold("Debug State"));
    console.log(`  Format:    ${debug.format}`);
    console.log(`  Snapshot:  ${debug.snapshot}`);
    console.log(`  Gov dir:   ${debug.governance_dir_exists ? debug.governance_dir : `${debug.governance_dir} (missing)`}`);
    console.log(`  Active:    case=${debug.active.case_id ?? "none"} ticket=${debug.active.ticket_id ?? "none"} branch=${debug.active.branch ?? "none"}`);
    console.log(`  Counts:    cases=${debug.counts.cases} tickets=${debug.counts.tickets} branches=${debug.counts.branches}`);
    console.log(`  Legacy:    yaml_cases=${debug.counts.legacy_yaml_cases} json_cases=${debug.counts.legacy_json_cases} yaml_tickets=${debug.counts.legacy_yaml_tickets} json_tickets=${debug.counts.legacy_json_tickets}`);
    if (debug.files_present.length > 0) {
        console.log("  Files present:");
        for (const file of debug.files_present) {
            console.log(`    - ${file}`);
        }
    }
    if (debug.files_read.length > 0) {
        console.log("  Files read:");
        for (const file of debug.files_read) {
            console.log(`    - ${file}`);
        }
    }
    if (debug.ignored_or_unsupported.length > 0) {
        console.log("  Ignored / unsupported:");
        for (const file of debug.ignored_or_unsupported) {
            console.log(`    - ${file}`);
        }
    }
}
function computeWhy(cwd, state) {
    if (!state.active_case)
        return "No active case. Governance context not established.";
    const docketPath = govPath(cwd, "docket", "docket_events.jsonl");
    const events = readJsonlFile(docketPath);
    const caseEvents = events.filter((e) => e.case_id === state.active_case?.case_id);
    const opening = caseEvents.find((e) => e.event_type === "case_opened" || e.event_type === "ticket_issued");
    if (!opening) {
        return `Case ${state.active_case.case_id} is active. No docket events yet — run govctl timeline after recording events.`;
    }
    const deepen = caseEvents.filter((e) => e.event_type === "workstream_deepened" || e.event_type === "ticket_reissued");
    if (deepen.length > 0) {
        const last = deepen[deepen.length - 1];
        return last?.reason ?? opening.reason;
    }
    return opening.reason;
}
function statusColor(status) {
    const s = status.toLowerCase();
    if (s.includes("active") || s === "open" || s === "in_progress" || s === "enforcing") {
        return chalk.green(status);
    }
    if (s.includes("paused") || s.includes("blocked") || s.includes("stayed")) {
        return chalk.yellow(status);
    }
    if (s.includes("super") || s.includes("cancel") || s.includes("abandon")) {
        return chalk.red(status);
    }
    if (s === "done" || s === "closed" || s === "judged") {
        return chalk.gray(status);
    }
    return chalk.white(status);
}
