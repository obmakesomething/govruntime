# @govruntime/mcp-server

Read-only Model Context Protocol (MCP) server for GovRuntime.

This server allows AI agents supporting the MCP standard to query the governance posture of the repository.

### Available Tools
*   `gov_current_posture` — Returns the rendered dynamic markdown context pack.
*   `gov_current_ticket` — Returns the YAML definition of the active ticket.
*   `gov_why` — Returns the docket-derived reason explaining why this work is active.
