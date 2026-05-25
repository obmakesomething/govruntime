# GovRuntime alpha-0.1.1 Release Notes

Release version: `0.1.1-alpha.0`  
Release date: 2026-05-25  
Channel: alpha

## Summary

`alpha-0.1.1` turns GovRuntime from a local governance prototype into a product-integration alpha. The release introduces a stable `@govruntime` namespace, a three-layer control-plane architecture, shared hook auto-routing, advisory vs hard-block enforcement modes, clean-state lifecycle logging, and path literal validation.

## What's new

- `@govruntime/govd` is the core control engine.
- `@govruntime/govctl` is the CLI and platform adapter package.
- `@govruntime/mcp-server` exposes read-only governance posture tools.
- `govctl hook auto [platform]` normalizes Claude, Codex, and generic payloads into one runtime event schema.
- `govctl mode show` and `govctl mode set advisory|hard-block` expose product-safe enforcement switching.
- `.governance/audit/clean_state.jsonl` records `init`, `run-task`, and `exit-check` lifecycle posture.
- Path literal validation checks tool input and document references before they are used as governance evidence or execution targets.

## Install and smoke test

```bash
pnpm install
pnpm build
pnpm test
pnpm govctl init
pnpm govctl mode show
```

## Compatibility notes

- Node.js 20 or newer is required.
- This is an alpha release. Local file-backed `.governance` state is the source of truth.
- Hard-block mode should be trialed in CI or isolated repositories before production rollout.
- MCP tools are read-only in this release.

## Known limitations

- No hosted dashboard API yet.
- No signed audit log chain yet.
- Cursor support should route through `generic` until a first-class adapter contract is added.
- Schema migration and upgrade tooling are not yet production-grade.

## Suggested Git tag

```bash
git tag -a alpha-0.1.1 -m "alpha-0.1.1: product integration control plane"
```

## Suggested GitHub release title

```text
GovRuntime alpha-0.1.1: product integration control plane
```

## Suggested GitHub release body

```markdown
GovRuntime alpha-0.1.1 introduces the product-integration control plane for AI coding-agent governance.

Highlights:
- unified @govruntime package namespace
- govd core engine, govctl platform adapters, and read-only MCP surface
- govctl hook auto for Claude, Codex, and generic event normalization
- advisory vs hard-block runtime modes
- clean-state lifecycle logs for init -> run-task -> exit-check
- path literal validation for tool inputs and governance documents
- Node test coverage for adapter normalization and .governance fixture validation

This is an alpha release for local experimentation and integration feedback. Hard-block mode should be trialed in isolated or CI environments before production use.
```
