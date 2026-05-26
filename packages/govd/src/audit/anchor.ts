import { sha256Canonical } from "./canonical.js";
import type { AuditAnchorProvider, AuditAnchorReceipt, AuditCheckpoint } from "./types.js";

export class NoopAuditAnchorProvider implements AuditAnchorProvider {
  async anchor(checkpoint: AuditCheckpoint): Promise<AuditAnchorReceipt> {
    return {
      provider: "local/noop",
      checkpoint_hash: sha256Canonical(checkpoint),
      anchored_at: new Date().toISOString(),
      receipt: null,
    };
  }

  async verify(checkpoint: AuditCheckpoint, receipt: AuditAnchorReceipt): Promise<boolean> {
    return receipt.provider === "local/noop" && receipt.checkpoint_hash === sha256Canonical(checkpoint);
  }
}

export class HttpAuditAnchorProvider implements AuditAnchorProvider {
  constructor(private readonly endpoint: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async anchor(checkpoint: AuditCheckpoint): Promise<AuditAnchorReceipt> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkpoint }),
    });
    const receipt = await response.json().catch(() => null) as unknown;
    return {
      provider: "generic/http",
      checkpoint_hash: sha256Canonical(checkpoint),
      anchored_at: new Date().toISOString(),
      receipt,
    };
  }

  async verify(checkpoint: AuditCheckpoint, receipt: AuditAnchorReceipt): Promise<boolean> {
    return receipt.checkpoint_hash === sha256Canonical(checkpoint);
  }
}
