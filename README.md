# GovRuntime

The open-source control plane for AI coding-agent governance.

Give Codex, Claude Code, Cursor, and future coding agents a shared runtime for scope control, evidence tracking, policy checks, and clean exits.

> Git tracks the diff. GovRuntime tracks the mandate.

Status: `0.1.3-alpha`

Release channel: `alpha-0.1.3`

License: Apache-2.0

---

## What's New in `v0.1.3-alpha`

The `0.1.3-alpha` release introduces production-grade ID persistence, workflow recovery, and enhanced diagnostics for multi-process agent environments:

- **Persistent Collision-Safe Entity Allocation** (`PR #1`, `PR #2`): Disk-backed sequence reservation (`.governance/state/id_store`) guarantees unique, deterministic, and sortable entity IDs (`EV-*`, `CASE-*`, `DCK-*`, `JDG-*`, `DEC-*`, `INV-*`) even across parallel CLI invocations and concurrent agent sub-processes.
- **Recoverable Branch Abandonment** (`PR #7`): Clean recovery and state cleanup in `govctl` when git branches or agent tasks are abandoned.
- **Opt-In Source Tracing Overhead** (`PR #6`): Tracing overhead is now opt-in, protecting performance during intensive agent execution passes while retaining diagnostic capabilities when needed.
- **Loader-Pass Source Diagnostics & Legacy Recovery** (`PR #3`, `PR #4`, `PR #5`): Diagnoses malformed historical records during loader passes, recovers legacy state diagnostics, and normalizes timestamp selection deterministically.

---

## Why this exists

AI coding agents are powerful, but "the agent said it was done" is not a governance model.

GovRuntime answers the procedural questions that appear when agents start changing real repositories:

- What task is active?
- Which files are in scope?
- What evidence supports this change?
- Should this action warn or block?
- Is the repo clean enough to stop?

GovRuntime treats coding-agent execution as a lightweight governance system. It records scope, evidence, policy decisions, lifecycle posture, and exit checks in a local `.governance/` state directory.

---

## Not an agent framework

GovRuntime does not replace Codex, Claude Code, Cursor, OpenHands, LangChain, CrewAI, Mastra, or your own agent stack.

It sits beside them as a governance layer.

```text
Agent framework: does the work.
GovRuntime: governs how the work is authorized, scoped, checked, and recorded.
```

CI checks what changed. GovRuntime governs how the change happened.

---

## Packages

- **`@govruntime/govd`**: Core governance engine. Loads `.governance/*`, judges tool use, manages persistent collision-safe entity sequences, records docket/audit events, validates path literals, and renders context packs.
- **`@govruntime/govctl`**: CLI and platform adapter layer. Provides `govctl` commands for repo posture, branch abandon recovery, and hook routing, plus the `gov` case runtime for long-running work governance.
- **`@govruntime/mcp-server`**: Read-only Model Context Protocol (MCP) server exposing current posture, active tickets, and docket-derived reasoning to AI models.

---

## Product Architecture

Integration uses a decoupled three-layer architecture:

```text
+-------------------------------------------------------------+
|   Product Surfaces (CLI, MCP, Dashboards, CI Hooks, SDKs)   |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|    Platform Adapters (`govctl hook auto claude | codex`)     |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|       Core Control Engine (`@govruntime/govd` + OPA)        |
+-------------------------------------------------------------+
```

Claude Code, Codex, Cursor, and future clients all route lifecycle events into the same normalized hook event schema. Platform-specific behavior stays in adapters; policy judgment stays in `govd`.

---

## Enforcement Modes

GovRuntime supports two enforcement modes configured in `.governance/constitution.yaml`:

- **`advisory`**: Warns and records evidence, but allows the host agent to continue.
- **`hard-block`**: Promotes risky warnings and stop-check failures into blocking hook responses.

CLI commands:

```bash
govctl mode show
govctl mode set advisory
govctl mode set hard-block
```

Environment override for CI or automated pipelines:

```bash
export GOVRUNTIME_ENFORCEMENT_MODE=hard-block
```

---

## Quick Start

```bash
# Install & build
pnpm install
pnpm build

# Initialize governance repository
pnpm govctl init

# Check & set enforcement posture
govctl mode show
govctl audit head
govctl audit verify
govctl audit checkpoint

# Wire hooks for Claude Code and Codex
govctl hook auto codex
govctl hook auto claude
```

---

## Long-Running Work Governance (`gov` CLI)

`gov` is the case-scoped control-plane CLI for long-running agent work. It ensures state integrity when work spans chat memory, code diffs, review artifacts, Linear tickets, external APIs, and governance files.

The source of truth is a case directory:

```text
.governance/cases/<case_id>/
```

### Complete `gov` Lifecycle Flow

```text
append-only events
  -> generated governance state (`state.generated.json`)
  -> generated context pack (`context_pack.generated.md`)
  -> pre-tool checks / validators / Linear packets
```

### Command Reference

```bash
# Case initialization
pnpm gov -- init --case pipeline3

# Evidence & run tracking
pnpm gov -- record-event --case pipeline3 --type validator_result --message "validator passed" --evidence validator#sha256:...
pnpm gov -- record-run --case pipeline3 --run run-001 --manifest run-manifest.json
pnpm gov -- record-stage --case pipeline3 --run run-001 --section intro --stage provider_raw_output --input prompt.md --output raw.md
pnpm gov -- finalize-run --case pipeline3 --run run-001 --artifact-hash <sha256>

# Policy enforcement & gate closure
pnpm gov -- check --case pipeline3 --before-tool review-submit --payload payload.json
pnpm gov -- close-gate --case pipeline3 --gate release_approval --approval approval.json

# Context & integration output
pnpm gov -- context-pack --case pipeline3
pnpm gov -- sync-linear --case pipeline3
```

### Generated Files & Audit Streams

Do **not** edit generated artifacts directly:
- `state.generated.json`
- `context_pack.generated.md`
- `linear_packet.generated.md`

Append-only audit streams:
- `.governance/cases/<case_id>/events.jsonl`
- `.governance/cases/<case_id>/runs/<run_id>/stage_ledger.jsonl`

---

## Executable Architecture Decisions

GovRuntime promotes user decisions from conversation memory into executable repository-local governance state:

```text
User statement 
  -> Evidence (`EV-*`) 
  -> Decision (`DEC-*`) 
  -> Invariant (`INV-*`) or Precedent (`P-*`) 
  -> Ticket acceptance criteria 
  -> Linear packet 
  -> Context pack / Hook check
```

### Command Reference

```bash
# Record evidence and architectural decisions
govctl evidence admit --quote "Reports must be generated section-by-section and assembled deterministically."
govctl decision record --title "Sectioned report generation boundary" --scope "src/lib/reporting/**"
govctl invariant create --name no-full-report-repair-in-sectioned-flow --decision DEC-2026-07-22-001

# Preset packs & invariant checks
govctl pack install sectioned-generation
govctl invariant check
govctl linear packet --issue OB-1833
```

### Built-in Rule Packs

- `long-term-architecture-correctness`
- `sectioned-generation`
- `report-quality-stage-ledger`
- `linear-ops-standing-authorization`
- `chrome-profile-routing`

---

## Policy Configuration (Policy-as-Code)

### Built-in Policy Engine

```yaml
engine: builtin
mode: enforce
```

### Open Policy Agent (OPA) Integration

```yaml
engine: opa
entrypoint: data.govruntime.tool
mode: enforce
policy_dir: .governance/policies
data_dir: .governance/policy_data
```

---

## Path Literal Validation

GovRuntime validates path-like tool inputs and governance-document literals before treating them as execution or evidence targets.

Checked property keys include: `file`, `file_path`, `filepath`, `filename`, `path`, `paths`, `target_file`, and `target_path`.

Unresolved paths trigger warnings in `advisory` mode and hard blocks in `hard-block` mode.

---

## Audit Ledger & Tamper Evidence

GovRuntime maintains a local tamper-evident audit ledger:

```text
.governance/audit/ledger.jsonl
.governance/audit/clean_state.jsonl
```

The audit trail tracks process mode, active case/ticket IDs, and posture cleanliness for every agent lifecycle event (`init -> run-task -> exit-check`).

---

## Alpha Scope & Stability Matrix

| Feature Category | Status in `0.1.3-alpha` |
|---|---|
| Persistent Collision-Safe IDs | **Stable** (`id_store` disk allocation) |
| Claude & Codex Hook Adapters | **Stable** (`govctl hook auto`) |
| Advisory & Hard-Block Enforcement | **Stable** (`GOVRUNTIME_ENFORCEMENT_MODE`) |
| Case-Scoped `gov` Runtime | **Stable** (Stage ledger & gate closure) |
| Recoverable Branch Abandonment | **Stable** (`govctl` workflow recovery) |
| Read-Only MCP Server | **Beta** (`@govruntime/mcp-server`) |
| Remote Policy Distribution | *In Progress* |
| Hosted Dashboard APIs | *In Progress* |

---

## Development & Testing

```bash
# Build all workspace packages
pnpm build

# Run unit and integration tests across workspace
pnpm test

# Typecheck workspace TypeScript sources
pnpm typecheck
```

---

## License

Apache-2.0. See `LICENSE` for details.
