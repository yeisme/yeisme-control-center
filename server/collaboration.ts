import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, like, lt, or, sql, type SQL } from "drizzle-orm";
import { AuthError, type SessionAuth } from "./auth";
import type { ScopeBinding, ServerConfig, Session } from "./contracts";
import type { ControlDB } from "./db/client";
import { ConnectionCatalog } from "./connection-catalog";
import { collaborationOrganizations as organizations, collaborationMembers as members, collaborationTeams as teams, collaborationProjects as projects, collaborationFolders as folders, collaborationItems as items, collaborationBatches as batches, projectMetadata } from "./db/schema";
import { maxProjectBindings, type BindingOption, type CollaborationAction, type CollaborationMember, type CollaborationOrganization, type CollaborationTeam, type DirectoryPage, type DirectoryQuery, type GenerationBatch, type GenerationBatchItem, type ProjectBinding, type ProjectFolder, type ProjectGrant, type ProjectItem, type ProjectRole, type SharedProject } from "../src/shared/collaboration";
import type { TaskSnapshot } from "../src/task-observation";
import type { BatchPosition, BatchQuery } from "./generation-batches";
export const identityOf = (session: Pick<Session, "issuer" | "subject">) => `${session.issuer}|${session.subject}`;
const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;
const stable = (...parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
const ranks: Record<ProjectRole, number> = { viewer: 0, creator: 1, project_admin: 2 };
const name = (v: unknown) => { if (typeof v !== "string" || !v.trim() || [...v.trim()].length > 80 || /[\x00-\x1f\x7f]/.test(v)) throw new AuthError("invalid_display_name", 400); return v.trim(); };
const ref = (v: unknown): string => { if (typeof v !== "string" || !v || v.length > 512 || /[\x00-\x1f\x7f]/.test(v)) throw new AuthError("invalid_reference", 400); return v; };
const array = <T>(raw: string): T[] => JSON.parse(raw);

/**
 * The bound tool project a generation item writes to. With one project for the item's owner, `project_ref` may be
 * left out; with several, it must name one of them.
 */
export function targetBinding(project: Pick<SharedProject, "bindings">, item: Pick<GenerationBatchItem, "owner" | "project_ref">): ProjectBinding | null {
  const candidates = project.bindings.filter((b) => b.owner === item.owner);
  if (item.project_ref) return candidates.find((b) => b.project_ref === item.project_ref) || null;
  return candidates.length === 1 ? candidates[0]! : null;
}

const toBatch = (r: typeof batches.$inferSelect): GenerationBatch => ({ id: r.id, project_id: r.projectId, revision: r.revision, name: r.name, state: r.state, idempotency_key: r.idempotencyKey, items: array<GenerationBatchItem>(r.items), total_cost: r.totalCost, created_at: r.createdAt, updated_at: r.updatedAt });

export class CollaborationService {
  constructor(readonly db: ControlDB, private config: ServerConfig, private auth: SessionAuth, private connections: ConnectionCatalog = new ConnectionCatalog(config, db)) {}
  private member(session: Session, org: string, minimum: "member" | "admin" = "member") {
    if (typeof session.expires === "number" && session.expires <= Date.now()) throw new AuthError("session_expired", 401);
    const row = this.db.select().from(members).where(and(eq(members.organizationId, org), eq(members.identity, identityOf(session)), eq(members.status, "active"))).get();
    if (!row || (minimum === "admin" && row.role !== "admin")) throw new AuthError("collaboration_not_found", 404);
    return row;
  }
  organizations(session: Session): CollaborationOrganization[] {
    return this.db.select({ org: organizations, membership: members }).from(organizations).innerJoin(members, eq(members.organizationId, organizations.id))
      .where(and(eq(members.identity, identityOf(session)), eq(members.status, "active"))).all()
      .map(({ org, membership }) => ({ id: org.id, name: org.name, source_tenant: org.sourceTenant, revision: org.revision, role: membership.role as "admin" | "member" }));
  }
  directory(session: Session, org: string) {
    this.member(session, org);
    return { members: this.db.select().from(members).where(eq(members.organizationId, org)).all().map((r): CollaborationMember => ({ id: r.id, organization_id: org, identity: r.identity, name: r.name, role: r.role as "admin" | "member", status: r.status as "active" | "suspended", revision: r.revision })),
      teams: this.db.select().from(teams).where(eq(teams.organizationId, org)).all().map((r): CollaborationTeam => ({ id: r.id, organization_id: org, name: r.name, revision: r.revision, member_ids: array<string>(r.memberIds) })) };
  }
  candidates(session: Session, org: string) {
    this.member(session, org, "admin");
    const organization = this.db.select().from(organizations).where(eq(organizations.id, org)).get()!;
    const rows = this.knownPrincipals().filter((p) => p.scopes.some((s) => s.tenant === organization.sourceTenant));
    return rows.map((p) => ({ identity: `${p.issuer}|${p.subject}`, name: p.name }));
  }
  private knownPrincipals() {
    const local = this.config.personal;
    const all = this.config.principals.flatMap((p) => p.scopes);
    return [...this.config.principals, ...(local ? [{ issuer: "yeisme:personal", subject: local.username || "owner", name: local.name, role: local.role, scopes: all.filter((s) => local.scope_ids.includes(s.id)) }, ...(local.users || []).filter((u) => u.enabled !== false).map((u) => ({ issuer: "yeisme:personal", subject: u.username, name: u.name, role: u.role, scopes: all.filter((s) => u.scope_ids.includes(s.id)) }))] : [])];
  }
  private role(session: Session, row: typeof projects.$inferSelect): ProjectRole {
    const membership = this.member(session, row.organizationId);
    if (membership.role === "admin") return "project_admin";
    const teamIDs = this.db.select().from(teams).where(eq(teams.organizationId, row.organizationId)).all().filter((t) => array<string>(t.memberIds).includes(membership.id)).map((t) => t.id);
    const grants = array<ProjectGrant>(row.grants).filter((g) => g.subject_type === "member" ? g.subject_id === membership.id : teamIDs.includes(g.subject_id));
    if (!grants.length) throw new AuthError("collaboration_not_found", 404);
    return grants.sort((a, b) => ranks[b.role] - ranks[a.role])[0].role;
  }
  project(session: Session, projectID: string, minimum: ProjectRole = "viewer"): SharedProject {
    const row = this.db.select().from(projects).where(eq(projects.id, projectID)).get();
    if (!row) throw new AuthError("collaboration_not_found", 404);
    const role = this.role(session, row);
    if (ranks[role] < ranks[minimum]) throw new AuthError("project_permission_denied", 403);
    return { id: row.id, organization_id: row.organizationId, team_id: row.teamId, name: row.name, revision: row.revision, hidden: row.hidden, role,
      generation_enabled: row.generationEnabled, budget_cap: row.budgetCap, currency: row.budgetCurrency as "CNY" | "USD", bindings: array<ProjectBinding>(row.bindings),
      grants: role === "project_admin" ? array<ProjectGrant>(row.grants) : [], created_at: row.createdAt, updated_at: row.updatedAt };
  }
  list(session: Session, org?: string): SharedProject[] {
    const allowed = this.organizations(session).map((o) => o.id);
    if (org && !allowed.includes(org)) throw new AuthError("collaboration_not_found", 404);
    if (!allowed.length) return [];
    return this.db.select().from(projects).where(inArray(projects.organizationId, org ? [org] : allowed)).orderBy(asc(projects.name), asc(projects.id)).all().flatMap((p) => {
      try { return [this.project(session, p.id)]; } catch (e) { if (e instanceof AuthError && e.status === 404) return []; throw e; }
    });
  }
  recipients(projectID: string): string[] {
    const row = this.db.select().from(projects).where(eq(projects.id, projectID)).get();
    if (!row) return [];
    return this.db.select().from(members).where(and(eq(members.organizationId, row.organizationId), eq(members.status, "active"))).all().flatMap((m) => {
      const split = m.identity.indexOf("|");
      try { this.role({ issuer: m.identity.slice(0, split), subject: m.identity.slice(split + 1) } as Session, row); return [m.identity]; } catch { return []; }
    });
  }
  scope(session: Session, projectID: string): ScopeBinding {
    const project = this.project(session, projectID);
    const org = this.db.select().from(organizations).where(eq(organizations.id, project.organization_id)).get()!;
    const result: ScopeBinding = { id: project.id, tenant: project.organization_id, team: project.team_id || "", project: project.id, label: project.name, owners: {}, connection_ids: [] };
    result.projects = [];
    for (const binding of project.bindings) {
      // Read with the recipient's own access: the tool project must be pinned in, or connected to, the source scope.
      const source = this.auth.principal(session)?.scopes.find((s) => s.id === binding.source_scope && s.tenant === org.sourceTenant);
      const reachable = source && this.toolProjects(source).find((p) => p.owner === binding.owner && p.project_ref === binding.project_ref);
      if (!source || !reachable) continue;
      const owner = binding.owner as keyof ScopeBinding["owners"];
      // Project-wide delegated reads (members, requests, storyboards) keep the source scope's actor and audience and go
      // to one bound project per owner: the source's pinned project when it is bound, else the first bound one. They
      // never reach a project this shared project does not bind.
      const delegated = source.owners[owner];
      if (delegated && (!result.owners[owner] || binding.project_ref === delegated.project)) result.owners[owner] = { ...delegated, project: binding.project_ref };
      result.projects.push({ owner: binding.owner, project_ref: binding.project_ref, connection_ids: reachable.connection_ids });
      result.connection_ids!.push(...reachable.connection_ids.filter((c) => !result.connection_ids!.includes(c)));
    }
    return result;
  }
  /** Tool projects a scope can read: its pinned owner projects, and the project of every connection it reads. */
  toolProjects(scope: ScopeBinding): { owner: string; project_ref: string; connection_ids: string[]; pinned: boolean; registered: boolean }[] {
    const found = new Map<string, { owner: string; project_ref: string; connection_ids: string[]; pinned: boolean; registered: boolean }>();
    for (const [owner, b] of Object.entries(scope.owners)) if (b?.project) found.set(`${owner}\u0000${b.project}`, { owner, project_ref: b.project, connection_ids: [], pinned: true, registered: false });
    for (const c of this.connections.forScope(scope)) {
      const key = `${c.owner}\u0000${c.project}`;
      const entry = found.get(key) || { owner: c.owner, project_ref: c.project, connection_ids: [], pinned: false, registered: false };
      entry.connection_ids.push(c.id);
      if ("registered" in c) entry.registered = true;
      found.set(key, entry);
    }
    // Grouped by owner, the pinned project first, so pickers and saved bindings read the same way everywhere.
    return [...found.values()].sort((a, b) => a.owner.localeCompare(b.owner) || Number(b.pinned) - Number(a.pinned));
  }
  /**
   * Saved bindings: each must be one of the caller's options, matched on owner, project and source scope; connection
   * ids are rebuilt from the server's own view. Several projects of one owner are allowed, the same project once.
   */
  private normalizeBindings(session: Session, org: string, raw: unknown): ProjectBinding[] {
    if (!Array.isArray(raw) || raw.length > maxProjectBindings) throw new AuthError("invalid_project_bindings", 400);
    const options = this.bindingOptions(session, org);
    const seen = new Set<string>();
    return raw.map((b) => {
      const match = b && typeof b === "object" ? options.find((o) => o.owner === b.owner && o.project_ref === b.project_ref && o.source_scope === b.source_scope) : undefined;
      if (!match || seen.has(`${match.owner}\u0000${match.project_ref}`)) throw new AuthError("invalid_project_bindings", 400);
      seen.add(`${match.owner}\u0000${match.project_ref}`);
      return { owner: match.owner, project_ref: match.project_ref, source_scope: match.source_scope, connection_ids: match.connection_ids };
    });
  }
  bindingOptions(session: Session, org: string) {
    this.member(session, org, "admin");
    const row = this.db.select().from(organizations).where(eq(organizations.id, org)).get()!;
    return (this.auth.principal(session)?.scopes || []).filter((s) => s.tenant === row.sourceTenant).flatMap((s) => this.toolProjects(s).map((p): BindingOption => ({ ...p, source_scope: s.id })));
  }
  folders(session: Session, projectID: string): ProjectFolder[] {
    this.project(session, projectID);
    return this.db.select().from(folders).where(eq(folders.projectId, projectID)).orderBy(asc(folders.name)).all().map((f) => ({ id: f.id, project_id: f.projectId, parent_id: f.parentId, name: f.name, revision: f.revision }));
  }
  private folder(projectID: string, folderID: unknown) {
    if (folderID === null || folderID === undefined || folderID === "") return null;
    const row = this.db.select().from(folders).where(and(eq(folders.projectId, projectID), eq(folders.id, ref(folderID)))).get();
    if (!row) throw new AuthError("folder_not_found", 404);
    return row;
  }
  syncItems(session: Session, projectID: string, tasks: TaskSnapshot[]) {
    const project = this.project(session, projectID);
    this.db.transaction((tx) => {
      const batchRows = this.batches(session, projectID);
      for (const task of tasks) {
        // With several projects per owner, an item's task refs only count within its own target project.
        const fromItem = (v: GenerationBatchItem) => v.owner === task.locator.owner && (!v.project_ref || v.project_ref === task.locator.project) && v.task_refs?.includes(task.locator.task_ref);
        const sourceBatch = batchRows.find((b) => b.items.some(fromItem));
        const sourceItem = sourceBatch?.items.find(fromItem);
        const destination = sourceItem?.folder_id && this.folders(session, projectID).some((f) => f.id === sourceItem.folder_id) ? sourceItem.folder_id : null;
        if (!task.task_key || !project.bindings.some((b) => b.owner === task.locator.owner && b.project_ref === task.locator.project)) continue;
        for (const artifact of task.results) {
          const itemID = "item_" + stable(projectID, task.locator.owner, task.locator.instance_id, task.locator.task_ref, artifact.ref, artifact.version || "unversioned");
          tx.insert(items).values({ id: itemID, projectId: projectID, owner: task.locator.owner, taskSource: JSON.stringify({ connection: task.connection_id || "", project: task.locator.project, family: task.locator.task_family, ref: task.locator.task_ref }), taskKey: task.task_key, artifactRef: artifact.ref, name: artifact.name || artifact.ref,
            batchRef: sourceBatch?.id || null, folderId: destination, mime: artifact.mime || "application/octet-stream", revision: task.revision, sourceState: artifact.state || "unknown", createdAt: task.created_at || new Date().toISOString() })
            .onConflictDoUpdate({ target: items.id, set: { taskKey: task.task_key, revision: task.revision, sourceState: artifact.state || "unknown", batchRef: sourceBatch?.id || null } }).run();
        }
      }
    });
  }
  item(session: Session, projectID: string, itemID: string): ProjectItem {
    this.project(session, projectID);
    const r = this.db.select().from(items).where(and(eq(items.projectId, projectID), eq(items.id, itemID))).get();
    if (!r) throw new AuthError("item_not_found", 404);
    return this.itemView(r);
  }
  private itemView(r: typeof items.$inferSelect): ProjectItem { return { id: r.id, project_id: r.projectId, folder_id: r.folderId, owner: r.owner, task_key: r.taskKey, artifact_ref: r.artifactRef, name: r.name, mime: r.mime, revision: r.revision, batch_ref: r.batchRef, created_at: r.createdAt, source_state: r.sourceState, source: JSON.parse(r.taskSource) }; }
  items(session: Session, projectID: string, q: DirectoryQuery): DirectoryPage<ProjectItem> {
    this.project(session, projectID);
    const limit = q.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (q.q?.length || 0) > 200) throw new AuthError("invalid_query", 400);
    const allowed = this.scope(session, projectID);
    const filters = [eq(items.projectId, projectID), or(...(allowed.projects || []).map((b) => and(eq(items.owner, b.owner), sql`json_extract(${items.taskSource}, '$.project') = ${b.project_ref}`))) || sql`0 = 1`];
    if (q.q) filters.push(sql`instr(lower(${items.name}), lower(${q.q})) > 0`);
    for (const [value, column] of [[q.owner, items.owner], [q.state, items.sourceState]] as const) if (value) filters.push(inArray(column, value.split(",")));
    if (q.kind) filters.push(or(...q.kind.split(",").map((k) => like(items.mime, `${k}/%`)))!);
    if (q.folder === "unfiled") filters.push(sql`${items.folderId} IS NULL`);
    else if (q.folder) { this.folder(projectID, q.folder); filters.push(eq(items.folderId, q.folder)); }
    if (q.batch) filters.push(eq(items.batchRef, q.batch));

    for (const date of [q.from, q.to]) if (date && !Number.isFinite(Date.parse(date))) throw new AuthError("invalid_query", 400);
    if (q.from) filters.push(sql`${items.createdAt} >= ${q.from}`);
    if (q.to) filters.push(sql`${items.createdAt} < ${new Date(Date.parse(q.to) + 86400000).toISOString()}`);
    const rows = this.db.select().from(items).where(and(...filters, q.cursor ? gt(items.id, ref(q.cursor)) : undefined)).orderBy(asc(items.id)).limit(limit + 1).all();
    const count = this.db.select({ n: sql<number>`count(*)` }).from(items).where(and(...filters.filter((f) => f !== undefined))).get()?.n || 0;
    return { rows: rows.slice(0, limit).map((r) => this.itemView(r)), next_cursor: rows.length > limit ? rows[limit - 1].id : null, total: count, coverage: "partial" };
  }
  batches(session: Session, projectID: string): GenerationBatch[] {
    this.project(session, projectID);
    return this.db.select().from(batches).where(eq(batches.projectId, projectID)).all().map(toBatch);
  }
  /** One batch of a project, or undefined; the project must be visible to the session. */
  batch(session: Session, projectID: string, batchID: string): GenerationBatch | undefined {
    this.project(session, projectID);
    const row = this.db.select().from(batches).where(and(eq(batches.projectId, projectID), eq(batches.id, batchID))).get();
    return row && toBatch(row);
  }
  /**
   * One page of a project's batches after `after`, newest first (`created_at DESC, id DESC`), with how many match in all.
   * Filtered, ordered and counted in SQL, so a poll parses only the page it returns, not the project's whole history.
   */
  batchPage(session: Session, projectID: string, query: BatchQuery, after?: BatchPosition): { rows: GenerationBatch[]; total: number; next?: BatchPosition } {
    this.project(session, projectID);
    const filters: SQL[] = [eq(batches.projectId, projectID)];
    // A batch id typed into the search finds that batch even when its name does not match.
    if (query.q) filters.push(or(sql`instr(lower(${batches.name}), ${query.q.toLowerCase()}) > 0`, eq(batches.id, query.q))!);
    if (query.states) filters.push(inArray(batches.state, query.states));
    if (query.owners) filters.push(sql`exists (select 1 from json_each(${batches.items}) where json_extract(json_each.value, '$.owner') in (${sql.join(query.owners.map((owner) => sql`${owner}`), sql`, `)}))`);
    if (query.from) filters.push(sql`${batches.createdAt} >= ${query.from}`);
    if (query.to) filters.push(lt(batches.createdAt, query.to));
    const total = Number(this.db.select({ n: sql<number>`count(*)` }).from(batches).where(and(...filters)).get()?.n || 0);
    if (after) filters.push(or(lt(batches.createdAt, after.created_at), and(eq(batches.createdAt, after.created_at), lt(batches.id, after.id)))!);
    const found = this.db.select().from(batches).where(and(...filters)).orderBy(desc(batches.createdAt), desc(batches.id)).limit(query.limit + 1).all().map(toBatch);
    const rows = found.slice(0, query.limit);
    const last = rows[rows.length - 1];
    return { rows, total, next: found.length > query.limit && last ? { created_at: last.created_at, id: last.id } : undefined };
  }
  authorize(session: Session, action: CollaborationAction, target: string, input: Record<string, unknown>) {
    if (session.expires <= Date.now()) throw new AuthError("session_expired", 401);
    if (action === "organization.create") {
      if (this.auth.role(session) !== "admin") throw new AuthError("control_center_admin_required", 403);
      return;
    }
    if (action === "organization.member.set" || action.startsWith("team.") || action === "project.create") { this.member(session, target, "admin"); return; }
    this.project(session, target, action.startsWith("project.") ? "project_admin" : "creator");
    if (action === "generation.batch.submit") {
      const p = this.project(session, target, "creator");
      if (!p.generation_enabled || p.budget_cap <= 0 || !p.bindings.length) throw new AuthError("project_generation_disabled", 403);
    }
    if (action === "project.bindings.set") this.member(session, this.project(session, target).organization_id, "admin");
  }
  execute(session: Session, action: CollaborationAction, target: string, expected: string, input: Record<string, unknown>): string[] {
    this.authorize(session, action, target, input);
    return this.db.transaction(() => this.mutate(session, action, target, expected, input));
  }
  private mutate(session: Session, action: CollaborationAction, target: string, expected: string, input: Record<string, unknown>): string[] {
    const now = new Date().toISOString();
    if (action === "organization.create") {
      const scope = this.auth.principal(session)?.scopes.find((s) => s.id === input.source_scope);
      if (!scope) throw new AuthError("scope_not_found", 404);
      const org = id("org");
      this.db.insert(organizations).values({ id: org, name: name(input.name), sourceTenant: scope.tenant, createdAt: now }).run();
      this.db.insert(members).values({ id: id("member"), organizationId: org, identity: identityOf(session), name: session.name, role: "admin" }).run();
      return [org];
    }
    if (action === "organization.member.set") {
      const candidates = this.candidates(session, target);
      const candidate = candidates.find((p) => p.identity === input.identity);
      if (!candidate || !["admin", "member"].includes(String(input.role)) || !["active", "suspended"].includes(String(input.status))) throw new AuthError("invalid_member", 400);
      const current = this.db.select().from(members).where(and(eq(members.organizationId, target), eq(members.identity, candidate.identity))).get();
      if (String(current?.revision || 0) !== expected) throw new AuthError("revision_conflict", 409);
      if (current?.role === "admin" && current.status === "active" && (input.role !== "admin" || input.status !== "active")) {
        const admins = this.db.select().from(members).where(and(eq(members.organizationId, target), eq(members.role, "admin"), eq(members.status, "active"))).all();
        if (admins.length <= 1) throw new AuthError("last_organization_admin", 409);
      }
      const memberID = current?.id || id("member");
      this.db.insert(members).values({ id: memberID, organizationId: target, identity: candidate.identity, name: candidate.name, role: String(input.role), status: String(input.status) })
        .onConflictDoUpdate({ target: members.id, set: { role: String(input.role), status: String(input.status), revision: (current?.revision || 0) + 1 } }).run();
      this.auth.sessions.bumpAll();
      return [memberID];
    }
    if (action === "team.create") {
      const teamID = id("team"); this.db.insert(teams).values({ id: teamID, organizationId: target, name: name(input.name) }).run(); return [teamID];
    }
    if (action === "team.members.set") {
      const team = this.db.select().from(teams).where(and(eq(teams.organizationId, target), eq(teams.id, ref(input.team_id)))).get();
      if (!team) throw new AuthError("team_not_found", 404);
      if (String(team.revision) !== expected) throw new AuthError("revision_conflict", 409);
      const ids = input.member_ids;
      if (!Array.isArray(ids) || ids.length > 200 || ids.some((v) => !this.directory(session, target).members.some((m) => m.id === v && m.status === "active"))) throw new AuthError("invalid_members", 400);
      this.db.update(teams).set({ memberIds: JSON.stringify([...new Set(ids)]), revision: team.revision + 1 }).where(eq(teams.id, team.id)).run(); this.auth.sessions.bumpAll(); return [team.id];
    }
    if (action === "project.create") {
      const actorMember = this.member(session, target, "admin");
      const member = input.admin_member_id ? this.directory(session, target).members.find((m) => m.id === input.admin_member_id && m.status === "active") : actorMember;
      if (!member) throw new AuthError("invalid_project_administrator", 400);
      const initialBindings = this.normalizeBindings(session, target, input.bindings || []);
      const projectID = id("project");
      const team = input.team_id ? this.directory(session, target).teams.find((t) => t.id === input.team_id) : null;
      if (input.team_id && !team) throw new AuthError("team_not_found", 404);
      this.db.insert(projects).values({ id: projectID, organizationId: target, teamId: team?.id || null, name: name(input.name), bindings: JSON.stringify(initialBindings),
        grants: JSON.stringify([{ subject_type: "member", subject_id: member.id, role: "project_admin" }]), createdAt: now, updatedAt: now }).run();
      return [projectID];
    }
    const p = this.project(session, target);
    if (String(p.revision) !== expected) throw new AuthError("revision_conflict", 409);
    const updateProject = (changes: Partial<typeof projects.$inferInsert>) => this.db.update(projects).set({ ...changes, revision: p.revision + 1, updatedAt: now }).where(and(eq(projects.id, target), eq(projects.revision, p.revision))).run();
    if (action === "project.update") {
      const changes: Partial<typeof projects.$inferInsert> = {};
      if (input.name !== undefined) changes.name = name(input.name);
      if (input.hidden !== undefined) { if (typeof input.hidden !== "boolean") throw new AuthError("invalid_input", 400); changes.hidden = input.hidden; }
      if (input.generation_enabled !== undefined || input.budget_cap !== undefined || input.currency !== undefined) {
        this.member(session, p.organization_id, "admin");
        if (input.generation_enabled !== undefined && typeof input.generation_enabled !== "boolean") throw new AuthError("invalid_generation_policy", 400);
        if (input.budget_cap !== undefined && (typeof input.budget_cap !== "number" || !Number.isFinite(input.budget_cap) || input.budget_cap < 0)) throw new AuthError("invalid_generation_policy", 400);
        const reserved = this.batches(session, target).filter((b) => !["planned", "blocked"].includes(b.state));
        if (input.currency !== undefined && input.currency !== p.currency && reserved.length) throw new AuthError("project_budget_currency_in_use", 409);
        if (typeof input.budget_cap === "number" && input.budget_cap < reserved.reduce((n, b) => n + (b.total_cost || 0), 0)) throw new AuthError("project_budget_below_reserved", 409);
        if (input.currency !== undefined) { if (!["CNY", "USD"].includes(String(input.currency))) throw new AuthError("invalid_currency", 400); changes.budgetCurrency = String(input.currency); }
        changes.generationEnabled = input.generation_enabled as boolean | undefined; changes.budgetCap = input.budget_cap as number | undefined;
      }
      updateProject(changes); this.auth.sessions.bumpAll(); return [p.id];
    }
    if (action === "project.members.set") {
      const directory = this.directory(session, p.organization_id); const grants = input.grants as ProjectGrant[];
      if (!Array.isArray(grants) || grants.length > 200 || grants.some((g) => !g || !(g.role in ranks) || !(g.subject_type === "member" ? directory.members.some((m) => m.id === g.subject_id && m.status === "active") : g.subject_type === "team" && directory.teams.some((t) => t.id === g.subject_id)))) throw new AuthError("invalid_project_grants", 400);
      const ownMember = this.member(session, p.organization_id);
      if (ownMember.role !== "admin" && JSON.stringify(grants.filter((g) => g.subject_type === "member" && g.subject_id === ownMember.id)) !== JSON.stringify(p.grants.filter((g) => g.subject_type === "member" && g.subject_id === ownMember.id))) throw new AuthError("self_grant_change_denied", 403);
      updateProject({ grants: JSON.stringify(grants) }); this.auth.sessions.bumpAll(); return [p.id];
    }
    if (action === "project.bindings.set") {
      const selected = this.normalizeBindings(session, p.organization_id, input.bindings);
      updateProject({ bindings: JSON.stringify(selected) }); this.auth.sessions.bumpAll(); return [p.id];
    }
    if (action === "folder.create") {
      const parent = this.folder(target, input.parent_id); const folderID = id("folder");
      this.db.insert(folders).values({ id: folderID, projectId: target, parentId: parent?.id || null, name: name(input.name) }).run(); return [folderID];
    }
    if (action === "folder.rename") {
      const folder = this.folder(target, input.folder_id)!;
      if (!folder || String(folder.revision) !== String(input.folder_revision)) throw new AuthError("folder_revision_conflict", 409);
      this.db.update(folders).set({ name: name(input.name), revision: folder.revision + 1 }).where(eq(folders.id, folder.id)).run(); return [folder.id];
    }
    if (action === "item.move") {
      const folder = this.folder(target, input.folder_id); const ids = input.item_ids;
      if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw new AuthError("invalid_items", 400);
      for (const itemID of ids) this.item(session, target, ref(itemID));
      this.db.update(items).set({ folderId: folder?.id || null }).where(and(eq(items.projectId, target), inArray(items.id, ids as string[]))).run(); return ids as string[];
    }
    if (action === "generation.batch.create") {
      const values = input.items as GenerationBatchItem[];
      if (!Array.isArray(values) || !values.length || values.length > 50) throw new AuthError("invalid_generation_batch", 400);
      for (const v of values) {
        if (!v || !["eikona", "scaena"].includes(v.owner) || !["image", "video"].includes(v.modality) || !Number.isInteger(v.candidate_count) || v.candidate_count < 1 || v.candidate_count > 16 || !targetBinding(p, v)) throw new AuthError("invalid_generation_item", 400);
        ref(v.model_ref); ref(v.input_ref); for (const d of [v.input_digest, v.plan_digest]) if (!/^sha256:[a-f0-9]{64}$/.test(d)) throw new AuthError("invalid_generation_digest", 400);
        this.folder(target, v.folder_id);
      }
      const total = values.every((v) => typeof v.estimated_cost === "number" && Number.isFinite(v.estimated_cost) && v.estimated_cost >= 0 && v.currency === p.currency) ? values.reduce((sum, v) => sum + v.estimated_cost!, 0) : null;
      const batchID = id("batch");
      this.db.insert(batches).values({ id: batchID, projectId: target, name: name(input.name), state: "planned", idempotencyKey: ref(input.idempotency_key), items: JSON.stringify(values.map((v) => ({ ...v, operation_ref: undefined }))), totalCost: total, createdAt: now, updatedAt: now }).run(); return [batchID];
    }
    throw new AuthError("generation_owner_contract_required", 422);
  }

  /** Explicit migration command only; never called by reads or application startup. */
  importLegacy(dryRun = true) {
    const known = this.knownPrincipals();
    const scopes = new Map<string, ScopeBinding>();
    const ambiguous = new Set<string>();
    for (const p of known) for (const s of p.scopes) { if (scopes.has(s.id) && JSON.stringify(scopes.get(s.id)) !== JSON.stringify(s)) ambiguous.add(s.id); else scopes.set(s.id, s); }
    for (const scope of scopes.values()) if (!known.some((p) => p.role === "admin" && p.scopes.some((s) => s.id === scope.id))) ambiguous.add(scope.id);
    const summary = { organizations: 0, projects: 0, unresolved_scopes: [...ambiguous] };
    if (dryRun) return { ...summary, organizations: new Set([...scopes.values()].filter((s) => !ambiguous.has(s.id)).map((s) => `${s.tenant}|${s.id}`)).size, projects: [...scopes.keys()].filter((s) => !ambiguous.has(s)).length, dry_run: true };
    this.db.transaction(() => {
      for (const scope of scopes.values()) {
        if (ambiguous.has(scope.id)) continue;
        const orgID = "org_legacy_" + stable(scope.tenant, scope.id); const now = new Date().toISOString();
        const allowed = known.filter((p) => p.scopes.some((s) => s.id === scope.id));
        if (!allowed.some((p) => p.role === "admin")) { summary.unresolved_scopes.push(scope.id); continue; }
        this.db.insert(organizations).values({ id: orgID, name: scope.tenant, sourceTenant: scope.tenant, createdAt: now }).onConflictDoNothing().run();
        for (const principal of allowed) {
          const identity = `${principal.issuer}|${principal.subject}`;
          this.db.insert(members).values({ id: "member_legacy_" + stable(orgID, identity), organizationId: orgID, identity, name: principal.name, role: principal.role === "admin" ? "admin" : "member" }).onConflictDoNothing().run();
        }
        const projectID = "project_legacy_" + stable(scope.tenant, scope.id);
        const aliases = this.db.select().from(projectMetadata).where(eq(projectMetadata.scopeId, scope.id)).all();
        // One binding per pinned owner project, as before; connected projects can be bound later from the UI.
        const bindings = this.toolProjects(scope).filter((p) => p.pinned).map((p) => ({ owner: p.owner, project_ref: p.project_ref, source_scope: scope.id, connection_ids: p.connection_ids }));
        this.db.insert(projects).values({ id: projectID, organizationId: orgID, name: aliases.length === 1 && aliases[0].displayName || scope.label,
          bindings: JSON.stringify(bindings), grants: JSON.stringify(allowed.map((p) => ({ subject_type: "member", subject_id: "member_legacy_" + stable(orgID, `${p.issuer}|${p.subject}`), role: p.role === "admin" ? "project_admin" : "viewer" }))), createdAt: now, updatedAt: now }).onConflictDoNothing().run();
        summary.projects++;
      }
    });
    summary.organizations = this.db.select().from(organizations).all().length;
    return { ...summary, dry_run: false };
  }
}
