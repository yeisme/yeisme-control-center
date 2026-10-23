import { useRef, useState } from "react";
import { api, errorCode } from "../shared/api/control-center-client";
import { useWorkspace } from "./workspace";
import { createIdempotencyKey } from "../shared/action-runner";
import type { CollaborationAction } from "../shared/collaboration";
import type { ActionPreview, ActionPreviewRequest, ActionReceipt } from "../shared/action-contract";

export function useCollaborationAction(onSuccess: (receipt: ActionReceipt) => void) {
  const { session, scopeId, refresh } = useWorkspace();
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const request = useRef<ActionPreviewRequest | null>(null);
  const prepare = async (action: CollaborationAction, target: string, revision: number, input: Record<string, unknown>, actionScope = scopeId) => {
    if (!session) return; setBusy(true); setError(""); setPreview(null);
    const next: ActionPreviewRequest = { scope_id: actionScope, owner: "control-center", target_kind: action.startsWith("organization.") || action.startsWith("team.") || action === "project.create" ? "organization" : "project", target_ref: target, action, expected_revision: String(revision), idempotency_key: createIdempotencyKey("collaboration"), input };
    request.current = next;
    try { setPreview(await api.previewAction(next, session.csrf)); } catch (e) { setError(errorCode(e)); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!session || !preview || !request.current) return; setBusy(true); setError("");
    try {
      const receipt = await api.confirmAction({ scope_id: request.current.scope_id, preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: request.current.idempotency_key }, session.csrf);
      if (receipt.state === "succeeded" || receipt.state === "submitted") { setPreview(null); refresh(); onSuccess(receipt); }
      else { if (receipt.state === "unknown") { refresh(); onSuccess(receipt); } setError(receipt.error_code || receipt.state); }
    } catch (e) { setError(errorCode(e)); } finally { setBusy(false); }
  };
  return { prepare, confirm, preview, busy, error, reset: () => { setPreview(null); setError(""); } };
}
