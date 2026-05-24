# GovRuntime Hook Lifecycle

This document describes how GovRuntime integrates into AI coding agent lifecycles via JSON stdin/stdout hooks.

---

## Supported Lifecycle Events

Adapters (such as `govctl hook claude`) process five primary lifecycle events:

### 1. `SessionStart`
Triggered when the agent starts a new session.
*   **Action**: Loads the active case/ticket, generates the Procedural Context Pack, and writes it to stdout as a `context` injection.
*   **Result**: The agent receives active scopes and ticket criteria in its system prompt from turn one.

### 2. `UserPromptSubmit`
Triggered when the user submits a new prompt to the agent.
*   **Action**: Analyzes prompt intent. If the prompt requests a change or deepening of the task:
    *   Registers the prompt as Tier 1 evidence.
    *   Reissues the ticket (e.g. R1 -> R2) with the updated scope.
*   **Result**: Authorizations are updated automatically before tools run.

### 3. `PreToolUse`
Triggered immediately before the agent executes a tool (like writing a file or running a terminal command).
*   **Action**: Checks if the target path is within the active ticket/branch scope.
*   **Result**: Returns a `block` response if out-of-scope, or a `warn` advisory if high-risk.

### 4. `PostToolUse`
Triggered after a tool finishes running.
*   **Action**: Logs tool outcomes and admits results as Tier 2 evidence.

### 5. `Stop`
Triggered when the agent tries to exit or mark the task as complete.
*   **Action**: Evaluates docket events and ticket criteria.
*   **Result**: Advises continuation if acceptance criteria remain incomplete.
