# @govruntime/mcp-server

Read-only Model Context Protocol server for GovRuntime.

This package lets MCP-compatible products query repository governance posture without owning policy decisions or mutating `.governance/` state.

## Tools

- `gov_current_posture`: returns the rendered Procedural Context Pack.
- `gov_current_ticket`: returns the active ticket as structured JSON.
- `gov_why`: returns the docket-derived reason explaining why the current work is active.

## Build

```bash
pnpm build
```

## Run

```bash
node packages/mcp-server/dist/index.js
```

## Boundary

MCP is a read-only context surface in `alpha-0.1.2`.

Use `govctl hook auto` for enforcement decisions.
