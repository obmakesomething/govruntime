# GovRuntime Limitations

GovRuntime is currently in **v0.1-alpha**. It is an early-stage execution governance framework suitable for experimentation, integration testing, and demos.

Please be aware of the following design and technical limitations:

---

## 1. Local Storage is Not Tamper-Proof
The `.governance/` directory stores state in plaintext YAML and JSONL files.
*   These logs are easily inspectable and Git-friendly, but they are **not cryptographically secure** or tamper-proof.
*   An agent with write access to the filesystem *could* theoretically delete or modify these logs if host client permissions are not set correctly.
*   *Roadmap item:* Hash-chained dockets and external logging backends.

---

## 2. Dependency on Host Client Hook Support
Hard-blocking tool calls relies on the host agent client (e.g., Claude Code settings) invoking the GovRuntime CLI adapter hook during its execution lifecycle.
*   If the agent is run in an editor that does not support hooks (such as Cursor), GovRuntime must fall back to advisory rules syncing (`.cursorrules`).
*   In advisory mode, policy enforcement is reliant on the model respecting system prompts rather than process-level blocks.

---

## 3. Sandboxing
GovRuntime regulates logical tool usage (which files are touched, which git branches are created). It is **not** an OS-level container sandboxing engine. It does not prevent memory-based attacks, local port bindings, or arbitrary system calls unless they are routed through the client's hook tools.

---

## 4. Evidence Classification
The evidence registry categorizes statements into Tiers (Tier 1 User Statement down to Tier 6 Inference). Currently, parsing of claims and confidence scores is performed via regex and simple classification. Operational compliance requires human reviews to verify evidence integrity.
