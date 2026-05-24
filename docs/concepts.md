# GovRuntime Concepts

This document explains the core structural and operational concepts of GovRuntime.

---

## 1. Case
A **Case** represents the high-level engineering problem or task being governed (e.g., `"Fix authorization timeout bug"`). 
*   A case is the top-level entity under which all ticket revisions, evidence, branches, and docket logs are grouped.
*   Only one case can be active at a time in a workspace.

---

## 2. Ticket
A **Ticket** is an authorized unit of work under a Case. 
*   It defines a clear **Objective**, **Acceptance Criteria** (exit conditions), and a specific list of **Non-Goals**.
*   **Immutable Revisions**: Tickets in GovRuntime are immutable. If the objective or scope changes, the ticket must not be mutated. Instead, the current ticket is marked `SUPERSEDED` and a new ticket revision is issued (e.g., `T-AUTH-101-R1` -> `T-AUTH-101-R2`).

---

## 3. Scope
**Scope** is the set of file path globs and terminal actions that an agent is authorized to execute for the active ticket.
*   **Intended Scope**: The allowed folders or files (e.g., `src/auth/**`).
*   **Forbidden Scope**: Explicitly blocked files (e.g., `infra/deploy.tf`, `*.env`).
*   Any attempt to read, write, or execute outside the active scope is flagged by GovRuntime's interceptor.

---

## 4. Evidence
**Evidence** represents the facts backing the agent's actions or scope changes. Evidence is categorized into Tiers of authority:
*   **Tier 1 (Highest)**: Explicit User Confirmation (e.g., direct chat quotes).
*   **Tier 2**: Version Control System (VCS) state, file diffs, test results.
*   **Tier 3**: Stored policy documents.
*   **Tier 4**: Active precedents or prior decisions.
*   **Tier 5**: Simulation run results.
*   **Tier 6 (Lowest)**: Agent reasoning (inference). Agent self-justification cannot override rules or expand scopes.

---

## 5. Docket
The **Docket** is an append-only event log (stored in Git-friendly JSONL format). It records every significant procedural action:
*   Case openings and ticket issuances.
*   Branch checkouts and scope bindings.
*   Admitted evidence.
*   Tool execution blocks.
*   Reissue transitions and completion audits.

---

## 6. Judgment
A **Judgment** is the result of GovRuntime's evaluation of a proposed tool execution.
*   `Allow`: The action is within scope and adheres to rules.
*   `Warn`: The action is potentially risky but advisory (e.g., editing infrastructure files).
*   `Block`: The action violates policy and is blocked before running.
