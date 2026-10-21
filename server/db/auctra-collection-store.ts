import { and, asc, desc, eq } from "drizzle-orm";
import type { AuctraCollectionRecord, AuctraCollectionSnapshot } from "../auctra";
import type { ControlDB } from "./client";
import { auctraCollectionCursors, auctraCollectionMetadata, auctraCollectionRecords } from "./schema";
import { AuthError } from "../auth";

const listValue = (value: string): string[] => {
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 20) : []; } catch { return []; }
};
const idFor = (scopeId: string, recordRef: string) => `${scopeId}:${recordRef}`;

export interface AuctraCollectionRecordView extends AuctraCollectionRecord {
  collection_state: "active" | "confirmed" | "archived";
  source_state: "fresh" | "stale" | "unknown";
  metadata_revision: number;
  labels: string[];
  note: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  archived_at: string | null;
  archived_by: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

type Row = typeof auctraCollectionRecords.$inferSelect;
type Meta = typeof auctraCollectionMetadata.$inferSelect;

function view(row: Row, metadata?: Meta): AuctraCollectionRecordView {
  const stale = Date.now() - Date.parse(row.lastSeenAt) > 5 * 60 * 1000;
  return {
    record_ref: row.recordRef,
    record_kind: row.recordKind,
    project_ref: row.projectRef,
    ...(row.workRef ? { work_ref: row.workRef } : {}),
    ...(row.unitRef ? { unit_ref: row.unitRef } : {}),
    ...(row.candidateRef ? { candidate_ref: row.candidateRef } : {}),
    ...(row.reviewRef ? { review_ref: row.reviewRef } : {}),
    ...(row.versionRef ? { version_ref: row.versionRef } : {}),
    ...(row.runRef ? { run_ref: row.runRef } : {}),
    ...(row.kind ? { kind: row.kind } : {}),
    ...(row.title ? { title: row.title } : {}),
    ...(row.status ? { status: row.status } : {}),
    ...(row.sourceRevision ? { source_revision: row.sourceRevision } : {}),
    ...(row.sourceDigest ? { source_digest: row.sourceDigest } : {}),
    ...(row.createdAt ? { created_at: row.createdAt } : {}),
    ...(row.sourceUpdatedAt ? { updated_at: row.sourceUpdatedAt } : {}),
    ...(listValue(row.evidenceRefs).length ? { evidence_refs: listValue(row.evidenceRefs) } : {}),
    collection_state: (row.collectionState || "active") as AuctraCollectionRecordView["collection_state"],
    source_state: (stale ? "stale" : row.sourceState || "unknown") as AuctraCollectionRecordView["source_state"],
    metadata_revision: row.metadataRevision,
    labels: listValue(metadata?.labels || "[]"),
    note: metadata?.note || "",
    confirmed_at: metadata?.confirmedAt || null,
    confirmed_by: metadata?.confirmedBy || null,
    archived_at: metadata?.archivedAt || null,
    archived_by: metadata?.archivedBy || null,
    first_seen_at: row.firstSeenAt,
    last_seen_at: row.lastSeenAt,
  };
}

export class AuctraCollectionStore {
  constructor(private db: ControlDB) {}

  upsertSnapshot(scopeId: string, snapshot: AuctraCollectionSnapshot, now = new Date().toISOString()) {
    let inserted = 0, updated = 0;
    for (const record of snapshot.records) {
      const id = idFor(scopeId, record.record_ref);
      const existing = this.db.select({ id: auctraCollectionRecords.id }).from(auctraCollectionRecords).where(eq(auctraCollectionRecords.id, id)).get();
      const values = {
        id, scopeId, recordRef: record.record_ref, recordKind: record.record_kind, projectRef: record.project_ref,
        workRef: record.work_ref || null, unitRef: record.unit_ref || null, candidateRef: record.candidate_ref || null,
        reviewRef: record.review_ref || null, versionRef: record.version_ref || null, runRef: record.run_ref || null,
        kind: record.kind || null, title: record.title || null, sourceRevision: record.source_revision || null,
        sourceDigest: record.source_digest || null, sourceState: snapshot.freshness === "stale" ? "stale" : "fresh",
        reviewState: record.record_kind === "review" ? record.status || null : null, status: record.status || null,
        evidenceRefs: JSON.stringify(record.evidence_refs || []), createdAt: record.created_at || null,
        sourceUpdatedAt: record.updated_at || null, firstSeenAt: existing ? undefined : now, lastSeenAt: now,
      };
      if (existing) {
        this.db.update(auctraCollectionRecords).set({ ...values, firstSeenAt: undefined }).where(eq(auctraCollectionRecords.id, id)).run();
        updated++;
      } else {
        this.db.insert(auctraCollectionRecords).values({ ...values, firstSeenAt: now }).run();
        this.db.insert(auctraCollectionMetadata).values({ id, scopeId, recordRef: record.record_ref, updatedAt: now, updatedBy: "system:collection" }).run();
        inserted++;
      }
    }
    return { inserted, updated, returned: snapshot.records.length, total: snapshot.total };
  }

  list(scopeId: string, filters: { recordKind?: string; collectionState?: string; sourceState?: string; label?: string; projectRef?: string; from?: string; to?: string; limit?: number; cursor?: number } = {}) {
    const clauses = [eq(auctraCollectionRecords.scopeId, scopeId)];
    if (filters.recordKind) clauses.push(eq(auctraCollectionRecords.recordKind, filters.recordKind));
    if (filters.collectionState) clauses.push(eq(auctraCollectionRecords.collectionState, filters.collectionState));
    if (filters.projectRef) clauses.push(eq(auctraCollectionRecords.projectRef, filters.projectRef));
    const rows = this.db.select().from(auctraCollectionRecords).where(and(...clauses)).orderBy(desc(auctraCollectionRecords.lastSeenAt), asc(auctraCollectionRecords.recordRef)).all();
    const metadata = this.db.select().from(auctraCollectionMetadata).where(eq(auctraCollectionMetadata.scopeId, scopeId)).all();
    const byRef = new Map(metadata.map((item) => [item.recordRef, item]));
    const filtered = rows.map((row) => view(row, byRef.get(row.recordRef))).filter((item) => (!filters.sourceState || item.source_state === filters.sourceState) && (!filters.label || item.labels.includes(filters.label)) && (!filters.from || item.last_seen_at >= filters.from) && (!filters.to || item.last_seen_at <= filters.to));
    const offset = filters.cursor || 0;
    const limit = Math.min(Math.max(filters.limit || 50, 1), 100);
    return { rows: filtered.slice(offset, offset + limit), total: filtered.length, nextCursor: offset + limit < filtered.length ? offset + limit : undefined };
  }

  coverage(scopeId: string): { state: "complete" | "stale" | "unknown"; observed_at?: string } {
    const rows = this.db.select({ lastSeenAt: auctraCollectionRecords.lastSeenAt, sourceState: auctraCollectionRecords.sourceState }).from(auctraCollectionRecords).where(eq(auctraCollectionRecords.scopeId, scopeId)).all();
    if (!rows.length) return { state: "unknown" };
    const observed = rows.map((row) => row.lastSeenAt).sort().at(-1);
    const stale = rows.some((row) => row.sourceState === "stale") || (observed ? Date.now() - Date.parse(observed) > 5 * 60 * 1000 : true);
    return { state: stale ? "stale" : "complete", observed_at: observed };
  }

  get(scopeId: string, recordRef: string): AuctraCollectionRecordView {
    const row = this.db.select().from(auctraCollectionRecords).where(and(eq(auctraCollectionRecords.scopeId, scopeId), eq(auctraCollectionRecords.recordRef, recordRef))).get();
    if (!row) throw new AuthError("collection_record_not_found", 404);
    const metadata = this.db.select().from(auctraCollectionMetadata).where(and(eq(auctraCollectionMetadata.scopeId, scopeId), eq(auctraCollectionMetadata.recordRef, recordRef))).get();
    return view(row, metadata);
  }

  private mutate(scopeId: string, recordRef: string, expectedRevision: string, actor: string, change: (meta: Meta) => Partial<Meta>) {
    const row = this.db.select().from(auctraCollectionRecords).where(and(eq(auctraCollectionRecords.scopeId, scopeId), eq(auctraCollectionRecords.recordRef, recordRef))).get();
    if (!row) throw new AuthError("collection_record_not_found", 404);
    const meta = this.db.select().from(auctraCollectionMetadata).where(and(eq(auctraCollectionMetadata.scopeId, scopeId), eq(auctraCollectionMetadata.recordRef, recordRef))).get();
    if (!meta) throw new AuthError("collection_metadata_not_found", 503);
    const expected = Number(expectedRevision);
    if (!Number.isInteger(expected) || expected !== row.metadataRevision) throw new AuthError("collection_metadata_conflict", 409);
    const now = new Date().toISOString();
    const next = { ...change(meta), revision: meta.revision + 1, updatedAt: now, updatedBy: actor };
    this.db.transaction((tx) => {
      tx.update(auctraCollectionMetadata).set(next).where(eq(auctraCollectionMetadata.id, meta.id)).run();
      tx.update(auctraCollectionRecords).set({ metadataRevision: row.metadataRevision + 1, collectionState: (next.archivedAt ? "archived" : next.confirmedAt ? "confirmed" : row.collectionState) }).where(eq(auctraCollectionRecords.id, row.id)).run();
    });
    return this.get(scopeId, recordRef);
  }
  confirm(scopeId: string, recordRef: string, expectedRevision: string, actor: string) { return this.mutate(scopeId, recordRef, expectedRevision, actor, () => ({ confirmedAt: new Date().toISOString(), confirmedBy: actor, archivedAt: null, archivedBy: null })); }
  archive(scopeId: string, recordRef: string, expectedRevision: string, actor: string) { return this.mutate(scopeId, recordRef, expectedRevision, actor, () => ({ archivedAt: new Date().toISOString(), archivedBy: actor })); }
  labels(scopeId: string, recordRef: string, expectedRevision: string, actor: string, labels: string[]) { return this.mutate(scopeId, recordRef, expectedRevision, actor, () => ({ labels: JSON.stringify([...new Set(labels)].slice(0, 20)) })); }
  note(scopeId: string, recordRef: string, expectedRevision: string, actor: string, note: string) { return this.mutate(scopeId, recordRef, expectedRevision, actor, () => ({ note: note.slice(0, 2000) })); }

  cursor(scopeId: string, bindingFingerprint: string) { return this.db.select().from(auctraCollectionCursors).where(and(eq(auctraCollectionCursors.scopeId, scopeId), eq(auctraCollectionCursors.bindingFingerprint, bindingFingerprint))).get(); }
  saveCursor(scopeId: string, bindingFingerprint: string, cursor: string, digest: string, coverage: string, reason?: string) {
    const id = idFor(scopeId, bindingFingerprint);
    this.db.insert(auctraCollectionCursors).values({ id, scopeId, bindingFingerprint, cursor, sourceSnapshotDigest: digest, lastSuccessAt: new Date().toISOString(), coverage, reason: reason || null }).onConflictDoUpdate({ target: auctraCollectionCursors.id, set: { cursor, sourceSnapshotDigest: digest, lastSuccessAt: new Date().toISOString(), coverage, reason: reason || null } }).run();
  }
}
