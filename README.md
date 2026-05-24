# GovRuntime

### Execution governance for coding agents.

GovRuntime keeps Claude Code, Codex, Cursor agents, and other tool-using coding agents inside the work they were actually authorized to do.

Most guardrails ask:

> Is this input, output, or tool call safe?

GovRuntime asks:

> Is the agent still acting under the right case, ticket, approved scope, evidence hierarchy, and procedural history?

It gives every meaningful agent action a case, a ticket, a reason, a scope, an evidence basis, and an exit condition.

---

**Status: v0.1 alpha**
*GovRuntime is early infrastructure. It is suitable for experimentation, demos, and integration testing. It should not yet be marketed as tamper-proof, compliance-grade, or a replacement for secure sandboxing and human code review.*

---

## 1. What is GovRuntime?
GovRuntime is an **execution governance runtime** for software engineering agents (such as Claude Code, Codex, and Cursor). It acts as an external constraints layer that enforces ticket objectives, matches tool modifications against authorized scopes, and generates an auditable timeline. 

GovRuntime does not make agents more autonomous. It makes their autonomy governable.

---

## 2. The Core Idea
AI coding agents need more than prompt instructions. They need a stateful, runtime execution control plane. 

Instead of letting the agent operate as a stateless model that decides its own goals, GovRuntime implements a structured runtime:
*   Every task is bound to an **Active Case** and **Active Ticket**.
*   Every code branch must be registered with an **Approved File Scope**.
*   Agent actions are validated *prior* to tool use against executable rules.
*   Agent self-justification is treated as low-tier inference, not as authority.

---

## 3. Why Guardrails Are Not Enough
*   **Guardrails check single inputs/outputs**: A guardrail can detect if a response contains a secret or toxic word. It *cannot* detect if the agent is editing `infra/deploy.tf` when it was only assigned to fix a CSS bug.
*   **Guardrails lack state**: They evaluate each request in isolation. GovRuntime maintains a persistent state machine of the entire development session (Case → Ticket → Approved Scope → Branch -> Timeline).
*   **Prompts can instruct; GovRuntime checks**: Text files like `AGENTS.md` are passive guidance. Agents can ignore, forget, or override prompts. GovRuntime actively blocks or warns on unauthorized tool execution.

---

## 4. Quickstart

### Installation
Install the command line interface globally:
```bash
npm install -g @govruntime/govctl
```

### Initialize in your Repository
```bash
govctl init
```
This bootstraps the `.governance/` directory containing the default operating principles (constitution), rules (statutes), and event logs. It also generates `.claude/settings.json`, `.cursorrules`, `.clinerules`, and `.github/copilot-instructions.md` to ensure your editors are instantly synced.

### Open a Case and Issue a Ticket
```bash
# Open a case
govctl case create --title "Fix authorization timeout bug" --label AUTH-BUG

# Issue a ticket with exit criteria
govctl ticket create --area AUTH --seq 101 --title "JWT expiry config" --objective "Increase JWT expiry to 1 hour in auth handler" --criteria "JWT expires in 3600s"
```

### Create and Register a Branch
```bash
govctl branch create --purpose "fix-jwt" --scope "src/auth/**"
git checkout -b gov/CASE-AUTH-BUG/T-AUTH-101-R1/fix-jwt
```

---

## 5. Killer Demo: Blocking Scope Drift

### Scenario
A user asks a coding agent to fix a login bug.

1.  **User**: *"Fix the login bug."*
2.  **Agent**: Reads files under `src/auth/**`. (Allowed: inside scope).
3.  **Agent**: Edits `src/auth/login.ts`. (Allowed: inside scope).
4.  **Agent**: Attempts to write to `infra/deploy.tf` to update deployment scaling.
5.  **GovRuntime (PreToolUse Hook)**: **Blocked.**
    > *The active ticket is scoped to an auth bugfix.*  
    > *infra/deploy.tf is outside the approved scope.*  
    > *Infrastructure changes require explicit authorization.*
6.  **Agent**: *"I must edit deploy.tf to ensure the deploy matches."* (Agent tries to self-justify).
7.  **GovRuntime**: **Blocked.** (Agent reasoning is Tier 6 evidence and cannot override approved scope).
8.  **User**: *"I explicitly approve expanding the ticket to include infra/deploy.tf."*
9.  **GovRuntime**: Admits user quote as Tier 1 Evidence (User Confirmation), supersedes Ticket `R1` (SUPERSEDED), issues Ticket `R2` (Active) with expanded scope, and allows the write to `infra/deploy.tf`.

Running `govctl timeline` prints the complete, auditable sequence of the entire session.

---

## 6. Core Concepts
*   **Constitution**: Top-level operating principles.
*   **Statutes / Regulations**: Executable rules and runtime policies.
*   **Precedents**: Reusable prior decisions.
*   **Evidence**: Facts ranked by authority (Tier 1 User Quote down to Tier 6 Agent Inference).
*   **Docket**: The append-only procedural event log.
*   **Judgment**: The decision trace (Allow, Warn, Block).
*   **Case**: The governed problem.
*   **Ticket**: The authorized unit of work.
*   **Branch**: The execution context.
*   **Acceptance Criteria**: The exit condition.

---

## 7. Architecture

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

## 8. CLI Reference
*   `govctl init` — Bootstrap the governance repository structure.
*   `govctl status` — Show the active case, ticket, branch, and current rules posture.
*   `govctl why` — Inspect the docket and explain why the current task is active.
*   `govctl timeline` — Print the ordered chronological event log for the current case.
*   `govctl evidence admit` — Record explicit user statements or tool outputs as evidence.
*   `govctl ticket reissue` — Supersede an active ticket with a new revision (e.g. R1 -> R2) to adjust scope.

---

## 9. Hook Enforcement
GovRuntime integrates natively into agent lifecycles via the `govctl hook` subcommands:
*   `SessionStart`: Injects the **Procedural Context Pack** (active ticket and docket history) into the system prompt.
*   `UserPromptSubmit`: Analyzes prompts for intent changes, reissuing tickets when user commands pivot.
*   `PreToolUse`: Evaluates tool paths and arguments before they run.
*   `Stop`: Inspects the timeline to verify that the active ticket's exit conditions are met.

---

## 10. MCP Integration
GovRuntime is not MCP. MCP is an interface protocol, whereas GovRuntime is a governance runtime.

GovRuntime exposes its internal state through a read-only MCP server (`@govruntime/mcp-server`) with three tools:
*   `gov_current_posture` — Returns the rendered Procedural Context Pack.
*   `gov_current_ticket` — Returns the active ticket definition.
*   `gov_why` — Returns the docket-derived reason for the current task.

---

## 11. What GovRuntime Is Not
*   **GovRuntime is not MCP**: It can use MCP as an integration surface, but it is not a protocol itself.
*   **GovRuntime is not a generic guardrail**: It does not perform stateless input/output token filtering.
*   **GovRuntime is not an agent framework**: It does not orchestrate agents or manage planning loops.
*   **GovRuntime is not a prompt template system**: It dynamically checks and manages state on disk.
*   **GovRuntime does not guarantee safety**: It reduces operational risks (scope drift, context loss) but does not replace secure sandboxing.
*   **GovRuntime does not replace sandboxing, code review, secrets management, or human approval.**

---

## 12. Current Limitations
*   **Git-based Log Integrity**: Event log files (JSONL) are local and not cryptographically signed.
*   **Hook Support**: Hard-blocking tool execution relies on the host agent client (e.g., Claude Code settings) invoking the hook adapter.
*   **Advisory Mode in IDEs**: For tools like Cursor that do not expose lifecycle hooks, rule syncing is advisory (via rules files) rather than hard-blocked.
*   **Manual Policies**: Core statutes and scopes must still be configured in YAML config files.

---

## 13. Roadmap
*   **Tamper-Evident Docket**: SHA-256 hash chaining for all JSONL docket event files.
*   **Signed Judgments**: Cryptographic verification of allowed tool calls.
*   **CI/CD PR Auditor**: GitHub Action that compares PR file diffs against the docket timeline to ensure zero out-of-scope edits were committed.
*   **SIEM Export**: Log exporter for standard security information systems.
*   **Interactive Jury System**: Central approval dashboard for human reviewers to approve ticket reissues.

---

## 14. FAQ

#### Q: How does GovRuntime differ from Open Policy Agent (OPA)?
OPA determines if a static rule is violated. GovRuntime is specific to agent development workflows, tracking dynamic task states (tickets, cases, dockets, and evidence hierarchies) in the active code branch.

#### Q: Does GovRuntime slow down tool execution?
No. State parsing and evaluation are performed locally via fast YAML/JSONL parsing, typically executing in under 15ms.

#### Q: Can I use GovRuntime without Claude Code?
Yes. GovRuntime has a rules syncing engine (`syncAgentRules`) that writes to `.cursorrules`, `.clinerules`, and `.github/copilot-instructions.md` so that other AI tools (Cursor, Cline, Copilot) automatically receive the dynamic ticketing and scope posture.
