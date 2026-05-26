/**
 * govctl audit - Inspect and verify the tamper-evident local audit ledger.
 */

import type { Command } from "commander";
import path from "node:path";
import chalk from "chalk";
import {
  createAuditCheckpoint,
  inspectLedgerRecord,
  readAuditHead,
  verifyAuditLedger,
} from "@govruntime/govd";

export function registerAudit(program: Command): void {
  const auditCmd = program.command("audit").description("Inspect and verify the tamper-evident audit ledger");

  auditCmd
    .command("head")
    .description("Show .governance/audit/head.json")
    .option("--cwd <path>", "Working directory", process.cwd())
    .action((opts: { cwd: string }) => {
      const cwd = path.resolve(opts.cwd);
      const head = readAuditHead(cwd);
      console.log(chalk.bold.cyan("\nGovRuntime Audit Head\n"));
      console.log(`  Last seq:  ${head.last_seq}`);
      console.log(`  Last hash: ${head.last_hash}`);
      console.log(`  Updated:   ${head.updated_at}`);
      console.log("");
    });

  auditCmd
    .command("verify")
    .description("Verify ledger hash chain and head.json")
    .option("--cwd <path>", "Working directory", process.cwd())
    .action((opts: { cwd: string }) => {
      const cwd = path.resolve(opts.cwd);
      const result = verifyAuditLedger(cwd);
      if (result.ok) {
        console.log(chalk.green(`\nAudit ledger verified: ${result.checked} entr${result.checked === 1 ? "y" : "ies"}.\n`));
        return;
      }

      const failure = result.failure;
      console.log(chalk.red("\nAudit ledger verification failed\n"));
      if (failure) {
        console.log(`  First invalid seq: ${failure.seq}`);
        if (failure.stream) console.log(`  Stream:            ${failure.stream}`);
        if (failure.record_id) console.log(`  Record ID:         ${failure.record_id}`);
        console.log(`  Reason:            ${failure.reason}`);
        if (failure.expected !== undefined) console.log(`  Expected:          ${failure.expected}`);
        if (failure.actual !== undefined) console.log(`  Actual:            ${failure.actual}`);
        console.log(`  Interpretation:    ${failure.interpretation}`);
      }
      console.log("");
      process.exitCode = 1;
    });

  auditCmd
    .command("inspect")
    .description("Inspect one ledger envelope by sequence number")
    .requiredOption("--seq <number>", "Ledger sequence number")
    .option("--cwd <path>", "Working directory", process.cwd())
    .action((opts: { cwd: string; seq: string }) => {
      const cwd = path.resolve(opts.cwd);
      const seq = Number.parseInt(opts.seq, 10);
      const record = inspectLedgerRecord(cwd, seq);
      if (!record) {
        console.log(chalk.red(`\n  No ledger record found for seq ${opts.seq}.\n`));
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(record, null, 2));
    });

  auditCmd
    .command("checkpoint")
    .description("Create an unsigned local checkpoint for the current ledger tip")
    .option("--cwd <path>", "Working directory", process.cwd())
    .action((opts: { cwd: string }) => {
      const cwd = path.resolve(opts.cwd);
      try {
        const checkpoint = createAuditCheckpoint(cwd);
        console.log(chalk.bold.cyan("\nGovRuntime Audit Checkpoint\n"));
        console.log(`  From seq:  ${checkpoint.from_seq}`);
        console.log(`  To seq:    ${checkpoint.to_seq}`);
        console.log(`  Tip hash:  ${checkpoint.tip_hash}`);
        console.log(`  Signature: ${checkpoint.signature === null ? "null (not configured)" : "present"}`);
        console.log(`  File:      .governance/audit/checkpoints/checkpoint-${checkpoint.to_seq}.json`);
        console.log("");
      } catch (error) {
        console.log(chalk.red(`\n  Failed to create checkpoint: ${error instanceof Error ? error.message : String(error)}\n`));
        process.exitCode = 1;
      }
    });
}
