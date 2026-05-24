# @govruntime/govctl

Command-line interface and hook adapter package for GovRuntime, the procedural governance runtime for AI coding agents.

This package exposes the `govctl` CLI:
*   `govctl init` — Bootstrap the governance repository structure.
*   `govctl status` — Show the active case, ticket, branch, and current rules posture.
*   `govctl why` — Explain why the current task is active.
*   `govctl timeline` — Print the chronological event log for the active case.
*   `govctl evidence admit` — Record explicit user statements or tool outputs as evidence.
*   `govctl ticket reissue` — Supersede an active ticket with a new revision (e.g. R1 -> R2).
*   `govctl hook <platform>` — Invoke agent-specific lifecycle hooks (e.g., `govctl hook claude`).
