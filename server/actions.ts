import { createHash, randomUUID } from "node:crypto";
import { AuthError } from "./auth";
import type {
  ActionConfirmRequest,
  ActionDescriptor,
  ActionOwner,
  ActionPreview,
  ActionPreviewRequest,
  ActionReceipt,
  ActionState,
  ControlAction,
} from "../src/shared/action-contract";
import { actionNames } from "../src/shared/action-contract";
 

const actionDescriptors: ActionDescriptor[] = [
  { action: "task.cancel", owner: "control-center", target_kinds: ["task"], risk_tier: "write", availability: "available" },
  { action: "provider_runs.create", owner: "control-center", target_kinds: ["provider_run"], risk_tier: "paid", availability: "available" },
  { action: "provider_runs.reconcile", owner: "control-center", target_kinds: ["provider_run"], risk_tier: "write", availability: "available" },
  ...(["eikona", "scaena", "sonora"] as const).flatMap((owner) => [
    { action: "review.request_changes" as const, owner, target_kinds: ["task", "asset", "review"], risk_tier: "write" as const, availability: "needs_contract" as const, reason: "owner_review_contract_not_configured" },
    { action: "review.approve" as const, owner, target_kinds: ["task", "asset", "review"], risk_tier: "write" as const, availability: "needs_contract" as const, reason: "owner_review_contract_not_configured" },
  ]),
  { action: "delivery.prepare", owner: "control-center", target_kinds: ["delivery"], risk_tier: "write", availability: "needs_contract", reason: "owner_delivery_contract_not_configured" },
  { action: "delivery.send", owner: "control-center", target_kinds: ["delivery"], risk_tier: "write", availability: "needs_contract", reason: "owner_delivery_contract_not_configured" },
  { action: "admin.user.create", owner: "control-center", target_kinds: ["personal_user"], risk_tier: "admin", availability: "available" },
  { action: "admin.user.revoke", owner: "control-center", target_kinds: ["personal_user"], risk_tier: "admin", availability: "available" },
  { action: "owner.config.update", owner: "aigora", target_kinds: ["owner_config"], risk_tier: "admin", availability: "needs_contract", reason: "owner_config_contract_not_configured" },
  { action: "owner.membership.update", owner: "aigora", target_kinds: ["membership"], risk_tier: "admin", availability: "needs_contract", reason: "owner_membership_contract_not_configured" },
  { action: "collection.record.confirm", owner: "control-center", target_kinds: ["auctra_collection_record"], risk_tier: "write", availability: "available" },
  { action: "collection.record.archive", owner: "control-center", target_kinds: ["auctra_collection_record"], risk_tier: "write", availability: "available" },
  { action: "collection.record.labels.set", owner: "control-center", target_kinds: ["auctra_collection_record"], risk_tier: "write", availability: "available" },
  { action: "collection.record.note.set", owner: "control-center", target_kinds: ["auctra_collection_record"], risk_tier: "write", availability: "available" },
  { action: "project.metadata.rename", owner: "control-center", target_kinds: ["project"], risk_tier: "write", availability: "available" },
  { action: "project.metadata.hide", owner: "control-center", target_kinds: ["project"], risk_tier: "write", availability: "available" },
  { action: "project.metadata.unhide", owner: "control-center", target_kinds: ["project"], risk_tier: "write", availability: "available" },
];

interface PreviewRecord {
  request: ActionPreviewRequest;
  preview: ActionPreview;
  createdAt: number;
  receiptRef?: string;
  receiptPromise?: Promise<ActionReceipt>;
}

function safeString(value: unknown, name: string, max = 512): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new AuthError(`invalid_action_${name}`, 400);
  return value.trim();
}

function descriptor(action: ControlAction, owner: ActionOwner) {
  const value = actionDescriptors.find((item) => item.action === action && item.owner === owner);
  if (!value) throw new AuthError("action_not_allowlisted", 403);
  return value;
}

function digest(value: unknown) {
  return "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sanitizeInput(action: ControlAction, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AuthError("invalid_action_input", 400);
  const allowed: Record<ControlAction, string[]> = {
    "task.cancel": ["confirm", "expected_revision", "idempotency_key"],
    "provider_runs.create": ["mode", "owner", "modality", "model_ref", "scope_id", "project_ref", "prompt", "budget_cap", "idempotency_key", "trace_ref", "generation_mode", "references", "timeline", "output", "variant_count"],
    "provider_runs.reconcile": ["run_ref"],
    "review.request_changes": ["reason", "version_ref"],
    "review.approve": ["version_ref", "reason"],
    "delivery.prepare": ["asset_refs", "reason"],
    "delivery.send": ["delivery_ref", "destination_ref", "reason"],
    "admin.user.create": ["username", "name", "role", "scope_ids"],
    "admin.user.revoke": ["username"],
    "owner.config.update": ["revision", "changes"],
    "owner.membership.update": ["member_ref", "changes", "revision"],
    "collection.record.confirm": ["expected_revision"],
    "collection.record.archive": ["expected_revision"],
    "collection.record.labels.set": ["expected_revision", "labels"],
    "collection.record.note.set": ["expected_revision", "note"],
    "project.metadata.rename": ["expected_revision", "display_name"],
    "project.metadata.hide": ["expected_revision"],
    "project.metadata.unhide": ["expected_revision"],
  };
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed[action].includes(key))) throw new AuthError("invalid_action_input", 400);
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 10000) : value]));
}

export class ActionService {
  private previews = new Map<string, PreviewRecord>();
  private receipts = new Map<string, ActionReceipt>();
  private receiptScopes = new Map<string, string>();

  list(owner?: string): ActionDescriptor[] {
    if (!owner || owner === "all") return actionDescriptors.map((item) => ({ ...item, target_kinds: [...item.target_kinds] }));
    return actionDescriptors.filter((item) => item.owner === owner).map((item) => ({ ...item, target_kinds: [...item.target_kinds] }));
  }

  preview(input: ActionPreviewRequest): ActionPreview {
    if (!actionNames.includes(input.action)) throw new AuthError("action_not_allowlisted", 403);
    const action = descriptor(input.action, input.owner);
    const scopeId = safeString(input.scope_id, "scope_id", 128);
    const targetRef = safeString(input.target_ref, "target_ref");
    const expectedRevision = safeString(input.expected_revision, "expected_revision", 200);
    const idempotencyKey = safeString(input.idempotency_key, "idempotency_key", 128);
    if (!/^[-a-zA-Z0-9_]{16,100}$/.test(idempotencyKey)) throw new AuthError("invalid_action_idempotency_key", 400);
    const normalizedInput = sanitizeInput(input.action, input.input);
    if (!action.target_kinds.includes(input.target_kind)) throw new AuthError("action_target_kind_not_supported", 409);
    const previewRef = "preview_" + randomUUID().replaceAll("-", "");
    const preview: ActionPreview = {
      preview_ref: previewRef,
      preview_digest: digest({ scopeId, owner: input.owner, targetKind: input.target_kind, targetRef, expectedRevision, idempotencyKey, action: input.action, normalizedInput }),
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      normalized_input: normalizedInput,
      blockers: action.availability === "available" ? [] : [action.reason || "action_unavailable"],
      required_approvals: action.risk_tier === "admin" || action.risk_tier === "paid" ? ["control_center_admin"] : [],
      availability: action.availability,
    };
    this.previews.set(previewRef, { request: { ...input, scope_id: scopeId, target_ref: targetRef, expected_revision: expectedRevision, idempotency_key: idempotencyKey, input: normalizedInput }, preview, createdAt: Date.now() });
    return preview;
  }

  confirm(input: ActionConfirmRequest, execute: (record: PreviewRecord) => Promise<ActionReceipt>): Promise<ActionReceipt> {
    const preview = this.previews.get(input.preview_ref);
    if (!preview || preview.createdAt + 10 * 60_000 < Date.now()) throw new AuthError("action_preview_expired", 410);
    if (preview.request.scope_id !== input.scope_id || preview.preview.preview_digest !== input.preview_digest) throw new AuthError("action_preview_conflict", 409);
    if (preview.request.idempotency_key !== input.idempotency_key) throw new AuthError("action_idempotency_conflict", 409);
    if (preview.receiptRef) return Promise.resolve(this.receipts.get(preview.receiptRef)!);
    if (preview.receiptPromise) return preview.receiptPromise;
    preview.receiptPromise = execute(preview).then((receipt) => {
      preview.receiptRef = receipt.receipt_ref;
      this.receipts.set(receipt.receipt_ref, receipt);
      this.receiptScopes.set(receipt.receipt_ref, preview.request.scope_id);
      return receipt;
    }).catch((error) => {
      preview.receiptPromise = undefined;
      throw error;
    });
    return preview.receiptPromise;
  }

  receipt(receiptRef: string, scopeId?: string): ActionReceipt {
    const receipt = this.receipts.get(receiptRef);
    if (!receipt) throw new AuthError("action_receipt_not_found", 404);
    if (scopeId && this.receiptScopes.get(receiptRef) !== scopeId) throw new AuthError("scope_denied", 403);
    return receipt;
  }

  static unavailable(record: PreviewRecord, reason: string): ActionReceipt {
    return {
      receipt_ref: "receipt_" + randomUUID().replaceAll("-", ""),
      action: record.request.action,
      owner: record.request.owner as ActionOwner,
      target_ref: record.request.target_ref,
      state: "needs_contract" as ActionState,
      owner_state: null,
      error_code: reason,
      observed_at: new Date().toISOString(),
      operation_ref: null,
      result_refs: [],
    };
  }
}

export type { PreviewRecord };

