export type AuditStream =
  | "judgment"
  | "tool_call"
  | "evidence"
  | "docket"
  | "policy_decision"
  | "policy_change"
  | "audit_event";

export interface AuditSigner {
  key_id: string;
  alg: "ed25519";
  signature: string;
}

export interface AuditEnvelope<T = unknown> {
  version: "gr.audit.v1";
  seq: number;
  stream: AuditStream;
  record_id: string;
  prev_hash: string;
  payload_hash: string;
  entry_hash: string;
  payload: T;
  case_id?: string;
  ticket_id?: string;
  session_id?: string;
  actor: "user" | "agent" | "hook" | "system";
  git_head?: string;
  created_at: string;
  signer?: AuditSigner;
}

export interface AuditHead {
  version: "gr.audit.head.v1";
  last_seq: number;
  last_hash: string;
  updated_at: string;
}

export interface AuditContext {
  case_id?: string;
  ticket_id?: string;
  session_id?: string;
  actor?: "user" | "agent" | "hook" | "system";
  git_head?: string;
  created_at?: string;
}

export interface AuditVerificationFailure {
  seq: number;
  stream?: AuditStream;
  record_id?: string;
  reason: string;
  expected?: string | number;
  actual?: string | number;
  interpretation: string;
}

export interface AuditVerificationResult {
  ok: boolean;
  checked: number;
  head?: AuditHead;
  failure?: AuditVerificationFailure;
}

export interface AuditCheckpoint {
  version: "gr.checkpoint.v1";
  from_seq: number;
  to_seq: number;
  tip_hash: string;
  git_head?: string;
  created_at: string;
  signature: null | AuditSigner;
}

export interface AuditAnchorReceipt {
  provider: string;
  checkpoint_hash: string;
  anchored_at: string;
  receipt: unknown;
}

export interface AuditAnchorProvider {
  anchor(checkpoint: AuditCheckpoint): Promise<AuditAnchorReceipt>;
  verify(checkpoint: AuditCheckpoint, receipt: AuditAnchorReceipt): Promise<boolean>;
}
