# Security Policy

## Reporting a Vulnerability

We take the security of GovRuntime seriously. Please do not report security vulnerabilities in the public issue tracker.

Preferred reporting paths:

- Open a private security advisory on GitHub.
- If a private advisory is not available, contact the maintainers through the repository owner profile.

Please include:

- Detailed steps to reproduce the vulnerability.
- A proof-of-concept script, payload, or execution timeline when safe to share.
- The affected GovRuntime version.
- The agent host involved, such as Codex, Claude Code, Cursor, or a custom adapter.
- Relevant `.governance/` configuration, with secrets removed.
- Whether the issue affects advisory mode, hard-block mode, MCP tools, or package publication.

## Scope

Security-sensitive areas include:

- hook adapter input/output handling
- command execution boundaries
- path literal validation
- `.governance/` state mutation
- audit log integrity
- MCP tool exposure
- package release workflows
- secrets or credential handling

## Safety Expectations

Do not include real secrets, private keys, tokens, browser session dumps, or private customer data in reports. Redacted fixtures are strongly preferred.

GovRuntime is currently alpha software. Hard-block mode should be trialed in isolated repositories or CI before production use.
