# Example: Login Bugfix Scope Drift

This example demonstrates how GovRuntime detects and handles scope drift when an agent attempts to edit files outside its authorized task scope.

## Scenario
1.  **Objective**: Increase JWT expiration from 10 minutes to 1 hour in `src/auth/jwt.ts`.
2.  **Authorized Scope**: `src/auth/**`.
3.  **Scope Drift**: The agent attempts to edit `infra/deploy.tf` to update deployment scaling.
4.  **Result**: GovRuntime blocks the write to `infra/deploy.tf` because it is outside the approved scope. It requires explicit user approval, which reissues the ticket with expanded scope.

## Directory Structure
*   `before/`: The initial state of the codebase.
*   `after/`: The final, completed state after authorized ticket expansion.
*   `.governance/`: The pre-configured governance configuration, showing the docket history, active tickets, and admitted evidence.

## Try It
Run `govctl status` inside this directory to view the posture:
```bash
govctl status --cwd .
```
Run `govctl timeline` to inspect how the scope was expanded and the ticket was reissued:
```bash
govctl timeline --cwd .
```
