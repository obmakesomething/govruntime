# Tamper-Evident Audit Ledger

GovRuntime writes a local tamper-evident audit ledger in addition to compatibility JSONL logs.

Files:

```text
.governance/audit/ledger.jsonl
.governance/audit/head.json
.governance/audit/checkpoints/
```

## What this provides

Each ledger line is an audit envelope with:

- a monotonically increasing `seq`
- `prev_hash` linking to the previous entry
- `payload_hash` over canonical JSON payload
- `entry_hash` over the unsigned envelope
- stream name such as `judgment`, `tool_call`, `policy_decision`, or `audit_event`

Hash format:

```text
sha256:<hex>
```

## What this does not provide

The local ledger is tamper-evident, not tamper-proof.

A malicious actor with filesystem access can delete, truncate, or regenerate local logs. GovRuntime can detect many accidental or unsophisticated modifications when `govctl audit verify` is run, but local files alone are not enterprise-grade integrity.

Stronger assurance requires signed checkpoints and external anchoring. GovRuntime includes extension points for anchoring providers, but `alpha-0.1.1` does not fake signatures or claim immutable storage.

## Commands

```bash
govctl audit head
govctl audit verify
govctl audit inspect --seq 1
govctl audit checkpoint
```

`govctl audit checkpoint` writes:

```text
.governance/audit/checkpoints/checkpoint-<seq>.json
```

The `signature` field is `null` unless signing is configured in a future extension.

## Failure interpretation

Verification failures report:

- first invalid sequence
- stream
- record id
- reason
- expected value
- actual value
- interpretation

Common causes:

- payload changed: payload hash mismatch
- line deleted: sequence or head mismatch
- line reordered: sequence or previous-hash mismatch
- head edited: head sequence/hash mismatch
