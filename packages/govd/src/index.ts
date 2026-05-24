/**
 * @govruntime/govd — Public API
 */

// State
export { loadState, readJsonlFile, readAllYamlFiles, govPath } from "./state/loader.js";
export type { GovernanceState } from "./state/types.js";
export * from "./state/types.js";
export * from "./state/ids.js";
export * from "./state/writer.js";

// Evidence
export { admitEvidence, admitUserStatement, admitToolOutput, evidenceTier } from "./evidence/registry.js";

// Docket
export {
  recordDocketEvent,
  recordCaseOpened,
  recordTicketIssued,
  recordTicketReissued,
  recordExecutionBlocked,
  recordSessionStarted,
} from "./docket/recorder.js";

// Intent
export { analyzePrompt } from "./intent/analyzer.js";

// Conflict
export {
  detectBranchScopeConflict,
  detectPolicyViolation,
  detectMissingGovernanceContext,
  matchesGlob,
} from "./conflict/detector.js";

// Judgment
export { judgeToolCall, judgeCompletion } from "./judgment/engine.js";

// Context Pack
export { renderContextPack, syncAgentRules } from "./context/pack_renderer.js";

// Ticket
export { issueTicket, reissueTicket, pauseTicket, resumeTicket, updateTicketStatus } from "./ticket/engine.js";

// Branch Ledger
export {
  createBranchEntry,
  updateBranchStatus,
  findActiveBranchForTicket,
  listBranches,
  buildBranchName,
  buildWorktreePath,
} from "./branch/ledger.js";

// Handlers
export { handleSessionStart } from "./handlers/session_start.js";
export { handleUserPrompt } from "./handlers/user_prompt.js";
export { handlePreToolUse } from "./handlers/pre_tool_use.js";
export { handlePostToolUse } from "./handlers/post_tool_use.js";
export { handleStop } from "./handlers/stop.js";
