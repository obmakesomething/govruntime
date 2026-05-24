# GovRuntime

### Execution governance for coding agents.

GovRuntime keeps Claude Code, Codex, Cursor agents, and other tool-using coding agents inside the work they were actually authorized to do.

> [!IMPORTANT]
> **Guardrails decide whether a single input/output/tool call is safe.  
> GovRuntime decides whether the agent is still acting under the right case, ticket, scope, and evidence.**

---

## What is GovRuntime?
AI coding agents are highly autonomous, but they often suffer from **scope drift** and **context loss**. During multi-file executions, they can modify files outside their designated tasks, silently change ticket objectives, or treat their own reasoning as sufficient authority to override repository policies.

GovRuntime turns agent execution into an inspectable, ticket-scoped, evidence-backed process.

---

## How It Works
GovRuntime sits between the agent client and the repository filesystem, regulating tool execution. It evaluates whether each action is still authorized by:
*   An **active case** (the governed problem)
*   An **active ticket** (the authorized unit of work)
*   An **approved scope** (file paths and patterns)
*   An **evidence hierarchy** (authority-ranked facts)
*   A **docket timeline** (procedural event log)

---

## Quickstart

### 1. Install CLI
```bash
npm install -g @govruntime/govctl
```

### 2. Initialize in your repository
```bash
govctl init
```
This scaffolds the `.governance/` directory and creates default policies (presets) for:
*   **PR commit safety**: Blocks direct commits to `main`/`master`.
*   **Infrastructure protection**: Warns on changes to sensitive paths like `infra/`, `.github/workflows/`.
*   **Cost controls**: Prevents runaway tool loops.
*   **Secret leakage**: Blocks writing potential API keys.

It also automatically synchronizes rules with `.cursorrules`, `.clinerules`, `.github/copilot-instructions.md`, and `CLAUDE.md`.

### 3. Open a Case and Issue a Ticket
```bash
govctl case create --title "Fix auth timeout bug" --label AUTH-BUG
govctl ticket create --area AUTH --seq 101 --title "JWT Timeout" --objective "Increase JWT timeout to 3600s" --criteria "JWT expires in 3600s"
```

### 4. Create and Register a branch
```bash
govctl branch create --purpose "fix-jwt-timeout" --scope "src/auth/**"
git checkout -b gov/CASE-AUTH-BUG/T-AUTH-101-R1/fix-jwt-timeout
```

---

## CLI Reference

*   `govctl status` — Show the active case, ticket, branch, and current posture.
*   `govctl why` — Inspect the docket and explain why the current task is active.
*   `govctl timeline` — Print the chronological event log for the current case.
*   `govctl evidence admit` — Record explicit user confirmation or tool results as evidence.
*   `govctl ticket reissue` — Supersede an active ticket with a new revision (e.g. R1 -> R2).

---

## Architecture Overview

```
Agent / Claude Code / Cursor
        |
        | hooks
        v
GovRuntime hook adapter (govctl hook)
        |
        v
@govruntime/govd
        |
        | loads state, evaluates rules, records events
        v
.governance/
        |
        | exposes status
        v
govctl / read-only MCP server
```

---

## License
Apache 2.0
