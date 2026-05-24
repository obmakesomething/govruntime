# Model Context Protocol (MCP) Integration

This document outlines how GovRuntime integrates with and utilizes the Model Context Protocol.

---

## MCP is an Integration Surface, Not the Identity

GovRuntime is not an MCP server itself; MCP is simply one interface it provides. GovRuntime's core engine evaluates execution scopes, manages tickets, and enforces runtime hooks.

Exposing this state via an MCP server allows agents to actively query their constraints during tool execution.

---

## `@govruntime/mcp-server`

The server provides three read-only tools:

### 1. `gov_current_posture`
Returns the rendered **Procedural Context Pack** in Markdown format. This contains:
*   Active case details.
*   Active ticket objectives and acceptance criteria.
*   The current branch and its allowed file scope.
*   Recent docket history events.
*   The next expected action.

### 2. `gov_current_ticket`
Returns the complete YAML structure of the active ticket. Useful for agents that parse structured goals.

### 3. `gov_why`
Returns the docket-derived origin and evolution of the current work stream, helping the agent understand *why* it is being asked to run a task.

---

## Configuration in Claude Code

To add GovRuntime's MCP server to Claude Code, edit your global settings file or add it using:
```bash
claude mcp add govruntime node /path/to/govruntime/packages/mcp-server/dist/index.js
```
This allows Claude Code to fetch the governance posture dynamically.
