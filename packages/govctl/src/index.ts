#!/usr/bin/env node
/**
 * govctl — AI Legal Governance Runtime CLI
 */

import { Command } from "commander";
import { registerInit } from "./commands/init.js";
import { registerStatus } from "./commands/status.js";
import { registerWhy } from "./commands/why.js";
import { registerTimeline } from "./commands/timeline.js";
import { registerEvidence } from "./commands/evidence.js";
import { registerTicket } from "./commands/ticket.js";
import { registerBranch } from "./commands/branch.js";
import { registerCase } from "./commands/case.js";
import { registerHook } from "./commands/hook.js";
import { registerMode } from "./commands/mode.js";
import { registerAudit } from "./commands/audit.js";
import { registerDecision } from "./commands/decision.js";
import { registerInvariant } from "./commands/invariant.js";
import { registerPack } from "./commands/pack.js";
import { registerLinear } from "./commands/linear.js";

const program = new Command();

program
  .name("govctl")
  .description("AI Legal Governance Runtime — governance control CLI")
  .version("0.1.2-alpha");

registerInit(program);
registerStatus(program);
registerWhy(program);
registerTimeline(program);
registerEvidence(program);
registerTicket(program);
registerBranch(program);
registerCase(program);
registerHook(program);
registerMode(program);
registerAudit(program);
registerDecision(program);
registerInvariant(program);
registerPack(program);
registerLinear(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error("govctl error:", err);
  process.exit(1);
});
