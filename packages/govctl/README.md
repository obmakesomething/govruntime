# @govruntime/govctl

Command-line interface and hook adapter package for GovRuntime.

## Commands

- `govctl init`: bootstrap `.governance/` and default hook wiring.
- `govctl status`: show active case, ticket, branch, and current posture.
- `govctl mode show`: show product and enforcement mode.
- `govctl mode set advisory|hard-block`: switch enforcement mode.
- `govctl hook auto [platform]`: normalize a Claude/Codex/generic hook payload and route it through `govd`.
- `govctl hook claude` and `govctl hook codex`: direct platform adapters.

Supported `hook auto` platforms are `claude`, `claude_code`, `codex`, and `generic`. If omitted, GovRuntime auto-detects the payload shape.

`govctl init` writes Claude and Codex hook config to use `govctl hook auto` by default.
