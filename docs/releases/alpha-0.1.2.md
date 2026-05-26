# GovRuntime alpha-0.1.2 Release Notes

Release version: `0.1.2-alpha`
Release channel: `alpha-0.1.2`

## Summary

`alpha-0.1.2` adds a minimal but executable governance layer for long-running agent work.

The core addition is the `gov` CLI. It creates case-scoped governance folders, records append-only events and stage ledgers, generates state/context/Linear projections, and blocks risky actions before they execute.

This release keeps GovRuntime's core stance: chat is not state, Linear is a proof ledger rather than an approval surface, and local governance files are a control plane, not model memory.

## New CLI

```bash
pnpm gov -- init --case pipeline3
pnpm gov -- status --case pipeline3
pnpm gov -- record-event --case pipeline3 --type validator_result --message "validator passed"
pnpm gov -- record-run --case pipeline3 --run run-001 --manifest manifest.json
pnpm gov -- record-stage --case pipeline3 --run run-001 --section intro --stage provider_raw_output --input prompt.md --output raw.md
pnpm gov -- finalize-run --case pipeline3 --run run-001 --artifact-hash <sha256>
pnpm gov -- check --case pipeline3 --before-tool review-submit --payload payload.json
pnpm gov -- close-gate --case pipeline3 --gate release_approval --approval approval.json
pnpm gov -- trace --case pipeline3 --run run-001 --section intro
pnpm gov -- sync-linear --case pipeline3
```

## Case State Shape

`gov init --case <case_id>` creates:

```text
.governance/
  cases/
    <case_id>/
      case.yaml
      decisions.yaml
      invariants.yaml
      gates.yaml
      events.jsonl
      state.generated.json
      context_pack.generated.md
      linear_packet.generated.md
      runs/
        <run_id>/
          manifest.json
          stage_ledger.jsonl
          artifacts.json
          validator_results.json
          review_packet.json
```

Generated files are projections and should be regenerated through `gov generate-state`.

Append-only files are the durable evidence streams:

- `events.jsonl`
- `runs/<run_id>/stage_ledger.jsonl`

## Blocking Rules

`gov check` can block:

- full-report repair
- GPT Pro review submission without fresh browser/profile evidence for `shareoblee001@gmail.com`
- release, deploy, payment, credential, secret, production write, or final-acceptance actions without a closed human gate
- review packets that submit stale or mismatched artifact hashes as fresh
- deterministic Korean prose replacement as a quality repair shortcut
- release-ready or accepted claims without validator/review evidence and a closed human gate

## Stage Lineage

`gov record-stage` writes redacted, hash-backed stage ledger rows. Supported stages include:

- `provider_raw_output`
- `repair_input`
- `repair_output`
- `normalization_before`
- `normalization_after`
- `trim_before`
- `trim_after`
- `assembly_before`
- `assembly_after`
- `final_markdown`
- `validator_result`
- `review_packet`
- `external_review_result`

`gov trace` can then answer where an issue was born across provider, repair, normalization, trim/assembly, final artifact, validator, and review packet stages.

## Gate Policy

`gates.yaml` now owns case-specific gate policy.

Required stage coverage is configurable:

```yaml
required_stage_coverage:
  per_final_section:
    - provider_raw_output
    - final_markdown
    - validator_result
```

Machine gates are also configurable:

```yaml
machine_gates:
  - id: validator_passed
    source_stage: validator_result
    evidence_level_required: L3
    artifact_hash_required: true
    pass_if:
      any:
        - field: validator_passed
          equals: true
        - field: issue_count
          equals: 0
```

Human gates require a signed `L5` approval artifact:

```json
{
  "case_id": "pipeline3",
  "gate_id": "release_approval",
  "approved_by": "human-operator",
  "signed_at": "2026-05-26T00:00:00.000Z",
  "statement": "Release approved for this governance case.",
  "evidence_level": "L5",
  "signature": "signed:release_approval:..."
}
```

## Validation

Release validation used:

```bash
pnpm --filter @govruntime/govctl build
pnpm --filter @govruntime/govctl test
pnpm typecheck
pnpm test
pnpm build
```

## Limitations

- Human approval signatures are structurally required but not cryptographically verified yet.
- Local append-only files remain local evidence. They are not immutable storage.
- `sync-linear` generates a packet only. It does not call the Linear API.
- Machine gate policy supports simple field comparisons and should stay intentionally small until real cases justify more expressiveness.
