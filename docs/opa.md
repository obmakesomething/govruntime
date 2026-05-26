# OPA / Rego Integration

OPA is optional. GovRuntime can use the local `opa` CLI as a Policy Decision Point.

Config:

```yaml
engine: opa
entrypoint: data.govruntime.tool
mode: enforce
policy_dir: .governance/policies
data_dir: .governance/policy_data
```

GovRuntime invokes:

```bash
opa eval --format=json --data <policy_dir> --data <data_dir> --input <temp-policy-input.json> <entrypoint>
```

Expected OPA value shape:

```json
{
  "deny": [],
  "warn": [],
  "review": []
}
```

Normalization:

- `deny.length > 0` -> `block`
- `review.length > 0` -> `require_human_review`
- `warn.length > 0` -> `warn`
- otherwise -> `allow`

## OPA missing behavior

If `engine: opa` but the OPA CLI is missing:

- `mode: enforce`: fail closed with a blocking policy decision
- `mode: advisory`: warn and fallback to the built-in engine

GovRuntime never silently allows execution because OPA failed.

## Default policies

`govctl init` creates example policies:

```text
.governance/policies/govruntime.rego
.governance/policies/scope.rego
.governance/policies/destructive.rego
.governance/policies/approval.rego
```

These examples mirror the built-in policy behavior and can be edited for local experiments.
