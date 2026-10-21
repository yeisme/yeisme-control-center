import { and, asc, eq } from "drizzle-orm";
import { AuthError } from "../auth";
import type { ControlDB } from "./client";
import { projectMetadata } from "./schema";

const MAX_NAME = 80;
const MAX_PART = 256;
const idFor = (scopeId: string, owner: string, projectRef: string) => `${scopeId}:${owner}:${projectRef}`;

function part(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_PART || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AuthError(`invalid_project_${name}`, 400);
  }
  return normalized;
}

export function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string") throw new AuthError("invalid_project_display_name", 400);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AuthError("invalid_project_display_name", 400);
  }
  return normalized;
}

export interface ProjectMetadataView {
  owner: string;
  project_ref: string;
  display_name: string;
  display_label: string;
  hidden: boolean;
  revision: number;
  updated_at: string;
  updated_by: string;
}

type Row = typeof projectMetadata.$inferSelect;

function view(row: Row): ProjectMetadataView {
  return {
    owner: row.owner,
    project_ref: row.projectRef,
    display_name: row.displayName,
    display_label: row.displayName || "未命名项目",
    hidden: row.hidden,
    revision: row.revision,
    updated_at: row.updatedAt,
    updated_by: row.updatedBy,
  };
}

export class ProjectMetadataStore {
  constructor(private readonly db: ControlDB) {}

  list(scopeId: string): ProjectMetadataView[] {
    return this.db
      .select()
      .from(projectMetadata)
      .where(eq(projectMetadata.scopeId, scopeId))
      .orderBy(asc(projectMetadata.owner), asc(projectMetadata.projectRef))
      .all()
      .map(view);
  }

  get(scopeId: string, owner: string, projectRef: string): ProjectMetadataView | null {
    const row = this.db
      .select()
      .from(projectMetadata)
      .where(and(eq(projectMetadata.scopeId, part(scopeId, "scope")), eq(projectMetadata.owner, part(owner, "owner")), eq(projectMetadata.projectRef, part(projectRef, "ref"))))
      .get();
    return row ? view(row) : null;
  }

  private mutate(scopeId: string, owner: string, projectRef: string, expectedRevision: string, actor: string, change: Partial<Pick<Row, "displayName" | "hidden">>): ProjectMetadataView {
    const normalizedScope = part(scopeId, "scope");
    const normalizedOwner = part(owner, "owner");
    const normalizedProject = part(projectRef, "ref");
    const normalizedActor = part(actor, "actor");
    if (!/^\d+$/.test(expectedRevision)) throw new AuthError("invalid_project_metadata_revision", 400);
    const expected = Number(expectedRevision);
    const id = idFor(normalizedScope, normalizedOwner, normalizedProject);
    const existing = this.db.select().from(projectMetadata).where(eq(projectMetadata.id, id)).get();
    if (existing) {
      if (existing.revision !== expected) throw new AuthError("project_metadata_conflict", 409);
      this.db.update(projectMetadata).set({ ...change, revision: existing.revision + 1, updatedAt: new Date().toISOString(), updatedBy: normalizedActor }).where(eq(projectMetadata.id, id)).run();
    } else {
      if (expected !== 0) throw new AuthError("project_metadata_conflict", 409);
      this.db.insert(projectMetadata).values({
        id,
        scopeId: normalizedScope,
        owner: normalizedOwner,
        projectRef: normalizedProject,
        displayName: change.displayName ?? "",
        hidden: change.hidden ?? false,
        revision: 1,
        updatedAt: new Date().toISOString(),
        updatedBy: normalizedActor,
      }).run();
    }
    const updated = this.db.select().from(projectMetadata).where(eq(projectMetadata.id, id)).get();
    if (!updated) throw new AuthError("project_metadata_unavailable", 503);
    return view(updated);
  }

  rename(scopeId: string, owner: string, projectRef: string, expectedRevision: string, displayName: unknown, actor: string) {
    return this.mutate(scopeId, owner, projectRef, expectedRevision, actor, { displayName: normalizeDisplayName(displayName) });
  }

  hide(scopeId: string, owner: string, projectRef: string, expectedRevision: string, actor: string) {
    return this.mutate(scopeId, owner, projectRef, expectedRevision, actor, { hidden: true });
  }

  unhide(scopeId: string, owner: string, projectRef: string, expectedRevision: string, actor: string) {
    return this.mutate(scopeId, owner, projectRef, expectedRevision, actor, { hidden: false });
  }
}
