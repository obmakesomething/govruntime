# GovRuntime Beta Readiness Checklist

This document tracks the work needed before promoting GovRuntime beyond `alpha-0.1.1`.

## Completed in the alpha-0.1.1 prep pass

- Removed temporary file-level TypeScript checking bypasses from restored TypeScript sources.
- Added adapter event normalization tests for Codex and Claude-shaped payloads.
- Added `.governance` fixture tests for runtime config loading and path literal validation.
- Replaced Jest-based package test scripts with Node built-in test scripts against built output.

## Remaining beta gates

- Add first-class Cursor adapter contract instead of relying on `generic`.
- Add schema version checks for `.governance/constitution.yaml` and statute files.
- Add upgrade/migration command for existing `.governance` folders.
- Add signed or hash-chained audit log option for production mode.
- Add CI matrix for Node 20 and current LTS.
- Add fixture coverage for stop-check hard-block behavior and branch ledger scope conflicts.
- Restore full strict-mode CLI typing where alpha recovery temporarily relaxes implicit-any checks.
- Add package publication dry run and npm provenance guidance.
