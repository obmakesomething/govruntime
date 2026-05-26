import { sha256Canonical } from "../audit/canonical.js";
import type { PolicyDecision, PolicyFinding, PolicyInput } from "./types.js";

export function evaluateBuiltinPolicy(input: PolicyInput): PolicyDecision {
  const deny: PolicyFinding[] = [];
  const warn: PolicyFinding[] = [];
  const review: PolicyFinding[] = [];
  const advisory = input.policy_context.mode === "advisory";

  if (!input.governance.active_case) {
    pushModeFinding(advisory, deny, warn, {
      rule: "governance.no_active_case",
      reason: "No active case is available for this tool execution.",
      severity: "high",
    });
  }
  if (!input.governance.active_ticket) {
    pushModeFinding(advisory, deny, warn, {
      rule: "governance.no_active_ticket",
      reason: "No active ticket is available for this tool execution.",
      severity: "high",
    });
  }

  const branch = input.governance.active_branch;
  for (const targetPath of input.event.target_paths) {
    if (branch?.forbidden_scope.some((pattern) => matchesPolicyGlob(pattern, targetPath))) {
      deny.push({
        rule: "scope.forbidden_scope",
        reason: `Path is forbidden for active branch: ${targetPath}`,
        path: targetPath,
        severity: "critical",
      });
      continue;
    }

    if (branch && branch.intended_scope.length > 0 && !branch.intended_scope.some((pattern) => matchesPolicyGlob(pattern, targetPath))) {
      const finding: PolicyFinding = {
        rule: "scope.outside_intended_scope",
        reason: `Path is outside approved ticket scope: ${targetPath}`,
        path: targetPath,
        severity: "high",
      };
      if (input.authorization.explicit_scope_expansion) {
        // Explicit approval converts this rule to allow.
      } else if (advisory) {
        warn.push(finding);
      } else {
        deny.push(finding);
      }
    }

    if (input.repo.high_risk_paths.some((pattern) => matchesPolicyGlob(pattern, targetPath)) && input.authorization.human_approval_ids.length === 0) {
      review.push({
        rule: "repo.high_risk_path",
        reason: `Path requires human review: ${targetPath}`,
        path: targetPath,
        severity: "high",
      });
    }

    if (input.repo.protected_paths.some((pattern) => matchesPolicyGlob(pattern, targetPath)) && input.authorization.human_approval_ids.length === 0) {
      deny.push({
        rule: "repo.protected_path",
        reason: `Path is protected and requires human approval: ${targetPath}`,
        path: targetPath,
        severity: "critical",
      });
    }
  }

  if (input.event.destructive_signals.length > 0 && !input.authorization.explicit_destructive_action) {
    deny.push({
      rule: "destructive.requires_explicit_authorization",
      reason: `Destructive signal(s) detected: ${input.event.destructive_signals.join(", ")}`,
      severity: "critical",
    });
  }

  return buildPolicyDecision(input, deny, warn, review, "builtin");
}

export function buildPolicyDecision(
  input: PolicyInput,
  deny: PolicyFinding[],
  warn: PolicyFinding[],
  review: PolicyFinding[],
  engine: "builtin" | "opa",
  extraMetadata: Record<string, unknown> = {}
): PolicyDecision {
  const decision = deny.length > 0
    ? "block"
    : review.length > 0
      ? "require_human_review"
      : warn.length > 0
        ? "warn"
        : "allow";
  const resultForHash = { decision, deny, warn, review };
  return {
    decision,
    deny,
    warn,
    review,
    metadata: {
      engine,
      input_hash: sha256Canonical(input),
      result_hash: sha256Canonical(resultForHash),
      policy_bundle_hash: input.policy_context.policy_bundle_hash,
      policy_version: input.policy_context.policy_version,
      evaluated_at: new Date().toISOString(),
      ...extraMetadata,
    },
  };
}

export function matchesPolicyGlob(pattern: string, targetPath: string): boolean {
  if (pattern === targetPath || pattern === "**") return true;
  const normalizedPattern = pattern.replace(/^\.\//, "");
  const normalizedTarget = targetPath.replace(/^\.\//, "");
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedTarget === prefix || normalizedTarget.startsWith(`${prefix}/`);
  }
  const re = new RegExp(`^${escapeRegExp(normalizedPattern).replace(/\\\*\\\*/g, ".*").replace(/\\\*/g, "[^/]*")}$`);
  return re.test(normalizedTarget);
}

function pushModeFinding(advisory: boolean, deny: PolicyFinding[], warn: PolicyFinding[], finding: PolicyFinding): void {
  if (advisory) warn.push(finding);
  else deny.push(finding);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}
