/**
 * Intent Delta Analyzer
 *
 * Analyzes a user prompt against the current case/ticket to classify
 * the type of intent delta and extract new facts.
 *
 * In Phase 1 this uses heuristic pattern matching.
 * Phase 2+ will use a structured model call with evidence-grounded prompting.
 */

import type {
  IntentDelta,
  IntentDeltaType,
  PromptAnalysis,
  Case,
  Ticket,
  DocketEventType,
} from "../state/types.js";

// ---------------------------------------------------------------------------
// Heuristic keyword signals
// ---------------------------------------------------------------------------

const DELTA_SIGNALS: Record<IntentDeltaType, string[]> = {
  continue: ["계속", "continue", "keep going", "proceed", "go on"],
  refine: [
    "더 정확히",
    "좀 더",
    "narrow",
    "specifically",
    "precisely",
    "refine",
    "focus on",
  ],
  correct: [
    "아니야",
    "틀렸어",
    "그게 아니라",
    "correction",
    "actually",
    "no,",
    "that's not",
    "incorrect",
    "wrong",
  ],
  pivot: [
    "방향을 바꾸자",
    "다른 방향",
    "instead",
    "pivot",
    "switch to",
    "let's do something else",
  ],
  new_task: ["새로운", "별도로", "also do", "new task", "additionally", "next,"],
  cancel: ["취소", "중단", "stop", "cancel", "abandon", "forget it", "never mind"],
  deepen: [
    "더 자세히",
    "세부",
    "deep dive",
    "deepen",
    "elaborate",
    "expand on",
    "더 파고들어",
    "in more detail",
  ],
  pause: ["잠깐", "나중에", "pause", "hold on", "defer", "put on hold"],
  resume: ["다시", "재개", "resume", "pick up", "continue from where"],
};

function detectDeltaType(prompt: string): IntentDeltaType {
  const lower = prompt.toLowerCase();

  // Check in priority order: correction > cancel > pivot > deepen > refine > pause > resume > new_task > continue
  const priority: IntentDeltaType[] = [
    "correct",
    "cancel",
    "pivot",
    "deepen",
    "refine",
    "pause",
    "resume",
    "new_task",
    "continue",
  ];

  for (const deltaType of priority) {
    const signals = DELTA_SIGNALS[deltaType] ?? [];
    if (signals.some((signal) => lower.includes(signal.toLowerCase()))) {
      return deltaType;
    }
  }

  return "continue";
}

function deltaTypeToConfidence(type: IntentDeltaType, prompt: string): number {
  // Higher confidence for explicit signals
  const explicit = [
    "cancel",
    "correct",
    "pivot",
    "pause",
    "resume",
  ] as IntentDeltaType[];
  if (explicit.includes(type)) return 0.85;

  // Lower confidence for implicit signals
  if (type === "continue") return 0.70;
  return 0.78;
}

function deltaTypeToDocketEvent(type: IntentDeltaType): DocketEventType {
  const map: Record<IntentDeltaType, DocketEventType> = {
    continue: "ticket_resumed",
    refine: "ticket_reissued",
    correct: "ticket_reissued",
    pivot: "ticket_superseded",
    new_task: "ticket_issued",
    cancel: "ticket_superseded",
    deepen: "workstream_deepened",
    pause: "ticket_paused",
    resume: "ticket_resumed",
  };
  return map[type];
}

function extractNewFacts(
  prompt: string,
  _activeCase: Case | null,
  _activeTicket: Ticket | null
): PromptAnalysis["new_facts"] {
  // Phase 1: treat the entire prompt as one extracted fact
  // Phase 2: use model to extract structured claims from the prompt
  if (prompt.trim().length === 0) return [];

  return [
    {
      fact: `User stated: "${prompt.trim().slice(0, 200)}${prompt.trim().length > 200 ? "..." : ""}"`,
      source: "explicit_user_statement",
      confidence: 0.99,
    },
  ];
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

export function analyzePrompt(
  prompt: string,
  activeCase: Case | null,
  activeTicket: Ticket | null
): PromptAnalysis {
  const deltaType = detectDeltaType(prompt);
  const confidence = deltaTypeToConfidence(deltaType, prompt);

  const intentDelta: IntentDelta = {
    type: deltaType,
    summary: summarizeDelta(deltaType, prompt),
    confidence,
  };

  const newFacts = extractNewFacts(prompt, activeCase, activeTicket);

  const ticketActions: PromptAnalysis["ticket_actions"] = [];
  if (
    (deltaType === "refine" || deltaType === "correct" || deltaType === "deepen") &&
    activeTicket
  ) {
    const currentRevision = activeTicket.revision;
    const area = activeTicket.ticket_id.split("-")[1] ?? "TASK";
    const seq = parseInt(activeTicket.ticket_id.split("-")[2] ?? "1", 10);
    ticketActions.push({
      action: "reissue",
      ticket_id: activeTicket.ticket_id,
      new_ticket_id: `T-${area}-${String(seq).padStart(3, "0")}-R${currentRevision + 1}`,
      reason: `Intent delta: ${deltaType}. User refined or deepened the task.`,
    });
  }

  if (deltaType === "pause" && activeTicket) {
    ticketActions.push({
      action: "pause",
      ticket_id: activeTicket.ticket_id,
      reason: "User requested pause.",
    });
  }

  if (deltaType === "resume" && activeTicket) {
    ticketActions.push({
      action: "resume",
      ticket_id: activeTicket.ticket_id,
      reason: "User requested resume.",
    });
  }

  const docketEvents: PromptAnalysis["docket_events"] = [
    {
      event_type: deltaTypeToDocketEvent(deltaType),
      reason: intentDelta.summary,
    },
  ];

  return {
    event_type: "user_message_analyzed",
    intent_delta: intentDelta,
    desired_action: {
      mode: "execute",
      expected_output: deriveExpectedOutput(deltaType, prompt),
    },
    new_facts: newFacts,
    conflicts: [],
    ticket_actions: ticketActions,
    docket_events: docketEvents,
    next_best_action: deriveNextAction(deltaType, activeTicket),
  };
}

function summarizeDelta(type: IntentDeltaType, prompt: string): string {
  const summaries: Record<IntentDeltaType, string> = {
    continue: "User continues on the current task without direction change.",
    refine: "User is narrowing or clarifying the current objective.",
    correct: "User is correcting a previous interpretation or output.",
    pivot: "User is changing direction to a new approach.",
    new_task: "User introduced a new, separate task.",
    cancel: "User is cancelling or abandoning the current task.",
    deepen: "User wants the current workstream explored in more depth.",
    pause: "User is pausing the current workstream.",
    resume: "User is resuming a previously paused workstream.",
  };
  return summaries[type] ?? "Unknown intent delta.";
}

function deriveExpectedOutput(type: IntentDeltaType, prompt: string): string {
  if (type === "deepen") return "detailed design or implementation";
  if (type === "correct") return "corrected output or updated approach";
  if (type === "refine") return "more focused and precise output";
  if (type === "new_task") return "output for the new task";
  return "continuation of current task";
}

function deriveNextAction(
  type: IntentDeltaType,
  ticket: Ticket | null
): string {
  if (!ticket) return "Create a case and ticket before proceeding.";
  if (type === "pause") return `Pause ticket ${ticket.ticket_id} and update docket.`;
  if (type === "cancel") return `Cancel ticket ${ticket.ticket_id} and update docket.`;
  if (type === "deepen" || type === "refine" || type === "correct")
    return `Reissue ticket ${ticket.ticket_id} with updated acceptance criteria.`;
  return `Continue work on ticket ${ticket.ticket_id}.`;
}
