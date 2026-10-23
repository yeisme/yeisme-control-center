import { sql } from "drizzle-orm";
import {
  index,
  uniqueIndex,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// Control-center owned state only. Owner domain state stays in the owners.
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    name: text("name").notNull(),
    csrf: text("csrf").notNull(),
    accessToken: text("access_token").notNull().default(""),
    accessAudience: text("access_audience").notNull().default("[]"),
    expires: integer("expires").notNull(),
    personal: integer("personal", { mode: "boolean" }).notNull().default(false),
    lastSeen: integer("last_seen"),
    credentialVersion: text("credential_version"),
    epoch: integer("epoch").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("sessions_subject_idx").on(t.issuer, t.subject)],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    occurredAt: text("occurred_at").notNull(),
    actor: text("actor").notNull(),
    sessionId: text("session_id"),
    scopeId: text("scope_id"),
    action: text("action").notNull(),
    owner: text("owner"),
    targetRef: text("target_ref"),
    purpose: text("purpose"),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    meta: text("meta"),
  },
  (t) => [
    index("audit_action_idx").on(t.action),
    index("audit_occurred_idx").on(t.occurredAt),
  ],
);

export const providerRuns = sqliteTable(
  "provider_runs",
  {
    runRef: text("run_ref").primaryKey(),
    owner: text("owner").notNull(),
    modality: text("modality").notNull(),
    modelRef: text("model_ref").notNull(),
    scopeId: text("scope_id").notNull(),
    projectRef: text("project_ref").notNull(),
    traceRef: text("trace_ref").notNull(),
    sourceRef: text("source_ref"),
    state: text("state").notNull(),
    outputRefs: text("output_refs").notNull().default("[]"),
    upstreamCost: real("upstream_cost"),
    currency: text("currency").notNull().default("CNY"),
    costState: text("cost_state").notNull().default("unknown"),
    observedAt: text("observed_at").notNull(),
    createdAt: text("created_at").notNull(),
    evidenceRefs: text("evidence_refs").notNull().default("[]"),
    errorCode: text("error_code"),
    connectionState: text("connection_state").notNull().default("configured"),
    budgetReserved: real("budget_reserved").notNull().default(0),
  },
  (t) => [
    index("runs_state_idx").on(t.state),
    index("runs_project_idx").on(t.projectRef),
  ],
);

export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceKey: text("source_key").notNull().unique(),
    sourceRef: text("source_ref").notNull(),
    traceRef: text("trace_ref").notNull(),
    owner: text("owner").notNull(),
    modelRef: text("model_ref").notNull(),
    modality: text("modality").notNull(),
    quantity: integer("quantity"),
    unit: text("unit").notNull(),
    upstreamCost: real("upstream_cost"),
    currency: text("currency").notNull().default("CNY"),
    costState: text("cost_state").notNull().default("unknown"),
    status: text("status").notNull(),
    projectRef: text("project_ref").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("usage_project_idx").on(t.projectRef)],
);

/** In-app failure reminders. Owner task bodies are not copied here. */
export const taskNotifications = sqliteTable(
  "task_notifications",
  {
    id: text("id").primaryKey(),
    scopeId: text("scope_id").notNull(),
    sessionId: text("session_id").notNull(),
    subject: text("subject").notNull(),
    taskKey: text("task_key").notNull(),
    taskRevision: text("task_revision").notNull().default(""),
    failureFingerprint: text("failure_fingerprint").notNull(),
    state: text("state").notNull().default("unread"),
    priority: text("priority").notNull().default("normal"),
    presence: text("presence").notNull().default("live"),
    taskState: text("task_state").notNull().default(""),
    nativeState: text("native_state").notNull().default(""),
    title: text("title").notNull().default(""),
    owner: text("owner").notNull().default(""),
    project: text("project").notNull().default(""),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    acknowledgedAt: text("acknowledged_at"),
    mutedAt: text("muted_at"),
    archivedAt: text("archived_at"),
    snoozedUntil: text("snoozed_until"),
    lastErrorCode: text("last_error_code").notNull().default(""),
    reopened: integer("reopened", { mode: "boolean" }).notNull().default(false),
    category: text("category").notNull().default("failure"),
    readAt: text("read_at"),
    targetPath: text("target_path"),
  },
  (t) => [
    index("notifications_scope_session_idx").on(t.scopeId, t.sessionId, t.subject),
    index("notifications_fingerprint_idx").on(t.sessionId, t.failureFingerprint),
    index("notifications_task_idx").on(t.scopeId, t.taskKey),
  ],
);

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  key: text("key").primaryKey(),
  runRef: text("run_ref").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(
    () => new Date().toISOString(),
  ),
});

export const auctraCollectionRecords = sqliteTable(
  "auctra_collection_records",
  {
    id: text("id").primaryKey(),
    scopeId: text("scope_id").notNull(),
    recordRef: text("record_ref").notNull(),
    recordKind: text("record_kind").notNull(),
    projectRef: text("project_ref").notNull(),
    workRef: text("work_ref"),
    unitRef: text("unit_ref"),
    candidateRef: text("candidate_ref"),
    reviewRef: text("review_ref"),
    versionRef: text("version_ref"),
    runRef: text("run_ref"),
    kind: text("kind"),
    title: text("title"),
    sourceRevision: text("source_revision"),
    sourceDigest: text("source_digest"),
    sourceState: text("source_state").notNull().default("fresh"),
    reviewState: text("review_state"),
    status: text("status"),
    evidenceRefs: text("evidence_refs").notNull().default("[]"),
    createdAt: text("created_at"),
    sourceUpdatedAt: text("source_updated_at"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    collectionState: text("collection_state").notNull().default("active"),
    metadataRevision: integer("metadata_revision").notNull().default(1),
  },
  (t) => [
    index("auctra_collection_scope_idx").on(t.scopeId, t.lastSeenAt),
    index("auctra_collection_kind_idx").on(t.scopeId, t.recordKind),
    index("auctra_collection_state_idx").on(t.scopeId, t.collectionState),
  ],
);

export const auctraCollectionMetadata = sqliteTable("auctra_collection_metadata", {
  id: text("id").primaryKey(),
  scopeId: text("scope_id").notNull(),
  recordRef: text("record_ref").notNull(),
  confirmedAt: text("confirmed_at"),
  confirmedBy: text("confirmed_by"),
  archivedAt: text("archived_at"),
  archivedBy: text("archived_by"),
  labels: text("labels").notNull().default("[]"),
  note: text("note").notNull().default(""),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
}, (t) => [index("auctra_collection_metadata_scope_idx").on(t.scopeId, t.recordRef)]);

export const auctraCollectionCursors = sqliteTable("auctra_collection_cursors", {
  id: text("id").primaryKey(),
  scopeId: text("scope_id").notNull(),
  bindingFingerprint: text("binding_fingerprint").notNull(),
  cursor: text("cursor").notNull().default(""),
  sourceSnapshotDigest: text("source_snapshot_digest").notNull().default(""),
  lastSuccessAt: text("last_success_at"),
  coverage: text("coverage").notNull().default("unknown"),
  reason: text("reason"),
}, (t) => [index("auctra_collection_cursor_scope_idx").on(t.scopeId, t.bindingFingerprint)]);

/** Control-center-only project labels and visibility; owner project state stays remote. */
export const projectMetadata = sqliteTable(
  "project_metadata",
  {
    id: text("id").primaryKey(),
    scopeId: text("scope_id").notNull(),
    owner: text("owner").notNull(),
    projectRef: text("project_ref").notNull(),
    displayName: text("display_name").notNull().default(""),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    revision: integer("revision").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by").notNull(),
  },
  (t) => [
    index("project_metadata_scope_project_idx").on(t.scopeId, t.owner, t.projectRef),
  ],
);

export const schemaVersion = sql`-- schema managed by drizzle-kit; see server/db/migrations`;

/** Control-center observations of owner catalog entries: ids and digests only, never schemas or bodies. */
export const toolCatalogEntries = sqliteTable(
  "tool_catalog_entries",
  {
    id: text("id").primaryKey(),
    scopeId: text("scope_id").notNull(),
    owner: text("owner").notNull(),
    kind: text("kind").notNull(),
    entryId: text("entry_id").notNull(),
    digest: text("digest").notNull(),
    baseline: integer("baseline", { mode: "boolean" }).notNull().default(false),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    changedAt: text("changed_at"),
    removedAt: text("removed_at"),
  },
  (t) => [index("tool_catalog_scope_idx").on(t.scopeId, t.owner, t.kind)],
);

/** First complete read of an owner entry kind; entries seen then are a baseline, not "added". */
export const toolCatalogBaselines = sqliteTable("tool_catalog_baselines", {
  id: text("id").primaryKey(),
  scopeId: text("scope_id").notNull(),
  owner: text("owner").notNull(),
  kind: text("kind").notNull(),
  establishedAt: text("established_at").notNull(),
});

export const collaborationOrganizations = sqliteTable("collaboration_organizations", {
  id: text("id").primaryKey(), name: text("name").notNull(), sourceTenant: text("source_tenant").notNull(),
  revision: integer("revision").notNull().default(1), createdAt: text("created_at").notNull(),
});
export const collaborationMembers = sqliteTable("collaboration_members", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull(), identity: text("identity").notNull(),
  name: text("name").notNull(), role: text("role").notNull(), status: text("status").notNull().default("active"), revision: integer("revision").notNull().default(1),
}, (t) => [uniqueIndex("collaboration_member_identity_idx").on(t.organizationId, t.identity)]);
export const collaborationTeams = sqliteTable("collaboration_teams", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull(), name: text("name").notNull(),
  revision: integer("revision").notNull().default(1), memberIds: text("member_ids").notNull().default("[]"),
});
export const collaborationProjects = sqliteTable("collaboration_projects", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull(), teamId: text("team_id"),
  name: text("name").notNull(), revision: integer("revision").notNull().default(1), hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  generationEnabled: integer("generation_enabled", { mode: "boolean" }).notNull().default(false), budgetCap: real("budget_cap").notNull().default(0),
  budgetCurrency: text("budget_currency").notNull().default("CNY"),
  bindings: text("bindings").notNull().default("[]"), grants: text("grants").notNull().default("[]"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [index("collaboration_projects_org_idx").on(t.organizationId)]);
export const collaborationFolders = sqliteTable("collaboration_folders", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull(), parentId: text("parent_id"), name: text("name").notNull(), revision: integer("revision").notNull().default(1),
}, (t) => [index("collaboration_folder_project_idx").on(t.projectId)]);
export const collaborationItems = sqliteTable("collaboration_items", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull(), folderId: text("folder_id"), owner: text("owner").notNull(),
  taskSource: text("task_source").notNull().default("{}"), taskKey: text("task_key").notNull(), artifactRef: text("artifact_ref").notNull(), name: text("name").notNull(), mime: text("mime").notNull(),
  revision: text("revision").notNull(), batchRef: text("batch_ref"), createdAt: text("created_at").notNull(), sourceState: text("source_state").notNull(),
}, (t) => [index("collaboration_items_project_idx").on(t.projectId, t.id)]);
export const collaborationBatches = sqliteTable("collaboration_batches", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull(), name: text("name").notNull(), state: text("state").notNull(),
  revision: integer("revision").notNull().default(1), idempotencyKey: text("idempotency_key").notNull(), items: text("items").notNull(),
  totalCost: real("total_cost"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [uniqueIndex("collaboration_batch_key_idx").on(t.projectId, t.idempotencyKey)]);
export const actionRecords = sqliteTable("action_records", {
  id: text("id").primaryKey(), context: text("context").notNull(), key: text("key").notNull(), requestDigest: text("request_digest").notNull(),
  request: text("request").notNull(), preview: text("preview").notNull(), createdAt: integer("created_at").notNull(),
  started: integer("started", { mode: "boolean" }).notNull().default(false), receipt: text("receipt"),
}, (t) => [uniqueIndex("action_context_key_idx").on(t.context, t.key)]);
