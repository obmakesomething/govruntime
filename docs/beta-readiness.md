# GovRuntime Beta Readiness Checklist

This document tracks the work needed before promoting GovRuntime beyond `alpha-0.1.2`.

## Completed in the alpha-0.1.1 prep pass

- Removed temporary file-level TypeScript checking bypasses from restored TypeScript sources.
- Added adapter event normalization tests for Codex and Claude-shaped payloads.
- Added `.governance` fixture tests for runtime config loading and path literal validation.
- Replaced Jest-based package test scripts with Node built-in test scripts against built output.

## Completed in the alpha-0.1.2 pass

- Added the case-scoped `gov` CLI for long-running agent-work governance.
- Added generated state, context pack, and Linear packet projections from append-only case evidence.
- Added stage ledger recording, tracing, configurable stage coverage, and configurable machine gate rules.
- Added signed `L5` approval artifact requirements for human gate closure.
- Added smoke coverage for the new case runtime and gate behavior.

## Remaining beta gates

- Add first-class Cursor adapter contract instead of relying on `generic`.
- Add schema version checks for `.governance/constitution.yaml` and statute files.
- Add schema version checks for `.governance/cases/<case_id>/*.yaml`.
- Add upgrade/migration command for existing `.governance` folders.
- Add signed or hash-chained audit log option for production mode.
- Add cryptographic verification for signed human approval artifacts.
- Add CI matrix for Node 20 and current LTS.
- Add fixture coverage for stop-check hard-block behavior and branch ledger scope conflicts.
- Restore full strict-mode CLI typing where alpha recovery temporarily relaxes implicit-any checks.
- Add package publication dry run and npm provenance guidance.
