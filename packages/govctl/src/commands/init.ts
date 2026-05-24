/**
 * govctl init — Bootstrap .governance/ structure in a repo
 */

import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import yaml from "js-yaml";
import {
  ensureGovernanceDirs,
  touchJsonl,
  writeYamlFile,
  govPath,
  syncAgentRules,
  loadState,
} from "@govruntime/govd";

const CONSTITUTION: Record<string, unknown> = {
  version: "0.1",
  mission: [
    "preserve_user_intent_continuity",
    "maintain_evidence_based_execution",
    "prevent_silent_scope_drift",
    "separate_reasoning_from_enforcement",
    "maintain_auditability",
    "track_procedural_history",
    "bind_branches_and_worktrees_to_cases",
  ],
  non_negotiables: [
    "no_execution_outside_active_case",
    "no_execution_outside_active_ticket",
    "no_destructive_action_without_explicit_authorization",
    "no_policy_override_by_model_inference",
    "no_silent_revision_of_user_intent",
    "no_orphan_branch_or_worktree",
    "no_unsupported_factual_claim_in_high_risk_context",
  ],
  authority_hierarchy: [
    "1_external_law_and_regulation",
    "2_enterprise_constitution",
    "3_enterprise_statutes",
    "4_project_regulations",
    "5_current_explicit_user_instruction",
    "6_active_precedent",
    "7_prior_memory",
    "8_model_inference",
  ],
  standard_of_proof: {
    casual_answer: { required: "plausible_basis", threshold: 0.50 },
    design_decision: { required: "evidence_supported", threshold: 0.70 },
    code_change: { required: "clear_and_convincing", threshold: 0.80 },
    destructive_action: { required: "explicit_authorization", threshold: 0.95 },
    policy_override: { required: "human_approval", threshold: 1.00 },
  },
};

const STATUTES: Record<string, Record<string, unknown>> = {
  "scope_control.yaml": {
    id: "SCOPE-001",
    name: "no_silent_scope_expansion",
    version: "0.1",
    applies_to: { hook_events: ["PreToolUse", "Stop"] },
    condition: { action_outside_active_ticket: true },
    required_evidence: ["active_case", "active_ticket", "user_authorization_or_ticket_reissue"],
    decision: {
      if_missing_evidence: "warn",
      if_minor_scope_expansion: "create_discovered_issue",
      if_major_scope_expansion: "require_human_review",
    },
    enforcement: {
      hook: "PreToolUse",
      message: "Action is outside the active ticket. Create or reissue a ticket before executing.",
    },
    audit: { log_event: "execution_blocked" },
  },
  "ticket_reissue.yaml": {
    id: "TICKET-REISSUE-001",
    name: "immutable_ticket_revision",
    version: "0.1",
    rule: "Tickets must never be silently mutated. Use immutable revisions (R1, R2, R3).",
    trigger: ["user_correction", "scope_change", "priority_shift", "deepen"],
    effect: "Create new revision, mark old ticket SUPERSEDED.",
  },
  "branch_worktree.yaml": {
    id: "BRANCH-001",
    name: "no_orphan_branch_or_worktree",
    version: "0.1",
    rule: "Every branch and worktree must have a ledger entry with case_id, ticket_id, reason_created, intended_scope, forbidden_scope, and exit_conditions.",
    forbidden: [
      "branch_without_case",
      "branch_without_ticket",
      "branch_without_intended_scope",
      "worktree_without_ledger_entry",
    ],
  },
  "docket.yaml": {
    id: "DOCKET-001",
    name: "docket_event_required",
    version: "0.1",
    rule: "Every governance state change must produce a docket event explaining why.",
    required_for: [
      "case_opened", "ticket_issued", "ticket_reissued",
      "ticket_paused", "ticket_resumed", "workstream_deepened",
      "branch_created", "execution_blocked",
    ],
  },
  "evidence.yaml": {
    id: "EVIDENCE-001",
    name: "tiered_evidence",
    version: "0.1",
    tiers: {
      "1": "user_statement",
      "2": ["tool_output", "test_result", "file_diff", "repo_state"],
      "3": "policy_document",
      "4": ["prior_decision", "precedent_reference"],
      "5": "simulation_result",
      "6": "model_inference",
    },
    rule: "Higher-tier evidence takes precedence. Model inference (Tier 6) is never sufficient for high-risk decisions.",
  },
  "human_review.yaml": {
    id: "HUMAN-001",
    name: "human_review_required",
    version: "0.1",
    required_for: [
      "policy_override",
      "destructive_action_in_production",
      "enterprise_policy_change",
      "precedent_overrule",
    ],
  },
  "tool_use.yaml": {
    id: "TOOL-001",
    name: "tool_call_governance",
    version: "0.1",
    rule: "All tool calls must be within the active ticket scope. Destructive actions require explicit authorization.",
    destructive_actions: ["rm -rf", "drop table", "truncate", "delete production data"],
  },
  "precedent.yaml": {
    id: "PRECEDENT-001",
    name: "precedent_lifecycle",
    version: "0.1",
    rule: "Precedents are created from case judgments and apply to future cases with matching conditions.",
    overridable_by: ["explicit_current_user_correction", "enterprise_policy_update", "new_case_judgment"],
  },
  "risk.yaml": {
    id: "RISK-001",
    name: "risk_simulation_threshold",
    version: "0.1",
    trigger_simulation_when: {
      ambiguity: ">= 0.50",
      scope_drift_probability: ">= 0.40",
      blast_radius: "high or critical",
    },
  },
  "authority.yaml": {
    id: "AUTHORITY-001",
    name: "authority_hierarchy",
    version: "0.1",
    hierarchy: [
      "external_law_and_regulation",
      "enterprise_constitution",
      "enterprise_statutes",
      "project_regulations",
      "current_explicit_user_instruction",
      "active_precedent",
      "prior_memory",
      "model_inference",
    ],
    rule: "Higher authority always overrides lower authority. Model inference cannot override user instruction or policy.",
  },
  "prevent_direct_main_commit.yaml": {
    id: "GIT-001",
    name: "prevent_direct_main_commit",
    version: "0.1",
    rule: "Do not commit directly to main or master branch. All changes must be done via a branch tied to a case/ticket, followed by a PR.",
    applies_to: { branches: ["main", "master"] },
    enforcement: {
      action: "block",
      message: "Direct commits to main/master are blocked by governance policy GIT-001. Create a branch using 'govctl branch create' first.",
    },
  },
  "infra_guard.yaml": {
    id: "INFRA-001",
    name: "infra_guard",
    version: "0.1",
    rule: "Editing infrastructure, deployment, or workflow files requires explicit confirmation and active ticket scope.",
    applies_to: {
      paths: [
        "infra/**",
        "deploy/**",
        ".github/workflows/**",
        "k8s/**",
        "docker-compose.yml",
      ],
    },
    enforcement: {
      action: "warn",
      message: "WARNING: You are editing infrastructure files. Ensure this matches the active ticket objective and has been verified.",
    },
  },
  "cost_limit.yaml": {
    id: "COST-001",
    name: "cost_limit",
    version: "0.1",
    rule: "Limit runaway loops and excessive tool usage in a single session.",
    thresholds: {
      max_tool_calls: 30,
      max_duration_seconds: 300,
    },
    enforcement: {
      action: "warn",
      message: "WARNING: Session has exceeded typical enterprise tool call or duration limits. Confirm with user to prevent runaway loops.",
    },
  },
  "prevent_secrets.yaml": {
    id: "SEC-001",
    name: "prevent_secrets",
    version: "0.1",
    rule: "Never write or commit API keys, secrets, private keys, or credentials.",
    blocked_patterns: [
      "AIzaSy[A-Za-z0-9_-]{33}",
      "sk-proj-[A-Za-z0-9_-]{48}",
      "-----BEGIN [A-Z ]+ PRIVATE KEY-----",
    ],
    enforcement: {
      action: "block",
      message: "Blocked: Detected potential secret or private key in written content. Secrets must never be committed to repository.",
    },
  },
};

const REGULATIONS: Record<string, Record<string, unknown>> = {
  "coding_agent.yaml": {
    id: "REG-AGENT-001",
    name: "coding_agent_policy",
    rules: [
      {
        id: "REG-AGENT-001-A",
        name: "no_action_without_active_ticket",
        rule: "Agent must not edit files or run commands without an active ticket.",
        exception: "Exploratory read-only operations (list, search, read) are permitted.",
      },
      {
        id: "REG-AGENT-001-B",
        name: "prefer_evidence_over_inference",
        rule: "Agent must cite evidence for design decisions. Model inference alone is insufficient for code changes.",
      },
    ],
  },
  "repo_policy.yaml": {
    id: "REG-REPO-001",
    name: "repository_change_policy",
    rules: [
      {
        id: "REG-REPO-001-A",
        name: "docs_changes_low_risk",
        applies_to: { paths: ["docs/**", ".governance/**", "*.md"] },
        risk_level: "low",
        required_review: "optional",
      },
      {
        id: "REG-REPO-001-B",
        name: "source_changes_medium_risk",
        applies_to: { paths: ["src/**", "packages/**", "lib/**"] },
        risk_level: "medium",
        required_review: "agent_self_check",
      },
      {
        id: "REG-REPO-001-C",
        name: "production_config_high_risk",
        applies_to: { paths: ["infra/**", "deploy/**", ".github/workflows/**", "k8s/**"] },
        risk_level: "high",
        required_review: "human",
      },
    ],
  },
  "production_change.yaml": {
    id: "REG-PROD-001",
    name: "production_change_policy",
    rule: "Production changes require: active ticket, human review, explicit authorization evidence.",
    applies_to: { environments: ["production", "prod", "live"] },
  },
};

const STARTER_PRECEDENTS: Record<string, Record<string, unknown>> = {
  "P-001-intent-governance-not-memory.yaml": {
    precedent_id: "P-001",
    case_id: "BOOTSTRAP",
    status: "active",
    issue: ["Should enterprise agent governance be a generic memory layer?"],
    holding: ["Enterprise agent governance must be intent governance, not generic memory."],
    material_facts: [
      "Generic memory has no authority hierarchy.",
      "Generic memory cannot distinguish correction from continuation.",
      "Intent governance separates case, ticket, evidence, and enforcement.",
    ],
    rule: [
      "Future architecture proposals must prioritize governance, evidence, tickets, cases, docket, and enforcement over generic memory.",
    ],
    applies_when: [
      "agent proposes memory-only architecture",
      "agent ignores ticket/case state",
      "agent ignores procedural history",
    ],
    overridable_by: [
      "explicit_current_user_correction",
      "enterprise_policy_update",
      "new_case_judgment",
    ],
    created_at: new Date().toISOString(),
  },
  "P-002-no-orphan-branch.yaml": {
    precedent_id: "P-002",
    case_id: "BOOTSTRAP",
    status: "active",
    issue: ["Can a branch exist without a governance ledger entry?"],
    holding: ["No branch or worktree may exist without a ledger entry."],
    material_facts: [
      "Git log records what changed, not why.",
      "Ledger records why the branch was created, its scope, and exit conditions.",
    ],
    rule: [
      "Every branch must have a case_id, ticket_id, reason_created, intended_scope, and exit_conditions.",
    ],
    applies_when: [
      "agent attempts to create a branch without govctl",
      "branch exists without case_id in ledger",
    ],
    overridable_by: ["enterprise_policy_update"],
    created_at: new Date().toISOString(),
  },
  "P-003-prompt-is-not-governance.yaml": {
    precedent_id: "P-003",
    case_id: "BOOTSTRAP",
    status: "active",
    issue: ["Are AGENTS.md and CLAUDE.md sufficient for governance?"],
    holding: ["Prompt files are not governance. Governance requires structured, enforceable state."],
    material_facts: [
      "Prompt files can be ignored or overridden by model inference.",
      "Governance requires hooks, state files, judgment engine, and audit trail.",
    ],
    rule: [
      "AGENTS.md and CLAUDE.md are summaries, not the governance system.",
      "Authoritative governance state lives in .governance/.",
    ],
    applies_when: [
      "agent treats AGENTS.md as the only governance source",
      "agent ignores .governance/ state",
    ],
    overridable_by: ["enterprise_policy_update"],
    created_at: new Date().toISOString(),
  },
  "P-004-model-is-not-the-court.yaml": {
    precedent_id: "P-004",
    case_id: "BOOTSTRAP",
    status: "active",
    issue: ["Can the model be the sole decision-maker for governance?"],
    holding: ["The model assists judgment. The governance runtime structures and enforces it."],
    material_facts: [
      "Model inference is Tier 6 evidence — lowest authority.",
      "Model cannot override policy, authorize destructive actions, or create precedent unilaterally.",
    ],
    rule: [
      "Model inference is advisory. Governance judgment is structural.",
    ],
    applies_when: [
      "agent attempts to override policy based on its own inference",
      "agent claims authority it does not have",
    ],
    overridable_by: ["enterprise_policy_update", "explicit_human_override"],
    created_at: new Date().toISOString(),
  },
};

const BRANCH_LEDGER_INITIAL = {
  branches: [],
};

const AGENTS_MD = `# Agent Governance Summary

This repository uses **AI Legal Governance Runtime**.

> Authoritative governance state lives in \`.governance/\`.
> This file is a human-readable summary — not the governance system.

## Core Rules

1. Do not execute outside the active case or ticket.
2. Do not silently expand scope.
3. Prefer evidence over model inference.
4. Treat current explicit user correction as higher authority than stale memory.
5. Destructive actions require explicit authorization.
6. Branches and worktrees must have governance ledger entries (\`govctl branch create\`).
7. If facts conflict, create a conflict record before acting.
8. If the current task is unclear, inspect current procedural posture before asking the user.
9. Do not revive superseded workstreams unless explicitly requested.
10. Completion means active ticket acceptance criteria are satisfied.

## Before Editing

- Read the injected **Procedural Context Pack** (injected by hooks at session start).
- Verify current case, ticket, branch, and worktree with \`govctl status\`.
- Check whether the target file path is within the allowed scope.

## If Blocked

- Explain the applied rule.
- Identify missing evidence or approval.
- Suggest ticket reissue, appeal, or human review.

## Quick Commands

\`\`\`
govctl status          # current case, ticket, branch, why
govctl why             # why this work exists
govctl timeline        # procedural history
govctl ticket list     # all tickets
govctl ticket reissue  # reissue a ticket
govctl evidence admit  # record a user statement as evidence
govctl branch create   # create a branch with ledger entry
\`\`\`
`;

const CLAUDE_MD = `# Claude Code Governance Summary

This project is governed by **AI Legal Governance Runtime**.

Claude should follow the Intent / Case / Ticket context injected by hooks.

## Important

- \`.governance/\` is authoritative. \`CLAUDE.md\` is a summary.
- Hooks may block actions outside the active ticket.
- Branch/worktree provenance is required (\`govctl branch create\` before \`git checkout -b\`).
- Docket events explain why work started, stopped, deepened, or branched.
- If user intent changes, create evidence and reissue ticket instead of silently mutating old state.

## Do Not

- Treat memory as final authority.
- Over-focus on guardrails; continuity and governance are primary.
- Modify production-impacting files without explicit authorization.
- Create branches or worktrees without ledger entries.
- Ignore the injected Procedural Context Pack.

## Evidence Priority

1. Current explicit user statement (highest)
2. Tool output / test result / file diff / repo state
3. Policy documents
4. Prior accepted decisions / precedents
5. Retrieved sources
6. Model inference (lowest — advisory only)
`;

const CLAUDE_SETTINGS: Record<string, unknown> = {
  permissions: {
    allow: [],
    deny: [],
  },
  hooks: {
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command: "govctl hook claude",
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: "govctl hook claude",
          },
        ],
      },
    ],
    PreToolUse: [
      {
        hooks: [
          {
            type: "command",
            command: "govctl hook claude",
          },
        ],
      },
    ],
    PostToolUse: [
      {
        hooks: [
          {
            type: "command",
            command: "govctl hook claude",
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: "govctl hook claude",
          },
        ],
      },
    ],
  },
};

const CODEX_HOOKS: Record<string, unknown> = {
  hooks: {
    exec: {
      command: "govctl hook codex",
      timeout: 10000,
    },
  },
};

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Bootstrap .governance/ structure in the current repository")
    .option("--cwd <path>", "Working directory", process.cwd())
    .option("--force", "Overwrite existing files", false)
    .action((opts: { cwd: string; force: boolean }) => {
      const cwd = path.resolve(opts.cwd);
      console.log(chalk.bold.cyan("\n⚖️  AI Legal Governance Runtime — init\n"));
      console.log(chalk.gray(`  Repository: ${cwd}\n`));

      // Create directories
      ensureGovernanceDirs(cwd);
      console.log(chalk.green("  ✓ Created .governance/ directory structure"));

      // Constitution
      writeYamlFile(govPath(cwd, "constitution.yaml"), CONSTITUTION);
      console.log(chalk.green("  ✓ constitution.yaml"));

      // Statutes
      for (const [filename, content] of Object.entries(STATUTES)) {
        writeYamlFile(govPath(cwd, "statutes", filename), content);
      }
      console.log(chalk.green("  ✓ statutes/ (10 statutes)"));

      // Regulations
      for (const [filename, content] of Object.entries(REGULATIONS)) {
        writeYamlFile(govPath(cwd, "regulations", filename), content);
      }
      console.log(chalk.green("  ✓ regulations/ (3 regulations)"));

      // Starter precedents
      for (const [filename, content] of Object.entries(STARTER_PRECEDENTS)) {
        writeYamlFile(govPath(cwd, "precedents", "active", filename), content);
      }
      console.log(chalk.green("  ✓ precedents/active/ (4 bootstrap precedents)"));

      // Empty JSONL files
      for (const p of [
        govPath(cwd, "evidence", "evidence.jsonl"),
        govPath(cwd, "docket", "docket_events.jsonl"),
        govPath(cwd, "audit", "events.jsonl"),
        govPath(cwd, "audit", "judgments.jsonl"),
        govPath(cwd, "audit", "tool_calls.jsonl"),
        govPath(cwd, "simulations", "risk_runs.jsonl"),
      ]) {
        touchJsonl(p);
      }
      console.log(chalk.green("  ✓ event log files (evidence, docket, audit)"));

      // Branch ledger
      writeYamlFile(
        govPath(cwd, "branches", "branch_ledger.yaml"),
        BRANCH_LEDGER_INITIAL
      );
      console.log(chalk.green("  ✓ branches/branch_ledger.yaml"));

      // AGENTS.md
      const agentsMdPath = path.join(cwd, "AGENTS.md");
      if (!fs.existsSync(agentsMdPath) || opts.force) {
        fs.writeFileSync(agentsMdPath, AGENTS_MD, "utf8");
        console.log(chalk.green("  ✓ AGENTS.md"));
      } else {
        console.log(chalk.yellow("  ~ AGENTS.md already exists (skipped, use --force to overwrite)"));
      }

      // CLAUDE.md
      const claudeMdPath = path.join(cwd, "CLAUDE.md");
      if (!fs.existsSync(claudeMdPath) || opts.force) {
        fs.writeFileSync(claudeMdPath, CLAUDE_MD, "utf8");
        console.log(chalk.green("  ✓ CLAUDE.md"));
      } else {
        console.log(chalk.yellow("  ~ CLAUDE.md already exists (skipped)"));
      }

      // .claude/settings.json
      const claudeDir = path.join(cwd, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      const claudeSettingsPath = path.join(claudeDir, "settings.json");
      if (!fs.existsSync(claudeSettingsPath) || opts.force) {
        fs.writeFileSync(
          claudeSettingsPath,
          JSON.stringify(CLAUDE_SETTINGS, null, 2),
          "utf8"
        );
        console.log(chalk.green("  ✓ .claude/settings.json"));
      } else {
        console.log(chalk.yellow("  ~ .claude/settings.json already exists (skipped)"));
      }

      // .codex/hooks.json
      const codexDir = path.join(cwd, ".codex");
      fs.mkdirSync(codexDir, { recursive: true });
      const codexHooksPath = path.join(codexDir, "hooks.json");
      if (!fs.existsSync(codexHooksPath) || opts.force) {
        fs.writeFileSync(
          codexHooksPath,
          JSON.stringify(CODEX_HOOKS, null, 2),
          "utf8"
        );
        console.log(chalk.green("  ✓ .codex/hooks.json"));
      } else {
        console.log(chalk.yellow("  ~ .codex/hooks.json already exists (skipped)"));
      }

      // Sync agent rules files (.cursorrules, .clinerules, copilot-instructions.md, CLAUDE.md)
      try {
        syncAgentRules(loadState(cwd));
        console.log(chalk.green("  ✓ Synced agent rules (.cursorrules, .clinerules, copilot-instructions.md, CLAUDE.md)"));
      } catch (err) {
        console.error("Failed to sync agent rules:", err);
      }

      console.log(chalk.bold.green("\n✓ Governance runtime initialized.\n"));
      console.log(chalk.gray("  Next steps:"));
      console.log(chalk.cyan("    govctl status          ") + chalk.gray("— view current posture"));
      console.log(chalk.cyan("    govctl case current    ") + chalk.gray("— view active case"));
      console.log(chalk.cyan("    govctl ticket list     ") + chalk.gray("— list tickets"));
      console.log(chalk.cyan("    govctl why             ") + chalk.gray("— why this work exists"));
      console.log("");
    });
}
