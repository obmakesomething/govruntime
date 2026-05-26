# GovRuntime

The open-source control plane for AI coding-agent governance.

Give Codex, Claude Code, Cursor, and future coding agents a shared runtime for scope control, evidence tracking, policy checks, and clean exits.

> Git tracks the diff. GovRuntime tracks the mandate.

Status: `0.1.2-alpha`

Release channel: `alpha-0.1.2`

License: Apache-2.0

## Why this exists

AI coding agents are powerful, but "the agent said it was done" is not a governance model.

GovRuntime answers the procedural questions that appear when agents start changing real repositories:

- What task is active?
- Which files are in scope?
- What evidence supports this change?
- Should this action warn or block?
- Is the repo clean enough to stop?

GovRuntime treats coding-agent execution as a lightweight governance system. It records scope, evidence, policy decisions, lifecycle posture, and exit checks in a local `.governance/` state directory.

## Not an agent framework

GovRuntime does not replace Codex, Claude Code, Cursor, OpenHands, LangChain, CrewAI, Mastra, or your own agent stack.

It sits beside them as a governance layer.

```text
Agent framework: does the work.
GovRuntime: governs how the work is authorized, scoped, checked, and recorded.
```

CI checks what changed. GovRuntime governs how the change happened.

## Packages

- `@govruntime/govd`: core governance engine. Loads `.governance/*`, judges tool use, records docket/audit events, validates path literals, and renders context packs.
- `@govruntime/govctl`: CLI and platform adapter layer. Provides `govctl` commands for repo posture and hook routing, plus the `gov` case runtime for long-running work governance.
- `@govruntime/mcp-server`: read-only MCP server for current posture, active ticket, and docket-derived why.

## Product Shape

Recommended integration is a three-layer shape:

1. Core control engine: `govd`
2. Platform adapters: `govctl hook auto`
3. Product surfaces: CLI, MCP, dashboards, CI hooks, and future SDKs

Claude, Codex, Cursor, and future clients should all route lifecycle events into the same normalized hook event schema. Platform-specific behavior stays in adapters; policy judgment stays in `govd`.

## Runtime Modes

GovRuntime supports two enforcement modes through `.governance/constitution.yaml`:

- `advisory`: warn and record evidence, but allow the host agent to continue.
- `hard-block`: promote risky warnings and stop-check failures into blocking hook responses.

Use:

```bash
govctl mode show
govctl mode set advisory
govctl mode set hard-block
```

`GOVRUNTIME_ENFORCEMENT_MODE=hard-block` can override local config for CI or production runs.

## Lifecycle Logs

Clean-state lifecycle events are recorded at:

```text
.governance/audit/clean_state.jsonl
```

The intended product lifecycle is:

```text
init -> run-task -> exit-check
```

Each event includes mode, product mode, active case/ticket identifiers when available, and whether the posture is clean.

## Path Literal Validation

GovRuntime validates path-like tool inputs and governance-document literals before treating them as reliable execution or evidence references.

Examples of checked keys include `file`, `file_path`, `filepath`, `filename`, `path`, `paths`, `target_file`, and `target_path`.

In advisory mode, unresolved read paths become warnings. In hard-block mode, warnings can become blocking decisions.

## Quick Start

```bash
pnpm install
pnpm build
pnpm govctl init
govctl mode show
govctl audit head
govctl audit verify
govctl audit checkpoint
govctl hook auto codex
govctl hook auto claude
```

`govctl init` wires Claude and Codex hooks to `govctl hook auto`, so products can switch adapters without changing the core governance engine.

## Long-Running Work Governance

`gov` is the minimal case-scoped control-plane CLI for long-running agent work. It is designed for cases where state can diverge across chat, repo, artifacts, Linear, browser/account context, provider calls, governance files, and latest user intent.

The source of truth is a case folder under:

```text
.governance/cases/<case_id>/
```

The flow is:

```text
append-only events
  -> generated governance state
  -> generated context pack
  -> pre-tool checks / validators / Linear packet
```

Useful commands:

```bash
pnpm gov -- init --case pipeline3
pnpm gov -- record-event --case pipeline3 --type validator_result --message "validator passed" --evidence validator#sha256:...
pnpm gov -- record-run --case pipeline3 --run run-001 --manifest run-manifest.json
pnpm gov -- record-stage --case pipeline3 --run run-001 --section intro --stage provider_raw_output --input prompt.md --output raw.md
pnpm gov -- finalize-run --case pipeline3 --run run-001 --artifact-hash <sha256>
pnpm gov -- check --case pipeline3 --before-tool review-submit --payload payload.json
pnpm gov -- close-gate --case pipeline3 --gate release_approval --approval approval.json
pnpm gov -- context-pack --case pipeline3
pnpm gov -- sync-linear --case pipeline3
```

`gov` creates generated files that should not be edited manually:

- `state.generated.json`
- `context_pack.generated.md`
- `linear_packet.generated.md`

It also keeps append-only evidence streams:

- `events.jsonl`
- `runs/<run_id>/stage_ledger.jsonl`

Current hard blocks include full-report repair, GPT Pro review without fresh profile evidence, human-gated release/deploy/payment/credential actions, stale artifact review packets, deterministic Korean prose replacement, and unsupported release-ready or acceptance claims.

Machine gates and required stage coverage are configurable in `gates.yaml`. Human gates require signed `L5` approval artifacts.

## Executable Architecture Decisions

GovRuntime can promote important user decisions from chat memory into executable repo-local governance state:

```text
user statement -> evidence -> decision -> invariant or precedent -> ticket acceptance criteria -> Linear packet -> context pack / hook check
```

Useful commands:

```bash
govctl evidence admit --quote "Reports must be generated section-by-section and assembled deterministically."
govctl decision record --title "Sectioned report generation boundary" --scope "src/lib/reporting/**"
govctl invariant create --name no-full-report-repair-in-sectioned-flow --decision DEC-...
govctl pack install sectioned-generation
govctl invariant check
govctl linear packet --issue OB-1833
```

Built-in packs include:

- `long-term-architecture-correctness`
- `sectioned-generation`
- `report-quality-stage-ledger`
- `linear-ops-standing-authorization`
- `chrome-profile-routing`

These packs are intentionally repo-local. The source of truth remains `.governance/`; skills and Markdown files are operator guidance, not authority.

## Policy Configuration

Builtin policy:

```yaml
engine: builtin
mode: enforce
```

OPA policy:

```yaml
engine: opa
entrypoint: data.govruntime.tool
mode: enforce
policy_dir: .governance/policies
data_dir: .governance/policy_data
```

Expected behavior:

- approved path: allow
- forbidden path: block
- outside intended scope: block unless explicit approval exists
- destructive command: block unless explicit authorization exists
- high-risk path: require human review, which blocks in enforce-mode hooks that do not represent review separately

## Audit Ledger

GovRuntime writes a local tamper-evident audit ledger at `.governance/audit/ledger.jsonl`.

This is not immutable storage. A malicious actor with filesystem access can delete or regenerate local logs. Stronger assurance requires signed checkpoints and external anchoring.

## Alpha Scope

`alpha-0.1.2` is intended for local experimentation, product-integration feedback, and case-scoped long-running work governance. It is not yet a stable hosted enforcement layer.

Included:

- `.governance` bootstrap templates
- runtime mode config
- Claude/Codex/generic hook normalization
- advisory and hard-block decisions
- clean-state JSONL audit trail
- path literal validation
- case-scoped `gov` CLI for long-running work
- generated context packs and Linear packets from append-only case evidence
- stage ledger tracing, configurable stage coverage, configurable machine gates, and signed human gate closure
- read-only MCP posture tools

Not yet stable:

- remote policy distribution
- hosted dashboard APIs
- signed audit logs
- signed human approval verification beyond local artifact structure
- full Cursor adapter contract
- production-grade schema migrations

## Development

```bash
pnpm build
pnpm test
```

Tests use Node's built-in test runner against built package output, so run `pnpm build` before package-level tests.

## Positioning

GovRuntime is best understood as:

```text
AI Agent Governance / Developer Tooling / Runtime Control Plane
```

It is adjacent to CI, policy-as-code, MCP, and agent observability, but its core identity is execution governance for coding agents.

## License

Apache-2.0. See `LICENSE`.
