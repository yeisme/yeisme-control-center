import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { AuthError } from "./auth";
import type { ScopeBinding, ServerConfig, TaskConnection } from "./contracts";
import type { ControlDB } from "./db/client";
import { ownerProjectConnections } from "./db/schema";

/** Owner project refs as owners issue them: no spaces, quotes, slashes beyond URI-style refs, or control characters. */
export const ownerProjectRef = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;

export interface RegisteredConnection extends TaskConnection {
  registered: true;
  template_id: string;
  scope_id: string;
}

/**
 * Every task connection the server may use: the configured ones, then tool projects an administrator connected from
 * the control center. A registered connection copies its configured template (endpoint, credential reference, origin
 * and content settings) and only changes the owner project; it can never cancel tasks. Registrations live in the
 * database and are never written into the config file.
 */
export class ConnectionCatalog {
  constructor(private config: ServerConfig, private db?: ControlDB) {}

  configured(): TaskConnection[] {
    return this.config.connections || [];
  }

  registered(): RegisteredConnection[] {
    if (!this.db) return [];
    const templates = new Map(this.configured().map((c) => [c.id, c]));
    return this.db.select().from(ownerProjectConnections).all().flatMap((row) => {
      const template = templates.get(row.templateId);
      if (!template || template.owner !== row.owner) return [];
      return [{ ...template, id: row.id, project: row.projectRef, label: row.label || template.label, allow_cancel: false, registered: true as const, template_id: row.templateId, scope_id: row.scopeId }];
    });
  }

  all(): TaskConnection[] {
    return [...this.configured(), ...this.registered()];
  }

  /** Connection ids a scope reads: the configured list plus tool projects registered for that scope and tenant. */
  idsFor(scope: Pick<ScopeBinding, "id" | "tenant" | "connection_ids">): string[] {
    const extra = this.db
      ? this.db.select().from(ownerProjectConnections).where(and(eq(ownerProjectConnections.scopeId, scope.id), eq(ownerProjectConnections.tenant, scope.tenant))).all().map((row) => row.id)
      : [];
    return [...(scope.connection_ids || []), ...extra];
  }

  /** Every connection of a scope, disabled ones included (the service directory shows those too). */
  inScope(scope: Pick<ScopeBinding, "id" | "tenant" | "connection_ids">): TaskConnection[] {
    const ids = new Set(this.idsFor(scope));
    return this.all().filter((c) => ids.has(c.id));
  }

  forScope(scope: Pick<ScopeBinding, "id" | "tenant" | "connection_ids">): TaskConnection[] {
    return this.inScope(scope).filter((c) => c.enabled);
  }

  /** A connection for one read only, never stored: verifies the owner accepts the template's credential for `project`. */
  probe(template: TaskConnection, project: string): TaskConnection {
    return { ...template, id: "probe_" + randomBytes(9).toString("hex"), project, allow_cancel: false };
  }

  register(input: { scope: Pick<ScopeBinding, "id" | "tenant">; template: TaskConnection; project: string; label: string; actor: string }) {
    if (!this.db) throw new AuthError("owner_project_registration_unavailable", 503);
    const id = `${input.template.owner}-reg-${randomBytes(9).toString("hex")}`;
    this.db.insert(ownerProjectConnections).values({ id, scopeId: input.scope.id, tenant: input.scope.tenant, templateId: input.template.id, owner: input.template.owner,
      projectRef: input.project, label: input.label, createdBy: input.actor, createdAt: new Date().toISOString() }).run();
    return id;
  }

  disconnect(id: string, scope: Pick<ScopeBinding, "id" | "tenant">) {
    if (!this.db) throw new AuthError("owner_project_registration_unavailable", 503);
    const removed = this.db.delete(ownerProjectConnections).where(and(eq(ownerProjectConnections.id, id), eq(ownerProjectConnections.scopeId, scope.id), eq(ownerProjectConnections.tenant, scope.tenant))).run();
    if (!removed.changes) throw new AuthError("owner_project_not_found", 404);
  }
}
