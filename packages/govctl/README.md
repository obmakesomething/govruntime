# @govruntime/govctl

Command-line interface and hook adapter package for GovRuntime.

## Commands

### `govctl`

- `govctl init`: bootstrap `.governance/` and default hook wiring.
- `govctl status`: show active case, ticket, branch, and current posture.
- `govctl mode show`: show product and enforcement mode.
- `govctl mode set advisory|hard-block`: switch enforcement mode.
- `govctl hook auto [platform]`: normalize a Claude/Codex/generic hook payload and route it through `govd`.
- `govctl hook claude` and `govctl hook codex`: direct platform adapters.

Supported `hook auto` platforms are `claude`, `claude_code`, `codex`, and `generic`. If omitted, GovRuntime auto-detects the payload shape.

`govctl init` writes Claude and Codex hook config to use `govctl hook auto` by default.

### `gov`

`gov` is the small case-scoped CLI for long-running agent work where chat, repository, artifacts, Linear, browser/account, provider-call, governance, and latest user-intent state can diverge.

- `gov init --case <case_id>`: create `.governance/cases/<case_id>/` and default governance files.
- `gov status --case <case_id>`: print the generated case posture.
- `gov record-event --case <case_id> --type <type> --message <message> [--evidence <ref>]`: append one event to `events.jsonl`.
- `gov generate-state --case <case_id>`: regenerate `state.generated.json`, `context_pack.generated.md`, and `linear_packet.generated.md`.
- `gov context-pack --case <case_id>`: print the generated context pack, regenerating stale state first.
- `gov check --case <case_id> --before-tool <action> [--payload <json_file>]`: run pre-execution governance checks.
- `gov record-run --case <case_id> --run <run_id> --manifest <manifest_path>`: register a run manifest.
- `gov record-stage --case <case_id> --run <run_id> --section <section_id> --stage <stage_name>`: append a redacted, hash-backed stage ledger row.
- `gov finalize-run --case <case_id> --run <run_id> --artifact-hash <sha256>`: enforce configured stage coverage and close eligible machine gates.
- `gov trace --case <case_id> --run <run_id> --section <section_id>`: print section lineage from the stage ledger.
- `gov close-gate --case <case_id> --gate <gate_id> --approval <json_file>`: close a gate from evidence. Human gates require signed `L5` approval artifacts.
- `gov sync-linear --case <case_id>`: regenerate the Linear projection packet without requiring Linear API access.

`gov` generated files are projections, not source truth:

- `state.generated.json`
- `context_pack.generated.md`
- `linear_packet.generated.md`

Source truth remains append-only case evidence:

- `events.jsonl`
- `runs/<run_id>/stage_ledger.jsonl`

Default hard blocks include forbidden full-report repair, GPT Pro submission without fresh `shareoblee001@gmail.com` profile evidence, missing human gates, stale artifact review packets, deterministic Korean prose replacement, and unsupported success claims.
