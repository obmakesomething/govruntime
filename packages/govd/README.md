# @govruntime/govd

Core library for GovRuntime, the procedural governance runtime for AI coding agents.

This package contains the core business logic, engines, and handlers:
*   **State Loader & Writer**: Parses and updates `.governance/` YAML config files and JSONL event logs.
*   **Evidence Registry**: Admits and tiers evidence based on authority levels.
*   **Docket Recorder**: Maintains the chronological timeline of events.
*   **Intent Analyzer**: Classifies prompt intent changes (e.g. continue, refine, deepen, pivot).
*   **Conflict Detector**: Scans for glob path violations and rule conflicts.
*   **Judgment Engine**: Applies policy rules (statutes) to output allow/warn/block judgments.
*   **Context Pack Renderer**: Formats the dynamic markdown injected into agent prompts.
*   **Hook Handlers**: The underlying logic for agent lifecycle hooks.
