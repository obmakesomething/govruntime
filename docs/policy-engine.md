# Policy Engine

GovRuntime is the Policy Enforcement Point. A policy engine is the Policy Decision Point.

Flow:

```text
hook event / tool call
  -> build PolicyInput
  -> policyEngine.evaluate(input)
  -> normalize PolicyDecision into GovRuntime Judgment
  -> append policy_decision and judgment to audit ledger
  -> allow / warn / require_human_review / block
```

## Built-in engine

The built-in engine is zero-dependency and is used by default.

Config:

```yaml
engine: builtin
mode: enforce
```

Default rules:

- no active case or ticket: block in enforce mode, warn in advisory mode
- forbidden scope: always block
- outside intended scope: block unless explicitly approved; warn in advisory mode
- destructive action: block unless explicitly authorized
- high-risk path: require human review unless approved
- protected path: block unless human approval exists

Important product behavior:

```text
outside approved scope = block unless explicitly approved
```

## Policy mode

- `enforce`: block deny findings and map human-review requirements to blocking hook responses where the host cannot represent review separately
- `advisory`: warn for governance setup and scope drift, but still records the decision

Hosts with weak hook guarantees may still be advisory in practice even when policy mode says enforce.
