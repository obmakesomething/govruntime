# Running the Scope Drift Demo

This guide walks you through verifying GovRuntime's execution governance behavior using the provided login-bugfix example.

---

## Prerequisites
Ensure GovRuntime CLI is built and available locally.

---

## Step-by-Step Walkthrough

### 1. Navigate to the Example Directory
```bash
cd examples/login-bugfix-scope-drift
```

### 2. Inspect the Initial Posture
Check the active case, ticket, and branch scope:
```bash
node ../../packages/govctl/dist/index.js status
```
*Observe that the active ticket is T-AUTH-101-R2 and the scope allows edits to `src/auth/**` and `infra/deploy.tf`.*

### 3. Review the History Timeline
Print the docket history to see how the scope was expanded:
```bash
node ../../packages/govctl/dist/index.js timeline
```
You will see:
1.  The case opened.
2.  The initial ticket issued (T-AUTH-101-R1).
3.  A blocked execution log indicating a tool write to `infra/deploy.tf` was blocked because it fell outside `src/auth/**`.
4.  User confirmation admitted as evidence.
5.  The ticket reissued to R2, expanding the allowed scope to include `infra/deploy.tf`.

### 4. Review the Explanatory Reason
Run the `why` command to get a summary of why the current ticket is active:
```bash
node ../../packages/govctl/dist/index.js why
```
This demonstrates the inspectability and explainability of agent workflows powered by GovRuntime.
