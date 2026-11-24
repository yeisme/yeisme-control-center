import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { ControlDB } from "./client";
import { promptCollectionLinks, promptRecipeRevisions, promptRecipes } from "./schema";
import { AuthError } from "../auth";
import { promptKinds, promptOwners, type PromptKind, type PromptOwner } from "../../src/shared/prompt-library";
import { recipeContentStates, recipeSourceKinds, recipeStates, type PromptRecipeFacets, type PromptRecipeQuery, type PromptRecipeSource, type PromptRecipeSummary, type RecipeContentState, type RecipeSourceKind, type RecipeState } from "../../src/shared/prompt-recipes";

const ref = (value: unknown, max = 512): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f]/.test(value);
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };
const stringList = (value: unknown, maxItems = 32, maxLength = 160) => Array.isArray(value) && value.length <= maxItems && value.every((item) => ref(item, maxLength));

export interface PromptRecipeInput {
  owner: PromptOwner; project_ref: string; title: string; kind: PromptKind; tags?: string[]; notes?: string;
  visibility?: "private" | "project"; source: PromptRecipeSource; facets?: PromptRecipeFacets; content_state?: RecipeContentState;
}

function validate(input: PromptRecipeInput) {
  const source = input.source;
  const facets = input.facets;
  const sourceKeys = ["source_kind", "owner_prompt_ref", "owner_version", "source_digest", "task_ref", "request_ref", "batch_ref", "asset_refs"];
  const facetKeys = ["schema_version", "intent", "subject", "style", "scene", "motion", "camera", "audio", "model", "references", "field_sources"];
  if (!promptOwners.includes(input.owner) || !ref(input.project_ref) || !ref(input.title, 240) || !promptKinds.includes(input.kind) || (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.length > 32 || input.tags.some((tag) => !ref(tag, 80)))) || (input.notes !== undefined && (typeof input.notes !== "string" || input.notes.length > 2000)) || (input.visibility !== undefined && !["private", "project"].includes(input.visibility)) || !source || typeof source !== "object" || Array.isArray(source) || Object.keys(source).some((key) => !sourceKeys.includes(key)) || !recipeSourceKinds.includes(source.source_kind) || (source.owner_prompt_ref !== undefined && !ref(source.owner_prompt_ref, 160)) || (source.source_digest !== undefined && !/^sha256:[a-f0-9]{64}$/.test(source.source_digest)) || (source.owner_version !== undefined && (!Number.isInteger(source.owner_version) || source.owner_version < 1)) || (source.task_ref !== undefined && !ref(source.task_ref, 160)) || (source.request_ref !== undefined && !ref(source.request_ref, 160)) || (source.batch_ref !== undefined && !ref(source.batch_ref, 160)) || (source.asset_refs !== undefined && !stringList(source.asset_refs)) || (facets !== undefined && (!facets || typeof facets !== "object" || Array.isArray(facets) || Object.keys(facets).some((key) => !facetKeys.includes(key)) || facets.schema_version !== "yeisme.prompt_recipe_facets.v1"))) throw new AuthError("invalid_prompt_recipe", 400);
  if (facets) {
    for (const key of ["subject", "style", "scene", "motion", "camera", "audio", "references"] as const) if (facets[key] !== undefined && !stringList(facets[key])) throw new AuthError("invalid_prompt_recipe", 400);
    for (const key of ["intent", "model"] as const) if (facets[key] !== undefined && !ref(facets[key], 240)) throw new AuthError("invalid_prompt_recipe", 400);
    if (facets.field_sources !== undefined && (!facets.field_sources || typeof facets.field_sources !== "object" || Array.isArray(facets.field_sources) || Object.keys(facets.field_sources).length > 32 || Object.values(facets.field_sources).some((value) => !["owner", "user", "derived"].includes(value)))) throw new AuthError("invalid_prompt_recipe", 400);
  }
}

function summary(row: typeof promptRecipes.$inferSelect): PromptRecipeSummary {
  return { schema_version: "yeisme.prompt_recipe.v1", recipe_ref: row.id, scope_id: row.scopeId, visibility: row.visibility as "private" | "project", state: row.state as RecipeState, owner: row.owner as PromptOwner, project_ref: row.projectRef, title: row.title, kind: row.kind as PromptKind, tags: parse<string[]>(row.tags, []), notes: row.notes, source: parse<PromptRecipeSource>(row.source, { source_kind: "manual" }), facets: parse<PromptRecipeFacets>(row.facets, { schema_version: "yeisme.prompt_recipe_facets.v1" }), revision: row.revision, content_state: row.contentState as RecipeContentState, created_by: row.createdBy, created_at: row.createdAt, updated_at: row.updatedAt };
}

export class PromptRecipeStore {
  constructor(private readonly db: ControlDB) {}

  list(scopeId: string, query: PromptRecipeQuery = {}, after?: { updated_at: string; id: string }) {
    const rows = this.db.select().from(promptRecipes).where(eq(promptRecipes.scopeId, scopeId)).orderBy(desc(promptRecipes.updatedAt), desc(promptRecipes.id)).all();
    const collectionRefs = query.collection ? new Set(this.db.select({ owner: promptCollectionLinks.owner, project: promptCollectionLinks.projectRef, id: promptCollectionLinks.promptId }).from(promptCollectionLinks).where(and(eq(promptCollectionLinks.scopeId, scopeId), eq(promptCollectionLinks.collectionId, query.collection))).all().map((link) => `${link.owner}\u0000${link.project}\u0000${link.id}`)) : null;
    const filtered = rows.filter((row) => {
      const source = parse<PromptRecipeSource>(row.source, { source_kind: "manual" });
      const tags = parse<string[]>(row.tags, []);
      if (query.owner && row.owner !== query.owner) return false;
      if (query.kind && row.kind !== query.kind) return false;
      if (query.state && row.state !== query.state) return false;
      if (query.source && source.source_kind !== query.source) return false;
      if (query.tag && !tags.includes(query.tag)) return false;
      if (collectionRefs && !collectionRefs.has(`${row.owner}\u0000${row.projectRef}\u0000${source.owner_prompt_ref || row.id}`)) return false;
      if (query.q) {
        const haystack = `${row.title} ${row.notes} ${tags.join(" ")} ${source.source_kind} ${source.owner_prompt_ref || ""}`.toLocaleLowerCase();
        if (!haystack.includes(query.q.toLocaleLowerCase())) return false;
      }
      if (after && (row.updatedAt > after.updated_at || (row.updatedAt === after.updated_at && row.id >= after.id))) return false;
      return true;
    });
    const limit = query.limit || 20;
    const page = filtered.slice(0, limit);
    const last = page.at(-1);
    return { rows: page.map(summary), total: filtered.length, next: filtered.length > page.length && last ? { updated_at: last.updatedAt, id: last.id } : null };
  }

  get(scopeId: string, recipeId: string) {
    const row = this.db.select().from(promptRecipes).where(and(eq(promptRecipes.scopeId, scopeId), eq(promptRecipes.id, recipeId))).get();
    if (!row) throw new AuthError("prompt_recipe_not_found", 404);
    return summary(row);
  }

  versions(scopeId: string, recipeId: string) {
    this.get(scopeId, recipeId);
    return this.db.select().from(promptRecipeRevisions).where(eq(promptRecipeRevisions.recipeId, recipeId)).orderBy(desc(promptRecipeRevisions.revision)).all().map((row) => ({ recipe_ref: recipeId, revision: row.revision, title: row.title, kind: row.kind, tags: parse<string[]>(row.tags, []), notes: row.notes, source: parse<PromptRecipeSource>(row.source, { source_kind: "manual" }), facets: parse<PromptRecipeFacets>(row.facets, { schema_version: "yeisme.prompt_recipe_facets.v1" }), content_state: row.contentState as RecipeContentState, created_by: row.createdBy, created_at: row.createdAt }));
  }

  create(scopeId: string, actor: string, input: PromptRecipeInput) {
    validate(input);
    const now = new Date().toISOString();
    const id = `pr_${randomUUID().replaceAll("-", "")}`;
    this.db.transaction(() => {
      this.db.insert(promptRecipes).values({ id, scopeId, visibility: input.visibility || "private", state: "active", owner: input.owner, projectRef: input.project_ref, title: input.title.trim(), kind: input.kind, tags: json([...new Set(input.tags || [])]), notes: input.notes?.trim() || "", source: json(input.source), facets: json(input.facets || { schema_version: "yeisme.prompt_recipe_facets.v1" }), revision: 1, contentState: input.content_state || "metadata_only", createdBy: actor, createdAt: now, updatedAt: now }).run();
      this.db.insert(promptRecipeRevisions).values({ id: `${id}:1`, recipeId: id, revision: 1, title: input.title.trim(), kind: input.kind, tags: json([...new Set(input.tags || [])]), notes: input.notes?.trim() || "", source: json(input.source), facets: json(input.facets || { schema_version: "yeisme.prompt_recipe_facets.v1" }), contentState: input.content_state || "metadata_only", createdBy: actor, createdAt: now }).run();
    });
    return this.get(scopeId, id);
  }

  revise(scopeId: string, actor: string, recipeId: string, expectedRevision: number, input: PromptRecipeInput) {
    validate(input);
    const current = this.db.select().from(promptRecipes).where(and(eq(promptRecipes.scopeId, scopeId), eq(promptRecipes.id, recipeId))).get();
    if (!current) throw new AuthError("prompt_recipe_not_found", 404);
    if (current.revision !== expectedRevision) throw new AuthError("prompt_recipe_conflict", 409);
    const revision = expectedRevision + 1, now = new Date().toISOString();
    this.db.transaction(() => {
      const changed = this.db.update(promptRecipes).set({ visibility: input.visibility || current.visibility, state: "active", owner: input.owner, projectRef: input.project_ref, title: input.title.trim(), kind: input.kind, tags: json([...new Set(input.tags || [])]), notes: input.notes?.trim() || "", source: json(input.source), facets: json(input.facets || { schema_version: "yeisme.prompt_recipe_facets.v1" }), revision, contentState: input.content_state || current.contentState, updatedAt: now }).where(and(eq(promptRecipes.scopeId, scopeId), eq(promptRecipes.id, recipeId), eq(promptRecipes.revision, expectedRevision))).run();
      if (!changed.changes) throw new AuthError("prompt_recipe_conflict", 409);
      this.db.insert(promptRecipeRevisions).values({ id: `${recipeId}:${revision}`, recipeId, revision, title: input.title.trim(), kind: input.kind, tags: json([...new Set(input.tags || [])]), notes: input.notes?.trim() || "", source: json(input.source), facets: json(input.facets || { schema_version: "yeisme.prompt_recipe_facets.v1" }), contentState: input.content_state || current.contentState, createdBy: actor, createdAt: now }).run();
    });
    return this.get(scopeId, recipeId);
  }

  archive(scopeId: string, recipeId: string, expectedRevision: number) {
    const current = this.db.select().from(promptRecipes).where(and(eq(promptRecipes.scopeId, scopeId), eq(promptRecipes.id, recipeId))).get();
    if (!current) throw new AuthError("prompt_recipe_not_found", 404);
    if (current.revision !== expectedRevision) throw new AuthError("prompt_recipe_conflict", 409);
    this.db.transaction(() => {
      const changed = this.db.update(promptRecipes).set({ state: "archived", revision: expectedRevision + 1, updatedAt: new Date().toISOString() }).where(and(eq(promptRecipes.scopeId, scopeId), eq(promptRecipes.id, recipeId), eq(promptRecipes.revision, expectedRevision))).run();
      if (!changed.changes) throw new AuthError("prompt_recipe_conflict", 409);
      this.db.insert(promptRecipeRevisions).values({ id: `${recipeId}:${expectedRevision + 1}`, recipeId, revision: expectedRevision + 1, title: current.title, kind: current.kind, tags: current.tags, notes: current.notes, source: current.source, facets: current.facets, contentState: current.contentState, createdBy: current.createdBy, createdAt: new Date().toISOString() }).run();
    });
    return this.get(scopeId, recipeId);
  }
}
