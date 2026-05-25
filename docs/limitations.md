# Limitations

GovRuntime is alpha software.

## Local audit ledger

The local audit ledger is tamper-evident, not tamper-proof.

A malicious actor with filesystem access can delete, truncate, or regenerate local logs. `govctl audit verify` can detect broken hash chains, payload edits, reordered entries, deleted lines, and head mismatches, but local files alone are not immutable evidence.

Enterprise-grade integrity requires signed checkpoints and external anchoring. GovRuntime currently writes unsigned checkpoints with `signature: null` and exposes provider interfaces for future anchoring.

## Policy enforcement

The built-in policy engine is pragmatic and local. It extracts paths and destructive signals using heuristics. It is materially stronger than keyword-only detection, but it is not a full shell parser.

OPA support uses the local OPA CLI. If OPA is missing, enforce mode fails closed and advisory mode falls back to the built-in engine with a warning.

## Host guarantees

GovRuntime can only enforce as strongly as the host agent hook protocol allows.

Codex and Claude Code hooks can block in supported hook phases. Cursor or other hosts with weaker lifecycle guarantees may remain advisory until they provide reliable enforcement hooks.

## Compliance

GovRuntime does not claim legal compliance, immutable logging, or enterprise-grade non-repudiation in this alpha release.
