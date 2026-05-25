# Contributing to GovRuntime

Thank you for your interest in contributing to GovRuntime.

GovRuntime is the open-source control plane for AI coding-agent governance. Contributions should preserve that positioning: this project governs agent execution; it does not try to become another agent framework.

## Developer Setup

GovRuntime is organized as a `pnpm` monorepo.

### Prerequisites

- Node.js 20 or newer
- pnpm 10 or newer

### Install

```bash
pnpm install
```

### Build

```bash
pnpm build
```

### Test

```bash
pnpm test
```

Tests run against built package output, so run `pnpm build` first when changing TypeScript sources.

## Contribution Principles

- Keep the core runtime platform-neutral.
- Put platform-specific behavior in adapters.
- Prefer explicit scope, evidence, and audit events over hidden inference.
- Keep `.governance/` state human-readable.
- Avoid turning GovRuntime into an agent orchestration framework.
- Treat destructive actions, secrets, publishing, and production enforcement as high-risk surfaces.

## Pull Request Checklist

Before opening a PR, please include:

- What changed
- Why it is needed
- Validation performed
- Any non-goals or deferred follow-ups
- Any compatibility impact on `.governance/` files or hook payloads

## Commit Style

Use concise conventional commits when practical:

```text
feat(runtime): add path literal validation
fix(adapter): normalize codex pre-tool payload
```
