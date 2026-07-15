/**
 * govctl case — Show and create cases
 */
import path from "node:path";
import chalk from "chalk";
import { loadState, writeCase, recordCaseOpened, newCaseId, nowISO, syncAgentRules, } from "@govruntime/govd";
export function registerCase(program) {
    const caseCmd = program.command("case").description("Manage cases");
    caseCmd
        .command("current")
        .description("Show the current active case")
        .option("--cwd <path>", "Working directory", process.cwd())
        .action((opts) => {
        const cwd = path.resolve(opts.cwd);
        const state = loadState(cwd);
        if (!state.active_case) {
            console.log(chalk.yellow("\n  No active case.\n"));
            console.log(chalk.gray("  Create one with: govctl case create --title ...\n"));
            return;
        }
        const c = state.active_case;
        console.log(chalk.bold.cyan(`\n⚖️  Active Case: ${c.case_id}\n`));
        console.log(`  ${chalk.bold("Status:")} ${c.status}`);
        console.log(`  ${chalk.bold("Opened:")} ${c.opened_at.slice(0, 10)}`);
        console.log("");
        console.log(`  ${chalk.bold("Issue:")}`);
        for (const i of c.issue) {
            console.log(`    - ${i}`);
        }
        console.log("");
        if (c.claims.user_claims.length > 0) {
            console.log(`  ${chalk.bold("User Claims:")}`);
            for (const claim of c.claims.user_claims) {
                console.log(`    - ${claim}`);
            }
            console.log("");
        }
        console.log(`  ${chalk.bold("Related Tickets:")} ${c.related_tickets.join(", ") || "none"}`);
        console.log(`  ${chalk.bold("Evidence:")} ${c.evidence.length} items`);
        console.log(`  ${chalk.bold("Precedents:")} ${c.precedents.join(", ") || "none"}`);
        console.log("");
    });
    caseCmd
        .command("show <case-id>")
        .description("Show a specific case")
        .option("--cwd <path>", "Working directory", process.cwd())
        .action((caseId, opts) => {
        const cwd = path.resolve(opts.cwd);
        const state = loadState(cwd);
        const c = state.cases.find((x) => x.case_id === caseId);
        if (!c) {
            console.log(chalk.red(`\n  Case ${caseId} not found.\n`));
            return;
        }
        console.log(chalk.bold.cyan(`\n⚖️  Case: ${c.case_id}\n`));
        console.log(`  ${chalk.bold("Status:")} ${c.status}`);
        console.log(`  ${chalk.bold("Opened:")} ${c.opened_at.slice(0, 10)}`);
        console.log("");
        console.log(`  ${chalk.bold("Issues:")}`);
        for (const i of c.issue)
            console.log(`    - ${i}`);
        console.log("");
        if (c.judgment) {
            console.log(`  ${chalk.bold("Judgment:")}`);
            console.log(`    Decision: ${chalk.green(c.judgment.decision)}`);
            console.log(`    Rationale:`);
            for (const r of c.judgment.rationale) {
                console.log(`      - ${r}`);
            }
            console.log("");
        }
    });
    caseCmd
        .command("create")
        .description("Open a new case")
        .requiredOption("--title <title>", "Case title / issue")
        .option("--cwd <path>", "Working directory", process.cwd())
        .option("--label <label>", "Short label for case ID (e.g. GOVERNANCE)")
        .option("--claims <claims...>", "User claims (can repeat)")
        .action((opts) => {
        const cwd = path.resolve(opts.cwd);
        const caseId = newCaseId(cwd, opts.label ?? opts.title.slice(0, 20));
        const now = nowISO();
        const c = {
            case_id: caseId,
            status: "OPEN",
            title: opts.title,
            opened_at: now,
            issue: [opts.title],
            claims: {
                user_claims: opts.claims ?? [],
            },
            evidence: [],
            applicable_law: {
                constitution: [
                    "preserve_user_intent_continuity",
                    "maintain_auditability",
                    "track_procedural_history",
                ],
                statutes: ["SCOPE-001", "TICKET-REISSUE-001", "BRANCH-001", "DOCKET-001"],
            },
            precedents: ["P-001", "P-002", "P-003", "P-004"],
            related_tickets: [],
            tags: [],
        };
        writeCase(cwd, c as any);
        recordCaseOpened(cwd, caseId, `Case opened: ${opts.title}`);
        // Sync agent rules
        try {
            syncAgentRules(loadState(cwd));
        }
        catch (err) {
            console.error("Failed to sync agent rules:", err);
        }
        console.log(chalk.bold.cyan("\n⚖️  Case Created\n"));
        console.log(`  ID:     ${chalk.cyan(caseId)}`);
        console.log(`  Status: ${chalk.green("OPEN")}`);
        console.log(`  Issue:  ${opts.title}`);
        console.log("");
        console.log(chalk.gray("  Next: create a ticket"));
        console.log(chalk.cyan(`  govctl ticket create --area ARCH --seq 1 --title "..." --objective "..."`));
        console.log("");
    });
    caseCmd
        .command("list")
        .description("List all cases")
        .option("--cwd <path>", "Working directory", process.cwd())
        .action((opts) => {
        const cwd = path.resolve(opts.cwd);
        const state = loadState(cwd);
        console.log(chalk.bold.cyan("\n⚖️  Cases\n"));
        if (state.cases.length === 0) {
            console.log(chalk.gray("  No cases. Run: govctl case create --title ...\n"));
            return;
        }
        for (const c of state.cases) {
            const isActive = state.active_case?.case_id === c.case_id;
            const marker = isActive ? chalk.cyan("▶ ") : "  ";
            console.log(`${marker}${chalk.bold(c.case_id)}  ${chalk.gray(c.status)}  ${chalk.gray(c.opened_at.slice(0, 10))}`);
            console.log(`   ${c.issue[0] ?? "(no issue defined)"}`);
            console.log(`   Tickets: ${c.related_tickets.length}  Evidence: ${c.evidence.length}`);
            console.log("");
        }
    });
}
