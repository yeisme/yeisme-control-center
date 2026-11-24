import type { Owner } from "../request-visibility";
import { collaborationActions } from "./collaboration";

export const actionNames = [
 "prompts.save",
 "prompts.collection.create",
 "prompts.collection.set",
 "prompts.recipe.create",
 "prompts.recipe.revise",
 "prompts.recipe.archive",
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
  "owner_project.connect",
  "owner_project.disconnect",
  "gateway.backend.enable",
  "gateway.backend.disable",
  "gateway.backend.exposure.patch",
  "gateway.group.profile.upsert",
  "gateway.tools.refresh",
  "gateway.runtime.reload",
  "gateway.client.mode.set",
  "gateway.approval.decide",
  "gateway.token.issue",
  "gateway.token.revoke",
  "gateway.config.rollback",
] as const;

export type ControlAction = (typeof actionNames)[number];
export type ActionOwner = Owner | "control-center" | "gateway";
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
  /** Server-computed source authorization digest; clients must not supply it. */
  authorization_context?: string;
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

