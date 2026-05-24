# Guardrails vs. GovRuntime

This document details the strategic differences between generic AI guardrails and GovRuntime.

---

## The Strategic Difference

*   **Guardrails check Safety**: A guardrail asks, *"Is this specific token, string, or tool call safe in isolation?"* E.g., preventing sql injection, toxic statements, or secret exposures.
*   **GovRuntime checks Authorization**: GovRuntime asks, *"Is the agent still acting within the boundaries of the authorized ticket, approved scope, evidence, and history?"*

---

## Comparison Matrix

| Dimension | Generic Guardrails | GovRuntime |
| :--- | :--- | :--- |
| **Primary Question** | "Is this safe?" | "Is this authorized by the ticket/scope?" |
| **Scope Awareness** | None. Treats every call in isolation. | High. Tracks active ticket and branch scopes. |
| **Context Model** | Stateless. | Stateful (Case -> Ticket -> Branch -> Docket). |
| **History Tracking** | None. | Append-only docket timeline of all session events. |
| **Bypass Prevention** | Prompt-based or token filtering. | Process-level lifecycle hooks. |
| **Agent Self-Justification**| N/A. | Not treated as authority; requires user evidence. |
| **VCS-Friendly** | No. | Yes, all state stored in Git-trackable YAML/JSONL. |

---

## Coexistence
GovRuntime does not replace guardrails. Guardrails are excellent at catching generic, toxic, or malformed data. GovRuntime complements them by wrapping agent execution in a ticket-aware developer control plane.
