# Goal, Governance, and Linear Integration

This note captures the recommended integration pattern for long-running Codex goals.

## Shape

Use three layers together:

1. GovRuntime core
   - schema, CLI, MCP, hooks, context packs, invariant checks, audit/docket state
2. Repo-local `.governance/`
   - case, ticket, evidence, decisions, invariants, precedents, packs, Linear packets
3. Codex skills
   - operator workflow for `/goal`, governance, Linear supervision, subagents, and handoff

## Local Skills

Created local skills:

- `/Users/daeyounglee/.codex/skills/govruntime-governance/SKILL.md`
- `/Users/daeyounglee/.codex/skills/goal/SKILL.md`

The `goal` skill is the entrypoint for `/goal` or broad "finish this end-to-end" instructions. It explicitly requires:

- `govruntime-governance`
- `linear-subagent-supervision`

## GovRuntime Commands Added

Decision and invariant flow:

```bash
govctl decision record --title "..." --scope "..."
govctl decision list
govctl invariant create --name "..." --rule "..." --criteria "..."
govctl invariant list
govctl invariant explain <id-or-name>
govctl invariant check
```

Pack and Linear flow:

```bash
govctl pack list
govctl pack install sectioned-generation
govctl pack install report-quality-stage-ledger
govctl pack install linear-ops-standing-authorization
govctl linear packet --issue OB-1833
```

## Pipeline3 Case To Carry Forward

The first high-value pack is `sectioned-generation`.

It captures this invariant:

```text
Sectioned generation must not fall back to full-report repair after section generation.
Assembly failure may identify invalid sections.
Repair may call the model only for invalid sections.
Telemetry must record concrete section_id.
section_id=all repair is a release-blocking regression unless explicitly reauthorized.
```

This turns the user's architecture decision into executable governance rather than chat memory.

## Adjacent Thread Handoff

Use this packet in the main pipeline3 thread:

```md
Goal:
- Continue pipeline3 report quality stabilization under GovRuntime governance.

Governance:
- Install or mirror `sectioned-generation`, `report-quality-stage-ledger`, and `linear-ops-standing-authorization` packs.
- Record the sectioned generation decision as evidence, decision, invariant, and Linear acceptance criteria.

Linear:
- OB-1833 should bind to `INV-REPORT-SECTIONED-001`.
- Linear packet should include section-only repair acceptance criteria and proof-of-work.

Next action:
- Finish the Basic section allocation patch.
- Remove full-report Basic repair fallback.
- Update tests to assert section-only repair.
- Run live provider reruns from the operator-auth shell.
```
