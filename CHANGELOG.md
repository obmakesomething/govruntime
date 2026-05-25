# Changelog

All notable changes to GovRuntime are documented here.

## [0.1.2-alpha.0] - 2026-05-25

### Added

- Added executable architecture decisions and invariants as first-class governance records.
- Added `govctl decision record|list`.
- Added `govctl invariant create|list|explain|check`.
- Added built-in governance packs for long-term architecture correctness, sectioned generation, report stage ledgers, Linear standing authorization, and Chrome profile routing.
- Added `govctl pack list|install`.
- Added `govctl linear packet` to generate Linear-ready acceptance criteria and proof-of-work packets from active governance state.
- Added active decisions and invariants to the Procedural Context Pack.
- Added goal/governance/Linear integration documentation.

### Changed

- Updated README quick-start guidance with the executable architecture decision flow.
- Extended repo-local `.governance/` bootstrap directories for decisions, invariants, exceptions, Linear packets, and governance skills.

## [0.1.1-alpha.0] - 2026-05-25

### Added

- Added the public `@govruntime` package namespace across `govd`, `govctl`, and `mcp-server`.
- Added runtime product config with `development` / `production` product modes and `advisory` / `hard-block` enforcement modes.
- Added `govctl mode show` and `govctl mode set advisory|hard-block`.
- Added `govctl hook auto [platform]` as the shared adapter entrypoint for Claude, Codex, and generic hook payloads.
- Added clean-state lifecycle logging for `init -> run-task -> exit-check` in `.governance/audit/clean_state.jsonl`.
- Added document/tool-input path literal validation in `@govruntime/govd`.
- Added `PATH-001` governance statute to the init template.
- Added release notes and tag-message draft for `alpha-0.1.1`.
- Added Node test coverage for adapter event normalization and `.governance` fixture path validation.

### Changed

- Updated README and architecture docs for the product-ready control-plane architecture.
- Updated default hook wiring from platform-specific direct hooks to `govctl hook auto`.
- Updated stop checks so `hard-block` mode can block incomplete exits.
- Updated package metadata to version `0.1.1-alpha.0`.

### Fixed

- Recovered corrupted source/doc surfaces from clean build artifacts where possible.
- Removed legacy pre-alpha naming from package and documentation surfaces.
- Removed temporary file-level TypeScript checking bypasses from restored TypeScript sources.

## [0.1.0-alpha.0] - 2026-05-24

### Added

- Initial core runtime, CLI, lifecycle hooks, MCP read-only surface, governance templates, branch/case/ticket/evidence commands, docket logs, and context-pack rendering.
