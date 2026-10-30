import { eq } from "drizzle-orm";
import type { ControlDB } from "./client";
import { controlState, taskNotifications } from "./schema";
import { readState } from "./control-state";
import { handledRank } from "../notifications";
import { signTaskIdentity, taskIdentityOf } from "../task-connections";

const MARKER = "notifications_rekey_v1";
type Row = typeof taskNotifications.$inferSelect;

export interface RekeyReport {
  skipped: boolean;
  rows: number;
  groups: number;
  merged_groups: number;
  changed_rows: number;
  unread_before: number;
  unread_after: number;
}

const unread = (row: Pick<Row, "state" | "readAt">) => row.state === "unread" && !row.readAt;

/**
 * Re-keys failure reminders written before task identities existed. Their fingerprint held the whole signed task
 * key, whose signature changed with every server process, so each restart duplicated every open failure. Rows are
 * updated in place and keep their ids (links such as `/reminders?focus=<id>` stay valid); every row of one failure
 * version takes the furthest-handled state, the earliest first sight, the latest last sight and any read time.
 * With `key`, task keys are re-signed so "open task" links work again. Runs once; `dryRun` only reports.
 */
export function rekeyNotifications(db: ControlDB, options: { key?: Buffer; dryRun?: boolean } = {}): RekeyReport {
  const empty = { rows: 0, groups: 0, merged_groups: 0, changed_rows: 0, unread_before: 0, unread_after: 0 };
  if (!options.dryRun && readState(db, MARKER)) return { skipped: true, ...empty };
  const rows = db.select().from(taskNotifications).where(eq(taskNotifications.category, "failure")).all();
  const groups = new Map<string, { fingerprint: string; identity: string; rows: Row[] }>();
  for (const row of rows) {
    const parts = row.failureFingerprint.split("\u001f");
    if (parts.length !== 6) continue;
    const identity = taskIdentityOf(parts[1]);
    if (!identity) continue;
    const fingerprint = [parts[0], identity, ...parts.slice(2)].join("\u001f");
    const key = `${row.scopeId}|${row.subject}|${fingerprint}`;
    const group = groups.get(key) || { fingerprint, identity, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const updates: { id: string; patch: Partial<Row> }[] = [];
  let merged = 0;
  for (const group of groups.values()) {
    if (group.rows.length > 1) merged += 1;
    const best = group.rows.reduce((a, b) => handledRank(b.state) > handledRank(a.state) ? b : a);
    const first = group.rows.map((row) => row.firstSeenAt).sort()[0];
    const last = group.rows.map((row) => row.lastSeenAt).sort().at(-1)!;
    const read = group.rows.map((row) => row.readAt).filter(Boolean).sort()[0] || null;
    for (const row of group.rows) {
      updates.push({ id: row.id, patch: {
        failureFingerprint: group.fingerprint, taskIdentity: group.identity,
        taskKey: options.key ? signTaskIdentity(group.identity, options.key) : row.taskKey,
        state: best.state, acknowledgedAt: best.acknowledgedAt, mutedAt: best.mutedAt, archivedAt: best.archivedAt,
        reopened: best.reopened, firstSeenAt: first, lastSeenAt: last, readAt: read,
      } });
    }
  }
  const after = new Map(updates.map((update) => [update.id, update.patch]));
  const report: RekeyReport = {
    skipped: false, rows: rows.length, groups: groups.size, merged_groups: merged,
    changed_rows: rows.filter((row) => after.get(row.id)?.state !== undefined && after.get(row.id)!.state !== row.state).length,
    unread_before: rows.filter(unread).length,
    unread_after: rows.filter((row) => unread({ ...row, ...(after.get(row.id) || {}) } as Row)).length,
  };
  if (options.dryRun) return report;
  const now = new Date().toISOString();
  // The marker commits with the updates, so an interrupted repair simply runs again.
  db.transaction((tx) => {
    for (const update of updates) tx.update(taskNotifications).set(update.patch).where(eq(taskNotifications.id, update.id)).run();
    tx.insert(controlState).values({ name: MARKER, value: now, updatedAt: now })
      .onConflictDoUpdate({ target: controlState.name, set: { value: now, updatedAt: now } }).run();
  });
  return report;
}
