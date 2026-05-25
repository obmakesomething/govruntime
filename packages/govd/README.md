# @govruntime/govd

Core governance engine for GovRuntime.

`govd` owns policy judgment and `.governance/` state. It is intentionally platform-neutral: Claude, Codex, Cursor, MCP clients, and future products should all call into the same core runtime instead of re-implementing governance decisions.

## Responsibilities

- Load `.governance/` YAML and JSONL state.
- Resolve active case, ticket, branch, statutes, regulations, and precedents.
- Judge tool calls as allow, warn, require human review, or block.
- Validate document and tool-input path literals.
- Record docket, audit, judgment, evidence, simulation, and clean-state events.
- Render the Procedural Context Pack for agent prompt injection.

## Public APIs

Common entrypoints include:

```ts
loadState(cwd)
judgeToolCall(event, state)
handlePreToolUse(event, state)
handleStop(event, state)
validateHookPathLiterals(event, state)
validateDocumentPathLiterals(markdown, state)
renderContextPack(state)
```

## Design Boundary

`govd` is not an agent framework and does not own platform-specific hook protocols.

Platform-specific behavior belongs in `@govruntime/govctl` adapters. Governance decisions belong here.
