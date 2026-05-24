# Agent Governance Summary

This repository uses **AI Legal Governance Runtime**.

> Authoritative governance state lives in `.governance/`.
> This file is a human-readable summary — not the governance system.

## Core Rules

1. Do not execute outside the active case or ticket.
2. Do not silently expand scope.
3. Prefer evidence over model inference.
4. Treat current explicit user correction as higher authority than stale memory.
5. Destructive actions require explicit authorization.
6. Branches and worktrees must have governance ledger entries (`govctl branch create`).
7. If facts conflict, create a conflict record before acting.
8. If the current task is unclear, inspect current procedural posture before asking the user.
9. Do not revive superseded workstreams unless explicitly requested.
10. Completion means active ticket acceptance criteria are satisfied.

## Before Editing

- Read the injected **Procedural Context Pack** (injected by hooks at session start).
- Verify current case, ticket, branch, and worktree with `govctl status`.
- Check whether the target file path is within the allowed scope.

## If Blocked

- Explain the applied rule.
- Identify missing evidence or approval.
- Suggest ticket reissue, appeal, or human review.

## Quick Commands

```
govctl status          # current case, ticket, branch, why
govctl why             # why this work exists
govctl timeline        # procedural history
govctl ticket list     # all tickets
govctl ticket reissue  # reissue a ticket
govctl evidence admit  # record a user statement as evidence
govctl branch create   # create a branch with ledger entry
```
