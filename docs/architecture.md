# GovRuntime Architecture

This document describes the design and integration flow of GovRuntime components.

---

## Component Layout

GovRuntime consists of three main packages distributed in a monorepo:

### 1. `@govruntime/govd` (Core Runtime Library)
The engine of the system. Written in Node.js/TypeScript (ESM) with zero heavy external database dependencies (uses YAML/JSONL).
*   **State Loader & Writer**: Sync reads/writes workspace state in `.governance/`.
*   **Intent Analyzer**: Simple parsing to classify user requests (e.g. detect scope expansion).
*   **Conflict Detector**: Matches file paths against globs.
*   **Judgment Engine**: Applies configured statutes to proposed tool calls.
*   **Context Pack Renderer**: Generates the markdown context pack injected into prompts.

### 2. `@govruntime/govctl` (CLI & Hook Adapters)
The interaction layer.
*   Exposes commands to manage cases, tickets, and timelines.
*   Hosts the **Claude Code hook adapter** (`govctl hook claude`) and **Codex adapter** (`govctl hook codex`).
*   Adapters read standard JSON inputs from the host client's stdin, call `@govruntime/govd` handlers, and write response structures to stdout.

### 3. `@govruntime/mcp-server` (Read-only MCP server)
Exposes read-only tools so agents can query state directly using the Model Context Protocol:
*   `gov_current_posture` -> Context pack.
*   `gov_current_ticket` -> Active ticket.
*   `gov_why` -> Docket-derived explanation.

---

## Runtime execution Flow

```
+--------------------+                 +---------------------+                 +---------------+
|    Host Agent      |                 |     govctl CLI      |                 |  .governance  |
+---------+----------+                 +----------+----------+                 +-------+-------+
          |                                       |                                    |
          | 1. Hook Trigger (JSON stdin)          |                                    |
          +-------------------------------------->+                                    |
          |                                       | 2. loadState()                     |
          |                                       +----------------------------------->+
          |                                       |    Case, Ticket, Scope, Evidence   |
          |                                       |<-----------------------------------+
          |                                       |                                    |
          |                                       | 3. judge()                         |
          |                                       |    Evaluate policy rules           |
          |                                       |                                    |
          |                                       | 4. recordDocketEvent()             |
          |                                       +----------------------------------->+
          |                                       |                                    |
          | 5. Judgment Response (JSON stdout)    |                                    |
          |<--------------------------------------+                                    |
          |                                       |                                    |
```
*   **Minimal Overhead**: Sync file reads and JSON parsing execute in under 15ms.
*   **Git-Driven (GitOps)**: All state changes are committed as code, allowing human PR review of the agent's governance history.
