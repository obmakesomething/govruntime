/**
 * govctl branch — List and create branch ledger entries
 */
import path from "node:path";
import chalk from "chalk";
import { appendLedgerRecord, canonicalJson, loadState, createBranchEntry, updateBranchStatus, withBranchLedgerLock, recordDocketEvent, buildBranchName, buildWorktreePath, syncAgentRules, syncAgentRulesStrict, isAuditHeadExactlyOneEntryBehind, readJsonlFileStrict, readLedger, repairAuditHeadIfExactlyOneEntryBehind, verifyAuditLedger, govPath, } from "@govruntime/govd";
export function registerBranch(program) {
    const branchCmd = program.command("branch").description("Manage branch ledger");
    branchCmd
        .command("list")
        .description("List all branches in the ledger")
        .option("--cwd <path>", "Working directory", process.cwd())
        .option("--status <status>", "Filter by status")
        .action((opts) => {
        const cwd = path.resolve(opts.cwd);
        const state = loadState(cwd);
        let branches = state.branch_ledger.branches;
        if (opts.status) {
            branches = branches.filter((b) => b.status.toLowerCase().includes(opts.status.toLowerCase()));
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
        .action((opts) => {
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
        }
        catch (err) {
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
    });
    branchCmd
        .command("abandon <branch>")
        .description("Mark one active branch as abandoned and record the transition")
        .requiredOption("--reason <reason>", "Why the branch is being abandoned")
        .option("--successor <branch>", "Active successor branch, when one exists")
        .option("--cwd <path>", "Working directory", process.cwd())
        .action((branchName, opts) => {
        const cwd = path.resolve(opts.cwd);
        const reason = String(opts.reason ?? "").trim();
        if (!reason) {
            failAbandon("A non-empty --reason is required.");
            return;
        }
        try {
            withBranchLedgerLock(cwd, () => {
                const state = loadState(cwd);
                const matches = state.branch_ledger.branches.filter((branch) => branch.branch === branchName);
                if (matches.length === 0) {
                    failAbandon(`Branch not found: ${branchName}`);
                    return;
                }
                if (matches.length > 1) {
                    failAbandon(`Duplicate branch ledger identity: ${branchName}`);
                    return;
                }
                const target = matches[0];
                if (!target) {
                    failAbandon(`Branch not found: ${branchName}`);
                    return;
                }
                const successorName = opts.successor ? String(opts.successor) : undefined;
                if (successorName === branchName) {
                    failAbandon("The successor branch must differ from the abandoned branch.");
                    return;
                }
                let successor;
                if (successorName) {
                    const successorMatches = state.branch_ledger.branches.filter((branch) => branch.branch === successorName);
                    if (successorMatches.length !== 1) {
                        failAbandon(successorMatches.length === 0
                            ? `Successor branch not found: ${successorName}`
                            : `Duplicate successor branch ledger identity: ${successorName}`);
                        return;
                    }
                    successor = successorMatches[0];
                    if (!successor) {
                        failAbandon(`Successor branch not found: ${successorName}`);
                        return;
                    }
                    if (successor.case_id !== target.case_id) {
                        failAbandon(`Successor branch must belong to case ${target.case_id}: ${successorName}`);
                        return;
                    }
                }
                if (target.status !== "active" && target.status !== "abandoned") {
                    failAbandon(`Abandon transition conflict for ${branchName}; status is ${target.status}, expected active or abandoned.`);
                    return;
                }
                const docketPath = govPath(cwd, "docket", "docket_events.jsonl");
                const priorEvents = readDocketHistoryStrict(docketPath).filter((event) => event?.event_type === "branch_abandoned" &&
                    Array.isArray(event?.affected_branches) &&
                    event.affected_branches.includes(branchName));
                if (priorEvents.length > 1) {
                    failAbandon(`Abandon transition conflict for ${branchName}; duplicate abandonment docket events exist.`);
                    return;
                }
                let event = priorEvents[0];
                if (event && !isExactAbandonmentEvent(event, target, branchName, reason, successorName)) {
                    failAbandon(`Abandon transition conflict for ${branchName}; the existing docket event does not match this request.`);
                    return;
                }
                if (successorName && !event && successor?.status !== "active") {
                    failAbandon(`Successor branch must be active for a new abandon transition: ${successorName}`);
                    return;
                }
                const auditPreflight = readAuditLedgerForPreflight(cwd);
                let hasAuditMirror = inspectExistingAuditState(auditPreflight.entries, event, branchName);
                if (auditPreflight.repairHead) {
                    repairAuditHeadIfExactlyOneEntryBehind(cwd);
                    assertAuditLedgerValid(cwd);
                    hasAuditMirror = inspectExistingAuditState(readLedger(cwd), event, branchName);
                }
                const alreadyRecorded = target.status === "abandoned" && Boolean(event);
                if (!event) {
                    event = recordDocketEvent(cwd, {
                        case_id: target.case_id,
                        ticket_id: target.ticket_id,
                        event_type: "branch_abandoned",
                        actor: "system",
                        reason,
                        status_before: "active",
                        status_after: "abandoned",
                        affected_branches: [branchName],
                        metadata: successorName ? { successor_branch: successorName } : {},
                    });
                }
                else if (!hasAuditMirror) {
                    appendLedgerRecord(cwd, "docket", event.event_id, event, {
                        actor: event.actor,
                        case_id: event.case_id,
                        ticket_id: event.ticket_id,
                    });
                }
                assertExactAuditMirror(cwd, event, branchName);
                if (target.status === "active" || !target.abandoned_at) {
                    const updated = updateBranchStatus(cwd, branchName, "abandoned", {
                        abandoned_at: target.abandoned_at ?? event.created_at,
                    });
                    if (!updated) {
                        throw new Error(`Branch disappeared during abandon transition: ${branchName}`);
                    }
                }
                syncAgentRulesStrict(loadState(cwd));
                assertFinalAbandonmentState(cwd, branchName, event);
                if (alreadyRecorded) {
                    console.log(chalk.gray(`\n  Branch already abandoned; transition verified: ${branchName}\n`));
                    return;
                }
                console.log(chalk.bold.cyan("\n⚖️  Branch Abandoned\n"));
                console.log(`  ${chalk.bold("Branch:")}    ${branchName}`);
                console.log(`  ${chalk.bold("Reason:")}    ${reason}`);
                if (successorName) {
                    console.log(`  ${chalk.bold("Successor:")} ${successorName}`);
                }
                console.log(`  ${chalk.bold("Event:")}     ${event.event_id}`);
                console.log("");
            });
        }
        catch (err) {
            failAbandon(err instanceof Error ? err.message : String(err));
        }
    });
}
function readDocketHistoryStrict(docketPath) {
    try {
        return readJsonlFileStrict(docketPath);
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Docket history is invalid: ${detail}`);
    }
}
function assertAuditLedgerValid(cwd) {
    const verification = verifyAuditLedger(cwd);
    if (verification.ok)
        return;
    throwInvalidAuditLedger(verification);
}
function readAuditLedgerForPreflight(cwd) {
    const verification = verifyAuditLedger(cwd);
    if (verification.ok) {
        return { entries: readLedger(cwd), repairHead: false };
    }
    if (isAuditHeadExactlyOneEntryBehind(cwd)) {
        return { entries: readLedger(cwd), repairHead: true };
    }
    throwInvalidAuditLedger(verification);
}
function throwInvalidAuditLedger(verification): never {
    const failure = verification.failure;
    const detail = failure
        ? `${failure.reason} ${failure.interpretation}`
        : "unknown verification failure";
    throw new Error(`Audit ledger is invalid: ${detail}`);
}
function inspectExistingAuditState(auditEntries, event, branchName) {
    const branchEntries = auditEntries.filter((entry) => isAbandonmentAuditForBranch(entry, branchName));
    if (!event) {
        if (branchEntries.length > 0) {
            throw new Error(`Audit conflict for ${branchName}; an orphaned abandonment audit record exists without a docket event.`);
        }
        return false;
    }
    const eventEntries = auditEntries.filter((entry) => entry?.record_id === event.event_id);
    const otherBranchEntries = branchEntries.filter((entry) => entry?.record_id !== event.event_id);
    if (eventEntries.length > 1 || otherBranchEntries.length > 0) {
        throw new Error(`Audit duplicate or conflict for ${branchName}; expected at most one exact mirror.`);
    }
    if (eventEntries.length === 1 && !auditMirrorsEvent(eventEntries[0], event)) {
        throw new Error(`Audit conflict for ${branchName}; the existing mirror does not match the docket event.`);
    }
    return eventEntries.length === 1;
}
function assertExactAuditMirror(cwd, event, branchName) {
    assertAuditLedgerValid(cwd);
    const auditEntries = readLedger(cwd);
    const eventEntries = auditEntries.filter((entry) => entry?.record_id === event.event_id);
    const branchEntries = auditEntries.filter((entry) => isAbandonmentAuditForBranch(entry, branchName));
    if (eventEntries.length !== 1 || branchEntries.length !== 1 || !auditMirrorsEvent(eventEntries[0], event)) {
        throw new Error(`Audit duplicate or conflict for ${branchName}; exactly one matching docket mirror is required.`);
    }
}
function assertFinalAbandonmentState(cwd, branchName, event) {
    const state = loadState(cwd);
    const matches = state.branch_ledger.branches.filter((branch) => branch.branch === branchName);
    if (matches.length !== 1 || matches[0]?.status !== "abandoned" || !matches[0]?.abandoned_at) {
        throw new Error(`Branch abandon reconciliation is incomplete for ${branchName}.`);
    }
    const events = readDocketHistoryStrict(govPath(cwd, "docket", "docket_events.jsonl")).filter((entry) => entry?.event_type === "branch_abandoned" &&
        Array.isArray(entry?.affected_branches) &&
        entry.affected_branches.includes(branchName));
    if (events.length !== 1 || canonicalJson(events[0]) !== canonicalJson(event)) {
        throw new Error(`Docket conflict for ${branchName}; exactly one matching abandonment event is required.`);
    }
    assertExactAuditMirror(cwd, event, branchName);
}
function isExactAbandonmentEvent(event, target, branchName, reason, successorName) {
    const expectedMetadata = successorName ? { successor_branch: successorName } : {};
    return typeof event?.event_id === "string" &&
        typeof event?.created_at === "string" &&
        event.case_id === target.case_id &&
        event.ticket_id === target.ticket_id &&
        event.event_type === "branch_abandoned" &&
        event.actor === "system" &&
        event.reason === reason &&
        event.status_before === "active" &&
        event.status_after === "abandoned" &&
        Array.isArray(event.evidence) &&
        event.evidence.length === 0 &&
        Array.isArray(event.affected_branches) &&
        event.affected_branches.length === 1 &&
        event.affected_branches[0] === branchName &&
        canonicalJson(event.metadata ?? {}) === canonicalJson(expectedMetadata);
}
function isAbandonmentAuditForBranch(entry, branchName) {
    const payload = entry?.payload;
    return entry?.stream === "docket" &&
        payload?.event_type === "branch_abandoned" &&
        Array.isArray(payload?.affected_branches) &&
        payload.affected_branches.includes(branchName);
}
function auditMirrorsEvent(entry, event) {
    return entry?.stream === "docket" &&
        entry.record_id === event.event_id &&
        entry.case_id === event.case_id &&
        entry.ticket_id === event.ticket_id &&
        entry.actor === event.actor &&
        canonicalJson(entry.payload) === canonicalJson(event);
}
function failAbandon(message) {
    process.exitCode = 1;
    console.error(chalk.red(`\n  ${message}\n`));
}
