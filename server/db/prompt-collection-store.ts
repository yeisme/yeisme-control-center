import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ControlDB } from "./client";
import { promptCollections, promptCollectionLinks } from "./schema";
import { AuthError } from "../auth";
import { promptOwners, type PromptOwner } from "../../src/shared/prompt-library";

export interface PromptLink { owner: PromptOwner; project: string; id: string }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class PromptCollectionStore {
 constructor(private db: ControlDB) {}
 list(scope: string) { return { collections: this.db.select().from(promptCollections).where(eq(promptCollections.scopeId, scope)).all().map(({ id, name }) => ({ id, name })), links: this.db.select().from(promptCollectionLinks).where(eq(promptCollectionLinks.scopeId, scope)).all().map(v => ({ collection_id: v.collectionId, owner: v.owner, project: v.projectRef, id: v.promptId })) }; }
 create(scope: string, name: unknown, key: string) {
  if (typeof name !== "string" || !name.trim() || name.length > 80 || /[\x00-\x1f]/.test(name)) throw new AuthError("invalid_collection", 400);
  const id = "pc_" + hash([scope, key]).slice(0, 32);
  const existing = this.db.select().from(promptCollections).where(eq(promptCollections.id, id)).get();
  if (existing && (existing.name !== name.trim() || existing.scopeId !== scope)) throw new AuthError("collection_conflict", 409);
  this.db.insert(promptCollections).values({ id, scopeId: scope, name: name.trim(), createdAt: new Date().toISOString() }).onConflictDoNothing().run();
  return id;
 }
 set(scope: string, collection: unknown, values: unknown, remove: boolean) {
  if (typeof collection !== "string" || !Array.isArray(values) || values.length < 1 || values.length > 50) throw new AuthError("invalid_collection", 400);
  if (!this.db.select().from(promptCollections).where(and(eq(promptCollections.id, collection), eq(promptCollections.scopeId, scope))).get()) throw new AuthError("collection_not_found", 404);
  const links = values as PromptLink[];
  for (const link of links) if (!link || Object.keys(link).some(k => !["owner", "project", "id"].includes(k)) || !promptOwners.includes(link.owner) || typeof link.project !== "string" || !link.project || link.project.length > 512 || typeof link.id !== "string" || !/^[a-zA-Z0-9._-]{1,160}$/.test(link.id)) throw new AuthError("invalid_collection_link", 400);
  for (const link of links) {
   const id = hash([scope, collection, link.owner, link.project, link.id]);
   if (remove) this.db.delete(promptCollectionLinks).where(and(eq(promptCollectionLinks.id, id), eq(promptCollectionLinks.scopeId, scope))).run();
   else this.db.insert(promptCollectionLinks).values({ id, scopeId: scope, collectionId: collection, owner: link.owner, projectRef: link.project, promptId: link.id }).onConflictDoNothing().run();
  }
  return collection;
 }
}
