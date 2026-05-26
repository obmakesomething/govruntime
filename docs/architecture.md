# GovRuntime Architecture

GovRuntime is a control plane for AI coding agents. It is designed to attach to products without making the agent runtime itself the source of policy truth.

## Layers

1. Core control engine: `@govruntime/govd`
2. Platform adapters: `@govruntime/govctl` and `govctl hook auto`
3. Product surfaces: CLI, MCP, dashboards, CI hooks, and future SDKs

## Core Engine

`govd` owns governance state and judgment:

- loads `.governance/*` state
- resolves active case, ticket, and branch ledger context
- evaluates hook events against constitution, statutes, regulations, and precedents
- validates document and tool-input path literals
- writes docket, audit, judgment, tool-call, evidence, simulation, and clean-state logs

The engine does not know whether the caller is Claude, Codex, Cursor, or another product.

## Platform Adapters

`govctl hook auto [platform]` normalizes lifecycle payloads into one event schema:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `Stop`

Adapters translate host-specific input/output conventions. They do not own policy.

## Product Modes

Runtime config lives in `.governance/constitution.yaml` under `runtime`.

- `product_mode: development` defaults to human-friendly iteration.
- `product_mode: production` is for stricter hosted or CI use.
- `enforcement_mode: advisory` records warnings and continues.
- `enforcement_mode: hard-block` turns warnings, human-review requirements, and stop-check failures into blocking decisions.

The environment variable `GOVRUNTIME_ENFORCEMENT_MODE` can override config for deployment.

## Clean-State Log

Lifecycle posture is recorded in:

```text
.governance/audit/clean_state.jsonl
```

The expected sequence is:

```text
init -> run-task -> exit-check
```

This gives products a simple audit stream for whether work began, ran, and exited with a clean governance posture.

## Path Literal Validation

GovRuntime includes a document-literal and tool-input path validation pipeline.

The first product-facing use is in `PreToolUse`. Path-like fields such as `file_path`, `path`, `target_file`, and `paths` are normalized against the repository root. Invalid paths become errors. Missing read targets become warnings in advisory mode and blocks in hard-block mode.

The reusable API is exported from `@govruntime/govd`:

```ts
validateHookPathLiterals(event, state)
validateDocumentPathLiterals(markdown, state)
```
