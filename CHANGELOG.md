# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0-alpha.0] - 2026-05-24

### Added
*   Core runtime library `@govruntime/govd` including types, state loaders/writers, evidence registry, intent analyzer, conflict detector, and judgment engine.
*   CLI `@govruntime/govctl` supporting `init`, `status`, `why`, `timeline`, `evidence admit`, `ticket reissue`, `branch create`, and `case create`.
*   Lifecycle hook adapters for **Claude Code** and **Codex**.
*   Universal Rules Syncing supporting automatic context injection into `.cursorrules`, `.clinerules`, `.github/copilot-instructions.md`, and `CLAUDE.md`.
*   Standard preset templates for PR commit safety, infrastructure protection, runaway loops, and credential leak prevention.
*   Read-only MCP server `@govruntime/mcp-server` exposing posture, ticket, and why tools.
*   `examples/login-bugfix-scope-drift` demo case.
