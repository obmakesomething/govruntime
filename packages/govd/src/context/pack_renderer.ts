/**
 * Procedural Context Pack Renderer
 *
 * Produces the markdown string injected into the agent's context at
 * SessionStart and after UserPromptSubmit.
 *
 * This is the primary mechanism for communicating governance posture to the agent.
 */

import type { GovernanceState, Ticket } from "../state/types.js";
import { readJsonlFile, govPath } from "../state/loader.js";
import type { DocketEvent } from "../state/types.js";
import fs from "node:fs";
import path from "node:path";

export function renderContextPack(state: GovernanceState): string {
  const { active_case, active_ticket, active_branch, tickets, cases } = state;

  const lines: string[] = [];

  lines.push("## ⚖️ Procedural Context Pack");
  lines.push("");
  lines.push(
    "*Injected by AI Legal Governance Runtime. This is authoritative governance state.*"
  );
  lines.push("");

  // --- Current Case ---
  lines.push("### Current Case");
  if (active_case) {
    lines.push(`- **ID**: \`${active_case.case_id}\``);
    lines.push(`- **Status**: ${active_case.status}`);
    if (active_case.issue.length > 0) {
      lines.push(`- **Issue**: ${active_case.issue[0]}`);
    }
  } else {
    lines.push("- ⚠️ **No active case.** Create a case before proceeding.");
  }
  lines.push("");

  // --- Why This Work Exists ---
  lines.push("### Why This Work Exists");
  const why = computeWhy(state);
  lines.push(why);
  lines.push("");

  // --- Active Ticket ---
  lines.push("### Active Ticket");
  if (active_ticket) {
    lines.push(`- **ID**: \`${active_ticket.ticket_id}\` (Revision ${active_ticket.revision})`);
    lines.push(`- **Status**: ${active_ticket.status}`);
    lines.push(`- **Title**: ${active_ticket.title}`);
    lines.push(`- **Objective**: ${active_ticket.objective}`);
    if (active_ticket.acceptance_criteria.length > 0) {
      lines.push("- **Acceptance Criteria**:");
      for (const c of active_ticket.acceptance_criteria) {
        lines.push(`  - [ ] ${c}`);
      }
    }
    if (active_ticket.non_goals.length > 0) {
      lines.push("- **Non-Goals**:");
      for (const ng of active_ticket.non_goals) {
        lines.push(`  - ${ng}`);
      }
    }
  } else {
    lines.push("- ⚠️ **No active ticket.** Issue a ticket before executing.");
  }
  lines.push("");

  // --- Current Branch / Worktree ---
  lines.push("### Current Branch / Worktree");
  if (active_branch) {
    lines.push(`- **Branch**: \`${active_branch.branch}\``);
    if (active_branch.worktree) {
      lines.push(`- **Worktree**: \`${active_branch.worktree}\``);
    }
    if (active_branch.intended_scope.length > 0) {
      lines.push(
        `- **Intended Scope**: ${active_branch.intended_scope.join(", ")}`
      );
    }
    if (active_branch.forbidden_scope.length > 0) {
      lines.push(
        `- **Forbidden Scope**: ${active_branch.forbidden_scope.join(", ")}`
      );
    }
  } else {
    lines.push("- No active branch ledger entry. Create one with `govctl branch create`.");
  }
  lines.push("");

  // --- Paused / Superseded Workstreams ---
  const pausedTickets = tickets.filter(
    (t) =>
      t.workstream_status === "PAUSED" ||
      t.workstream_status === "SUPERSEDED" ||
      t.workstream_status === "DEFERRED"
  );
  if (pausedTickets.length > 0) {
    lines.push("### Do Not Resume");
    for (const t of pausedTickets) {
      lines.push(
        `- \`${t.ticket_id}\` — ${t.title}: **${t.workstream_status}**${t.reason_for_reissue ? `. Reason: ${t.reason_for_reissue}` : ""}`
      );
    }
    lines.push("");
  }

  // --- Must Preserve ---
  if (active_case?.applicable_law.constitution.length) {
    lines.push("### Must Preserve");
    for (const principle of active_case.applicable_law.constitution) {
      lines.push(`- ${principle}`);
    }
    lines.push("");
  }

  // --- Active Decisions / Invariants ---
  const activeDecisions = state.decisions.filter((decision) => decision.status === "active").slice(-5);
  const activeInvariants = state.invariants.filter((invariant) => invariant.status === "active").slice(-5);
  if (activeDecisions.length > 0 || activeInvariants.length > 0) {
    lines.push("### Active Architecture Decisions / Invariants");
    for (const decision of activeDecisions) {
      lines.push(`- **Decision** \`${decision.decision_id}\`: ${decision.title}`);
      if (decision.scope.length > 0) {
        lines.push(`  - Scope: ${decision.scope.join(", ")}`);
      }
    }
    for (const invariant of activeInvariants) {
      lines.push(`- **Invariant** \`${invariant.invariant_id}\`: ${invariant.title}`);
      for (const rule of invariant.rule.slice(0, 3)) {
        lines.push(`  - ${rule}`);
      }
      if (invariant.required_ticket_acceptance_criteria.length > 0) {
        lines.push("  - Required acceptance criteria:");
        for (const criterion of invariant.required_ticket_acceptance_criteria.slice(0, 4)) {
          lines.push(`    - ${criterion}`);
        }
      }
    }
    lines.push("");
  }

  // --- Recent Docket Activity ---
  const recentDocket = getRecentDocketEvents(state, 5);
  if (recentDocket.length > 0) {
    lines.push("### Recent Procedural Events");
    for (const e of recentDocket) {
      lines.push(
        `- \`${e.event_type}\` — ${e.reason} *(${e.created_at.slice(0, 10)})*`
      );
    }
    lines.push("");
  }

  // --- Next Expected Action ---
  lines.push("### Next Expected Action");
  if (active_ticket) {
    const incomplete = active_ticket.acceptance_criteria.filter((c) =>
      c.trim().length > 0
    );
    if (incomplete.length > 0) {
      lines.push(`Satisfy the acceptance criteria of \`${active_ticket.ticket_id}\`:`);
      lines.push(`- ${incomplete[0]}`);
    } else {
      lines.push(`Continue work on \`${active_ticket.ticket_id}\`.`);
    }
  } else {
    lines.push("Create a case and ticket with `govctl init` and `govctl ticket list`.");
  }
  lines.push("");

  lines.push("---");
  lines.push(
    "*Do not act outside the active ticket scope. Do not create orphan branches.*"
  );
  lines.push(
    "*Refer to `.governance/` for authoritative state. Run `govctl status` for a summary.*"
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Why computation (docket-derived)
// ---------------------------------------------------------------------------

function computeWhy(state: GovernanceState): string {
  const docketPath = govPath(state.cwd, "docket", "docket_events.jsonl");
  const events = readJsonlFile<DocketEvent>(docketPath);

  const caseEvents = state.active_case
    ? events.filter((e) => e.case_id === state.active_case?.case_id)
    : [];

  // Find the opening event
  const opening = caseEvents.find(
    (e) => e.event_type === "case_opened" || e.event_type === "ticket_issued"
  );

  if (!opening && !state.active_case) {
    return "No active case. Governance context not yet established.";
  }

  if (!opening && state.active_case) {
    return `Case \`${state.active_case.case_id}\` is active. Docket not yet populated — run \`govctl timeline\` after first events are recorded.`;
  }

  const deepenEvents = caseEvents.filter(
    (e) =>
      e.event_type === "workstream_deepened" ||
      e.event_type === "ticket_reissued" ||
      e.event_type === "case_reframed"
  );

  const lines: string[] = [];
  if (opening) {
    lines.push(`**Origin**: ${opening.reason}`);
  }
  for (const e of deepenEvents.slice(-3)) {
    lines.push(`**Updated**: ${e.reason}`);
  }

  return lines.join("\n") || "Docket reason not yet recorded.";
}

function getRecentDocketEvents(
  state: GovernanceState,
  limit: number
): DocketEvent[] {
  const docketPath = govPath(state.cwd, "docket", "docket_events.jsonl");
  const events = readJsonlFile<DocketEvent>(docketPath);
  return events.slice(-limit).reverse();
}

export function syncAgentRules(state: GovernanceState): void {
  const result = syncAgentRuleTargets(state);
  for (const failure of result.failures) {
    console.error(`Failed to sync agent rules to ${failure.path}:`, failure.error);
  }
}

export function syncAgentRulesStrict(state: GovernanceState): void {
  const result = syncAgentRuleTargets(state);
  if (result.failures.length === 0) return;
  const details = result.failures
    .map((failure) => `${failure.path}: ${failure.error instanceof Error ? failure.error.message : String(failure.error)}`)
    .join("; ");
  throw new Error(`Agent posture sync failed: ${details}`);
}

function syncAgentRuleTargets(state: GovernanceState): {
  written: string[];
  failures: Array<{ path: string; error: unknown }>;
} {
  const cwd = state.cwd;
  const contextPack = renderContextPack(state);

  const startMarker = "<!-- GOV-POSTURE-START -->";
  const endMarker = "<!-- GOV-POSTURE-END -->";
  const block = `${startMarker}\n${contextPack}\n${endMarker}`;

  const targets = [
    path.join(cwd, ".cursorrules"),
    path.join(cwd, ".clinerules"),
    path.join(cwd, ".github", "copilot-instructions.md"),
    path.join(cwd, "CLAUDE.md"),
  ];
  const written: string[] = [];
  const failures: Array<{ path: string; error: unknown }> = [];

  for (const targetPath of targets) {
    try {
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let content = "";
      if (fs.existsSync(targetPath)) {
        content = fs.readFileSync(targetPath, "utf8");
      }

      const startIndex = content.indexOf(startMarker);
      const endIndex = content.indexOf(endMarker);

      if ((startIndex === -1) !== (endIndex === -1) || (startIndex !== -1 && endIndex <= startIndex)) {
        throw new Error("Malformed GOV posture markers require manual recovery.");
      }

      let nextContent: string;
      if (startIndex !== -1 && endIndex !== -1) {
        nextContent =
          content.slice(0, startIndex) +
          block +
          content.slice(endIndex + endMarker.length);
      } else {
        if (content.length > 0 && !content.endsWith("\n")) {
          content += "\n";
        }
        nextContent = content + `\n${block}\n`;
      }

      if (nextContent !== content) {
        atomicWriteText(targetPath, nextContent);
        written.push(targetPath);
      }
      if (fs.readFileSync(targetPath, "utf8") !== nextContent) {
        throw new Error("Posture verification did not match the rendered content.");
      }
    } catch (err) {
      failures.push({ path: targetPath, error: err });
    }
  }

  return { written, failures };
}

function atomicWriteText(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, filePath);
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // Preserve the original write failure.
    }
  }
}
