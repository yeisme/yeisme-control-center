import type { TaskConnectionState } from "../task-observation";
export type ProjectRole = "project_admin" | "creator" | "viewer";
export type OrganizationRole = "admin" | "member";
export interface CollaborationOrganization { id: string; name: string; source_tenant: string; revision: number; role: OrganizationRole }
export interface CollaborationMember { id: string; organization_id: string; identity: string; name: string; role: OrganizationRole; status: "active" | "suspended"; revision: number }
export interface CollaborationTeam { id: string; organization_id: string; name: string; revision: number; member_ids: string[] }
export interface ProjectGrant { subject_type: "member" | "team"; subject_id: string; role: ProjectRole }
export interface ProjectBinding { owner: string; project_ref: string; source_scope: string; connection_ids: string[] }
/** A tool project that can be bound: the binding itself, plus where it comes from (never sent back when saving). */
export interface BindingOption extends ProjectBinding { pinned: boolean; registered: boolean }
/** At most this many tool projects per shared project; several may belong to the same owner. */
export const maxProjectBindings = 10;
export interface SharedProject {
  id: string; organization_id: string; team_id: string | null; name: string; revision: number; hidden: boolean;
  role: ProjectRole; generation_enabled: boolean; budget_cap: number; currency: "CNY" | "USD";
  bindings: ProjectBinding[]; grants: ProjectGrant[]; created_at: string; updated_at: string;
}
export interface ProjectFolder { id: string; project_id: string; parent_id: string | null; name: string; revision: number }
export interface ProjectItem {
  id: string; project_id: string; folder_id: string | null; owner: string; task_key: string; artifact_ref: string;
  name: string; mime: string; revision: string; batch_ref: string | null; created_at: string; source_state: string; source?: { connection: string; project: string; family: string; ref: string };
}
export interface GenerationBatchItem {
  id: string; owner: "eikona" | "scaena"; model_ref: string; modality: "image" | "video"; candidate_count: number;
  folder_id: string | null; input_ref: string; input_digest: string; plan_digest: string;
  estimated_cost: number | null; currency: "CNY" | "USD"; operation_ref?: string; state: string; reason?: string; task_refs?: string[]; binding_digest?: string;
  /** Target tool project; required when the shared project binds several projects of this owner. */
  project_ref?: string;
  prompt_capture?: import("../observation-contract").PromptCaptureObservation;
}
export interface GenerationBatch {
  id: string; project_id: string; revision: number; name: string; state: string; idempotency_key: string;
  items: GenerationBatchItem[]; total_cost: number | null; created_at: string; updated_at: string;
}
/** Filters of a project's batch list; `state` and `owner` take comma-separated values, times are RFC 3339. */
export type GenerationBatchQuery = { q?: string; state?: string; owner?: string; from?: string; to?: string; cursor?: string; limit?: number };
/**
 * How one owner project answered while the server observed the batches it returns, in the task page's connection states
 * (labelled by `connectionStateLabel`): `ready` read, `not_checked` live items left for a later poll, or why a read failed.
 */
export interface GenerationBatchSource { owner: string; project_ref: string | null; state: "ready" | "not_checked" | "forbidden" | "needs_contract" | "source_unavailable"; observed_at: string; reason?: string }
/** Newest first. `total` counts this project's matching batches, not owner tasks; `partial` means an owner read failed. */
export interface GenerationBatchPage { rows: GenerationBatch[]; next_cursor: string | null; total: number; coverage: "complete" | "partial"; observed_at: string; sources: GenerationBatchSource[]; epoch?: number }
export interface GenerationBatchDetail { batch: GenerationBatch; coverage: "complete" | "partial"; observed_at: string; sources: GenerationBatchSource[]; epoch?: number }
export const projectRoleLabels: Record<ProjectRole, string> = { project_admin: "项目管理员", creator: "创作者", viewer: "查看者" };
export const collaborationActions = [
  "organization.create", "organization.member.set", "team.create", "team.members.set",
  "project.create", "project.update", "project.members.set", "project.bindings.set",
  "folder.create", "folder.rename", "item.move", "generation.input.prepare", "generation.batch.create", "generation.batch.submit", "generation.batch.reconcile",
] as const;
export type CollaborationAction = typeof collaborationActions[number];
export function isCollaborationAction(value: string): value is CollaborationAction { return (collaborationActions as readonly string[]).includes(value); }
export type DirectoryQuery = { q?: string; owner?: string; kind?: string; state?: string; from?: string; to?: string; folder?: string; batch?: string; cursor?: string; source_cursor?: string; limit?: number; local?: string };
export interface DirectoryPage<T> { rows: T[]; next_cursor: string | null; total: number; coverage: "complete" | "partial" | "unknown"; epoch?: number }
/**
 * A shared project's items. `next_cursor` pages the stored directory; `next_source_cursor` goes on reading the owner
 * connections that had more, and `sources` are those connections in the task page's connection states.
 */
export interface ProjectItemPage extends DirectoryPage<ProjectItem> { next_source_cursor: string | null; sources: TaskConnectionState[] }
