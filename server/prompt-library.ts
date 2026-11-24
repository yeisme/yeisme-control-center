import { createHash } from "node:crypto";
import { AuthError } from "./auth";
import { promptKinds, type PromptSummary, type PromptOwner, type PromptWrite } from "../src/shared/prompt-library";

const ref = (v: unknown, max = 512): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !/[\x00-\x1f]/.test(v);
export function promptSummary(raw: unknown, owner: PromptOwner, project: string): PromptSummary {
  if (!raw || typeof raw !== "object") throw new AuthError("prompt_contract_invalid", 502);
  const v = raw as Record<string, any>;
  if (v.owner !== owner || v.project !== project) throw new AuthError("scope_mismatch", 403);
  if (!ref(v.id, 160) || !/^[a-zA-Z0-9._-]+$/.test(v.id) || !ref(v.title, 512) || !promptKinds.includes(v.kind) || !["manual", "history"].includes(v.source) || !Number.isInteger(v.version) || v.version < 1 || !/^sha256:[a-f0-9]{64}$/.test(v.digest) || !Array.isArray(v.tags) || v.tags.length > 32 || v.tags.some((t: unknown) => !ref(t, 80))) throw new AuthError("prompt_contract_invalid", 502);
  return { id: v.id, owner, project, title: v.title, kind: v.kind, source: v.source, version: v.version, digest: v.digest, tags: v.tags, archived: v.archived === true, readable: v.readable === true, created_at: typeof v.created_at === "string" ? v.created_at : "", updated_at: typeof v.updated_at === "string" ? v.updated_at : "", ...(ref(v.task_ref) ? { task_ref: v.task_ref } : {}), ...(ref(v.source_ref) ? { source_ref: v.source_ref } : {}), ...(ref(v.model, 256) ? { model: v.model } : {}), ...(v.visibility === "private" || v.visibility === "project" ? { visibility: v.visibility } : {}) };
}
export function promptWrite(raw: unknown, owner: PromptOwner): PromptWrite {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AuthError("invalid_prompt", 400);
  const v = raw as Record<string, any>;
  if (Object.keys(v).some(k => !["id", "title", "kind", "text", "tags", "archived", "expected_version", "source_ref"].includes(k)) || !ref(v.title, 240) || !promptKinds.includes(v.kind) || (owner === "eikona" ? v.kind !== "image" : owner === "scaena" ? v.kind !== "video" : !["speech", "music", "sfx"].includes(v.kind)) || !Number.isInteger(v.expected_version) || v.expected_version < 0 || typeof v.archived !== "boolean" || !Array.isArray(v.tags) || v.tags.length > 32 || v.tags.some((t: unknown) => !ref(t, 80)) || (v.id !== undefined && (!ref(v.id, 160) || !/^[a-zA-Z0-9._-]+$/.test(v.id))) || (v.source_ref !== undefined && !ref(v.source_ref)) || (v.text !== undefined && (typeof v.text !== "string" || !v.text.trim() || new TextEncoder().encode(v.text).length > 400_000)) || (!v.id && v.text === undefined)) throw new AuthError("invalid_prompt", 400);
  return { ...v, tags: [...new Set<string>(v.tags)] } as PromptWrite;
}
export function verifyPromptBody(text: unknown, summary: PromptSummary): string {
  if (typeof text !== "string" || Buffer.byteLength(text) > 1 << 20 || "sha256:" + createHash("sha256").update(text).digest("hex") !== summary.digest) throw new AuthError("prompt_content_integrity_failed", 502);
  return text;
}
