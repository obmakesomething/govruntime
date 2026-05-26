# Model Context Protocol (MCP) Integration

MCP is an integration surface for GovRuntime, not the product identity.

GovRuntime is the execution governance control plane. The MCP server exposes read-only governance posture so compatible agents and products can inspect current scope, ticket state, and docket-derived reasoning.

## Package

```text
@govruntime/mcp-server
```

## Available Tools

### `gov_current_posture`

Returns the rendered Procedural Context Pack in Markdown format.

Includes:

- active case details
- active ticket objective and acceptance criteria
- current branch and allowed file scope
- recent docket history
- next expected action

### `gov_current_ticket`

Returns the active ticket as structured JSON.

Useful for products or agents that need machine-readable objective, acceptance criteria, non-goals, risk profile, and verification plan.

### `gov_why`

Returns a docket-derived explanation of why the current work exists.

This is built from procedural events, not model inference.

## Claude Code Example

After building the repo, add the MCP server to Claude Code with a path to the built package:

```bash
claude mcp add govruntime node /path/to/govruntime/packages/mcp-server/dist/index.js
```

## Product Guidance

Use MCP when the agent needs to query governance state during execution.

Use lifecycle hooks when the product needs enforcement decisions such as allow, warn, or block.

Recommended shape:

```text
hooks: enforcement path
MCP: read-only context path
.govruntime/.governance files: source of procedural truth
```
