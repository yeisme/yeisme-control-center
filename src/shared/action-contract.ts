import type { Owner } from "../request-visibility";
import { collaborationActions } from "./collaboration";

export const actionNames = [
  ...collaborationActions,
  "task.cancel",
  "provider_runs.create",
  "provider_runs.reconcile",
  "review.request_changes",
  "review.approve",
  "delivery.prepare",
  "delivery.send",
  "admin.user.create",
  "admin.user.revoke",
  "owner.config.update",
  "owner.membership.update",
  "collection.record.confirm",
  "collection.record.archive",
  "collection.record.labels.set",
  "collection.record.note.set",
  "project.metadata.rename",
  "project.metadata.hide",
  "project.metadata.unhide",
] as const;

export type ControlAction = (typeof actionNames)[number];
export type ActionOwner = Owner | "control-center";
export type ActionAvailability = "available" | "needs_contract" | "forbidden" | "unavailable";
export type ActionState = "previewed" | "submitted" | "succeeded" | "failed" | "unknown" | "conflict" | "needs_contract";

export interface ActionDescriptor {
  action: ControlAction;
  owner: ActionOwner;
  target_kinds: string[];
  risk_tier: "read" | "write" | "paid" | "admin";
  availability: ActionAvailability;
  reason?: string;
}

export interface ActionPreviewRequest {
  scope_id: string;
  owner: ActionOwner;
  target_kind: string;
  target_ref: string;
  action: ControlAction;
  expected_revision: string;
  idempotency_key: string;
  input: Record<string, unknown>;
}

export interface ActionPreview {
  preview_ref: string;
  preview_digest: string;
  expires_at: string;
  normalized_input: Record<string, unknown>;
  blockers: string[];
  required_approvals: string[];
  availability: ActionAvailability;
}

export interface ActionConfirmRequest {
  scope_id: string;
  preview_ref: string;
  preview_digest: string;
  idempotency_key: string;
}

export interface ActionReceipt {
  generation_items?: import("./collaboration").GenerationBatchItem[];
  receipt_ref: string;
  action: ControlAction;
  owner: ActionOwner;
  target_ref: string;
  state: ActionState;
  owner_state: string | null;
  error_code: string | null;
  observed_at: string;
  operation_ref: string | null;
  result_refs: string[];
}

