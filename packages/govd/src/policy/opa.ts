import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalJson, sha256Canonical } from "../audit/canonical.js";
import { evaluateBuiltinPolicy, buildPolicyDecision } from "./builtin.js";
import type { PolicyConfig, PolicyDecision, PolicyFinding, PolicyInput } from "./types.js";

export function evaluateOpaPolicy(input: PolicyInput, config: PolicyConfig, cwd: string): PolicyDecision {
  const entrypoint = config.entrypoint ?? "data.govruntime.tool";
  const policyDir = config.policy_dir ?? ".governance/policies";
  const dataDir = config.data_dir ?? ".governance/policy_data";

  if (!opaAvailable()) {
    if (config.mode === "advisory") {
      const fallback = evaluateBuiltinPolicy({
        ...input,
        policy_context: { ...input.policy_context, engine: "builtin", mode: "advisory" },
      });
      fallback.warn.unshift({
        rule: "policy.opa_unavailable",
        reason: "OPA CLI is not available. Falling back to builtin policy engine in advisory mode.",
        severity: "medium",
      });
      fallback.decision = fallback.deny.length > 0 ? "block" : fallback.review.length > 0 ? "require_human_review" : "warn";
      fallback.metadata.engine = "opa";
      fallback.metadata.opa_unavailable = true;
      fallback.metadata.fallback_engine = "builtin";
      fallback.metadata.entrypoint = entrypoint;
      fallback.metadata.policy_dir = policyDir;
      fallback.metadata.data_dir = dataDir;
      fallback.metadata.result_hash = sha256Canonical({ decision: fallback.decision, deny: fallback.deny, warn: fallback.warn, review: fallback.review });
      return fallback;
    }

    return buildPolicyDecision(input, [{
      rule: "policy.opa_unavailable",
      reason: "OPA CLI is configured but not available. Failing closed in enforce mode.",
      severity: "critical",
    }], [], [], "opa", {
      opa_unavailable: true,
      entrypoint,
      policy_dir: policyDir,
      data_dir: dataDir,
    });
  }

  const tmpFile = path.join(os.tmpdir(), `govruntime-policy-input-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, canonicalJson(input), "utf8");
  try {
    const args = [
      "eval",
      "--format=json",
      "--data",
      path.resolve(cwd, policyDir),
      "--data",
      path.resolve(cwd, dataDir),
      "--input",
      tmpFile,
      entrypoint,
    ];
    const result = spawnSync("opa", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) {
      return buildPolicyDecision(input, [{
        rule: "policy.opa_eval_failed",
        reason: `OPA evaluation failed: ${(result.stderr || result.stdout || "unknown error").slice(0, 300)}`,
        severity: "critical",
      }], [], [], "opa", { entrypoint, policy_dir: policyDir, data_dir: dataDir });
    }
    const parsed = JSON.parse(result.stdout) as unknown;
    const rawValue = extractOpaValue(parsed);
    return normalizeOpaValue(input, rawValue, { entrypoint, policy_dir: policyDir, data_dir: dataDir });
  } catch (error) {
    return buildPolicyDecision(input, [{
      rule: "policy.opa_eval_error",
      reason: `OPA evaluation errored: ${error instanceof Error ? error.message : String(error)}`,
      severity: "critical",
    }], [], [], "opa", { entrypoint, policy_dir: policyDir, data_dir: dataDir });
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

export function normalizeOpaValue(
  input: PolicyInput,
  value: unknown,
  meta: { entrypoint?: string; policy_dir?: string; data_dir?: string } = {}
): PolicyDecision {
  const record = isRecord(value) ? value : {};
  const deny = normalizeFindings(record["deny"]);
  const warn = normalizeFindings(record["warn"]);
  const review = normalizeFindings(record["review"]);
  return buildPolicyDecision(input, deny, warn, review, "opa", {
    ...meta,
    raw_result: { deny, warn, review },
  });
}

function opaAvailable(): boolean {
  const result = spawnSync("opa", ["version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0;
}

function extractOpaValue(parsed: unknown): unknown {
  if (!isRecord(parsed)) return parsed;
  const results = parsed["result"];
  if (!Array.isArray(results)) return parsed;
  const first = results[0];
  if (!isRecord(first)) return parsed;
  const expressions = first["expressions"];
  if (!Array.isArray(expressions)) return parsed;
  const expression = expressions[0];
  if (!isRecord(expression)) return parsed;
  return expression["value"];
}

function normalizeFindings(value: unknown): PolicyFinding[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => normalizeFinding(item, index));
}

function normalizeFinding(value: unknown, index: number): PolicyFinding {
  if (isRecord(value)) {
    return {
      rule: typeof value["rule"] === "string" ? value["rule"] : `opa.finding.${index}`,
      reason: typeof value["reason"] === "string" ? value["reason"] : "OPA policy finding.",
      path: typeof value["path"] === "string" ? value["path"] : undefined,
      severity: isSeverity(value["severity"]) ? value["severity"] : undefined,
    };
  }
  return { rule: `opa.finding.${index}`, reason: String(value), severity: "medium" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSeverity(value: unknown): value is PolicyFinding["severity"] {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}
