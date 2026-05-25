/**
 * govctl evidence — List and admit evidence
 */
import path from "node:path";
import chalk from "chalk";
import { loadState, admitUserStatement, readJsonlFile, govPath, syncAgentRules } from "@govruntime/govd";
export function registerEvidence(program) {
    const evidenceCmd = program
        .command("evidence")
        .description("Manage evidence registry");
    evidenceCmd
        .command("list")
        .description("List evidence for the current case")
        .option("--cwd <path>", "Working directory", process.cwd())
        .option("--limit <n>", "Max records to show", "20")
        .option("--type <type>", "Filter by evidence type")
        .action((opts) => {
        const cwd = path.resolve(opts.cwd);
        const state = loadState(cwd);
        const limit = parseInt(opts.limit, 10);
        const evidencePath = govPath(cwd, "evidence", "evidence.jsonl");
        let evidence = readJsonlFile(evidencePath);
        if (state.active_case) {
            evidence = evidence.filter((e) => e.case_id === state.active_case?.case_id || !e.case_id);
        }
        if (opts.type) {
            evidence = evidence.filter((e) => e.type.includes(opts.type));
        }
        evidence = evidence.slice(-limit);
        console.log(chalk.bold.cyan(`\n⚖️  Evidence Registry\n`));
        if (evidence.length === 0) {
            console.log(chalk.gray("  No evidence recorded yet.\n"));
            return;
        }
        for (const ev of evidence) {
            const tierColor = ev.tier <= 2 ? chalk.green : ev.tier <= 4 ? chalk.yellow : chalk.gray;
            console.log(`  ${chalk.cyan(ev.evidence_id)}  ${tierColor(`[Tier ${ev.tier}]`)}  ${chalk.white(ev.type)}`);
            console.log(`  ${chalk.gray("Created:")} ${ev.created_at.slice(0, 10)}`);
            if (ev.source.quote) {
                console.log(`  ${chalk.gray("Quote:")} "${ev.source.quote.slice(0, 120)}"`);
            }
            if (ev.claims.length > 0) {
                const c = ev.claims[0];
                if (c) {
                    console.log(`  ${chalk.gray("Claim:")} ${c.claim.slice(0, 120)} ${chalk.gray(`(${Math.round(c.confidence * 100)}%)`)}`);
                }
            }
            console.log("");
        }
    });
    evidenceCmd
        .command("admit")
        .description("Admit a user statement as evidence")
        .requiredOption("--quote <text>", "The exact user statement to admit")
        .option("--cwd <path>", "Working directory", process.cwd())
        .option("--claim <claim>", "Claim derived from this statement")
        .option("--confidence <n>", "Confidence level (0.0–1.0)", "0.99")
        .action((opts) => {
        const cwd = path.resolve(opts.cwd);
        const state = loadState(cwd);
        const admitOpts: any = {
            quote: opts.quote,
            claims: [{ claim: opts.claim ?? opts.quote, confidence: parseFloat(opts.confidence) }],
        };
        if (state.active_case)
            admitOpts.case_id = state.active_case.case_id;
        if (state.active_ticket)
            admitOpts.ticket_id = state.active_ticket.ticket_id;
        const evidence = admitUserStatement(cwd, admitOpts);
        // Sync agent rules
        try {
            syncAgentRules(loadState(cwd));
        }
        catch (err) {
            console.error("Failed to sync agent rules:", err);
        }
        console.log(chalk.bold.cyan("\n⚖️  Evidence Admitted\n"));
        console.log(`  ID:     ${chalk.cyan(evidence.evidence_id)}`);
        console.log(`  Type:   ${evidence.type}`);
        console.log(`  Tier:   ${evidence.tier} (highest authority)`);
        console.log(`  Quote:  "${evidence.source.quote?.slice(0, 100)}"`);
        if (state.active_case) {
            console.log(`  Case:   ${chalk.cyan(state.active_case.case_id)}`);
        }
        console.log("");
    });
}
