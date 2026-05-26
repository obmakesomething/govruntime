/**
 * AI Legal Governance Runtime — MCP Server
 *
 * Phase 1: Read-only tools
 *   - gov_current_posture   → Procedural Context Pack (markdown)
 *   - gov_current_ticket    → Active ticket details
 *   - gov_why               → Docket-derived explanation
 *
 * Phase 4+: Full read/write/judgment API
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { loadState, renderContextPack, readJsonlFile, govPath, } from "@govruntime/govd";
import path from "node:path";
// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const TOOLS = [
    {
        name: "gov_current_posture",
        description: "Returns the current Procedural Context Pack — a markdown summary of the active case, ticket, branch, why this work exists, paused workstreams, and next expected action. This is the primary governance state query for AI agents.",
        inputSchema: {
            type: "object",
            properties: {
                cwd: {
                    type: "string",
                    description: "Repository working directory (defaults to process.cwd())",
                },
            },
        },
    },
    {
        name: "gov_current_ticket",
        description: "Returns the active ticket as a structured JSON object. Includes ticket_id, revision, status, workstream_status, title, objective, acceptance_criteria, non_goals, risk_profile, and reason_for_reissue.",
        inputSchema: {
            type: "object",
            properties: {
                cwd: {
                    type: "string",
                    description: "Repository working directory",
                },
            },
        },
    },
    {
        name: "gov_why",
        description: "Returns a docket-derived explanation of why the current work exists. Includes origin event, how the work evolved (reissues, deepening), and current state. Built entirely from procedural docket — no model inference.",
        inputSchema: {
            type: "object",
            properties: {
                cwd: {
                    type: "string",
                    description: "Repository working directory",
                },
                case_id: {
                    type: "string",
                    description: "Specific case ID (defaults to active case)",
                },
            },
        },
    },
];
// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------
const server = new Server({
    name: "ai-legal-governance-runtime",
    version: "0.1.0",
}, {
    capabilities: {
        tools: {},
    },
});
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const inputArgs = (args ?? {});
    const cwd = typeof inputArgs["cwd"] === "string"
        ? path.resolve(inputArgs["cwd"])
        : process.cwd();
    try {
        const state = loadState(cwd);
        switch (name) {
            case "gov_current_posture": {
                const pack = renderContextPack(state);
                return {
                    content: [{ type: "text", text: pack }],
                };
            }
            case "gov_current_ticket": {
                if (!state.active_ticket) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({ error: "No active ticket", hint: "Run govctl ticket list" }, null, 2),
                            },
                        ],
                    };
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(state.active_ticket, null, 2),
                        },
                    ],
                };
            }
            case "gov_why": {
                const targetCaseId = (typeof inputArgs["case_id"] === "string" ? inputArgs["case_id"] : null) ??
                    state.active_case?.case_id;
                if (!targetCaseId) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: "No active case. Governance context not established.",
                            },
                        ],
                    };
                }
                const docketPath = govPath(cwd, "docket", "docket_events.jsonl");
                const allEvents = readJsonlFile(docketPath);
                const caseEvents = allEvents.filter((e) => e.case_id === targetCaseId);
                if (caseEvents.length === 0) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Case ${targetCaseId} has no docket events yet. Events are recorded automatically by hooks.`,
                            },
                        ],
                    };
                }
                const narrative = buildNarrative(caseEvents, state);
                return {
                    content: [{ type: "text", text: narrative }],
                };
            }
            default:
                return {
                    content: [
                        { type: "text", text: `Unknown tool: ${name}` },
                    ],
                    isError: true,
                };
        }
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Governance runtime error: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
});
// ---------------------------------------------------------------------------
// Narrative builder
// ---------------------------------------------------------------------------
function buildNarrative(events, state) {
    const lines = ["# Why This Work Exists", ""];
    const opening = events.find((e) => e.event_type === "case_opened" || e.event_type === "ticket_issued");
    if (opening) {
        lines.push(`**Origin**: ${opening.reason}`);
        lines.push(`*(${opening.created_at.slice(0, 10)})*`);
        lines.push("");
    }
    const refinements = events.filter((e) => e.event_type === "ticket_reissued" ||
        e.event_type === "workstream_deepened" ||
        e.event_type === "case_reframed");
    if (refinements.length > 0) {
        lines.push("**How it evolved:**");
        for (const e of refinements) {
            lines.push(`- ${e.event_type.replace(/_/g, " ")}: ${e.reason}`);
        }
        lines.push("");
    }
    if (state.active_ticket) {
        lines.push(`**Current state**: Active ticket \`${state.active_ticket.ticket_id}\``);
        lines.push(`> ${state.active_ticket.objective}`);
    }
    return lines.join("\n");
}
// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("AI Legal Governance Runtime MCP server running on stdio");
}
main().catch(console.error);
