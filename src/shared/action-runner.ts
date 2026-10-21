import type { ActionConfirmRequest, ActionPreview, ActionPreviewRequest, ActionReceipt } from "./action-contract";

export type ActionRunPhase = "idle" | "editing" | "previewing" | "previewed" | "confirming" | "submitted" | "succeeded" | "failed" | "unknown" | "conflict" | "needs_contract";

export interface ActionRunState {
  phase: ActionRunPhase;
  preview: ActionPreview | null;
  receipt: ActionReceipt | null;
  error: string | null;
}

export interface ActionRunnerClient {
  previewAction: (input: ActionPreviewRequest, csrf: string, signal?: AbortSignal) => Promise<ActionPreview>;
  confirmAction: (input: ActionConfirmRequest, csrf: string, signal?: AbortSignal) => Promise<ActionReceipt>;
}

export function createIdempotencyKey(prefix = "action") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export async function runAction(client: ActionRunnerClient, input: ActionPreviewRequest, csrf: string, onPhase?: (phase: ActionRunPhase) => void, signal?: AbortSignal): Promise<ActionRunState> {
  onPhase?.("editing");
  onPhase?.("previewing");
  let preview: ActionPreview;
  try {
    preview = await client.previewAction(input, csrf, signal);
  } catch (error) {
    const phase: ActionRunPhase = error instanceof Error && /conflict|revision|idempotency/i.test(error.message) ? "conflict" : "failed";
    onPhase?.(phase);
    return { phase, preview: null, receipt: null, error: error instanceof Error ? error.message : "action_preview_failed" };
  }
  if (preview.availability !== "available" || preview.blockers.length > 0) {
    const phase: ActionRunPhase = preview.availability === "needs_contract" ? "needs_contract" : "previewed";
    onPhase?.(phase);
    return { phase, preview, receipt: null, error: preview.blockers[0] || null };
  }
  onPhase?.("previewed");
  onPhase?.("confirming");
  try {
    const receipt = await client.confirmAction({ scope_id: input.scope_id, preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: input.idempotency_key }, csrf, signal);
    const phase: ActionRunPhase = receipt.state === "unknown" ? "unknown" : receipt.state === "conflict" ? "conflict" : receipt.state === "needs_contract" ? "needs_contract" : receipt.state === "failed" ? "failed" : receipt.state === "submitted" ? "submitted" : "succeeded";
    onPhase?.(phase);
    return { phase, preview, receipt, error: receipt.error_code };
  } catch (error) {
    const phase: ActionRunPhase = error instanceof Error && /conflict|revision|idempotency/i.test(error.message) ? "conflict" : "unknown";
    onPhase?.(phase);
    return { phase, preview, receipt: null, error: error instanceof Error ? error.message : "action_confirm_unknown" };
  }
}

