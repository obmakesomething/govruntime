/**
 * Codex Hook Adapter
 *
 * Handles Codex hook format (different field names from Claude Code).
 * Phase 1: UserPromptSubmit only.
 */
import { loadState, handleSessionStart, handleUserPrompt, handlePreToolUse, handlePostToolUse, handleStop, } from "@govruntime/govd";
import { normalizeCodexEvent } from "./normalize.js";
export async function runCodexHook() {
    const rawInput = await readStdin();
    let parsed;
    try {
        parsed = JSON.parse(rawInput);
    }
    catch {
        process.exit(0);
    }
    const event = normalizeCodexEvent(parsed);
    const state = loadState(event.cwd);
    switch (event.hook_event_name) {
        case "SessionStart": {
            const result = handleSessionStart(state);
            if (result.context_pack) {
                // Codex uses system prompt prepend format
                writeCodexContext(result.context_pack);
            }
            process.exit(0);
            break;
        }
        case "UserPromptSubmit": {
            const result = handleUserPrompt(event, state);
            if (result.context_pack) {
                writeCodexContext(result.context_pack);
            }
            process.exit(0);
            break;
        }
        case "PreToolUse": {
            const result = handlePreToolUse(event, state);
            if (result.decision === "block") {
                writeCodexBlock(result.reason ?? "Blocked by governance runtime.");
                process.exit(1); // Codex uses exit 1 for block
            }
            if ((result.decision === "warn" || result.decision === "require_human_review") && result.reason) {
                writeCodexContext(result.reason);
            }
            process.exit(0);
            break;
        }
        case "PostToolUse": {
            handlePostToolUse(event, state);
            process.exit(0);
            break;
        }
        case "Stop": {
            const result = handleStop(event, state);
            if (result.decision === "block") {
                writeCodexBlock(result.reason ?? "Blocked by governance runtime.");
                process.exit(1);
            }
            if (result.decision === "warn" && result.reason) {
                writeCodexContext(result.reason);
            }
            process.exit(0);
            break;
        }
        default:
            process.exit(0);
    }
}
function readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk: string) => { data += chunk; });
        process.stdin.on("end", () => resolve(data));
        process.stdin.on("error", reject);
    });
}
function writeCodexContext(content: string) {
    // Codex accepts system message injection
    process.stdout.write(JSON.stringify({ system: content }) + "\n");
}
function writeCodexBlock(message: string) {
    process.stdout.write(JSON.stringify({ error: message }) + "\n");
}
// Run directly if invoked as a script
const isMain = process.argv[1] && (process.argv[1].endsWith("codex_adapter.js") ||
    process.argv[1].endsWith("codex_adapter.ts"));
if (isMain) {
    runCodexHook().catch(() => process.exit(0));
}
