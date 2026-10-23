export type ProjectRole = "project_admin" | "creator" | "viewer";
export type OrganizationRole = "admin" | "member";
export interface CollaborationOrganization { id: string; name: string; source_tenant: string; revision: number; role: OrganizationRole }
export interface CollaborationMember { id: string; organization_id: string; identity: string; name: string; role: OrganizationRole; status: "active" | "suspended"; revision: number }
export interface CollaborationTeam { id: string; organization_id: string; name: string; revision: number; member_ids: string[] }
export interface ProjectGrant { subject_type: "member" | "team"; subject_id: string; role: ProjectRole }
export interface ProjectBinding { owner: string; project_ref: string; source_scope: string; connection_ids: string[] }
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
}
export interface GenerationBatch {
  id: string; project_id: string; revision: number; name: string; state: string; idempotency_key: string;
  items: GenerationBatchItem[]; total_cost: number | null; created_at: string; updated_at: string;
}
export const projectRoleLabels: Record<ProjectRole, string> = { project_admin: "项目管理员", creator: "创作者", viewer: "查看者" };
export const collaborationActions = [
  "organization.create", "organization.member.set", "team.create", "team.members.set",
  "project.create", "project.update", "project.members.set", "project.bindings.set",
  "folder.create", "folder.rename", "item.move", "generation.input.prepare", "generation.batch.create", "generation.batch.submit", "generation.batch.reconcile",
] as const;
export type CollaborationAction = typeof collaborationActions[number];
export function isCollaborationAction(value: string): value is CollaborationAction { return (collaborationActions as readonly string[]).includes(value); }
export type DirectoryQuery = { q?: string; owner?: string; kind?: string; state?: string; from?: string; to?: string; folder?: string; batch?: string; cursor?: string; limit?: number };
export interface DirectoryPage<T> { rows: T[]; next_cursor: string | null; total: number; coverage: "complete" | "partial" | "unknown"; epoch?: number }
