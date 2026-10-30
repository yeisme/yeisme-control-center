// Rehearses the reminder repair on a COPY of a control-center database; the original is never opened for writing.
// Usage: bun scripts/rehearse-reminder-repair.ts <path-to-config.sqlite>
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { migrateDatabase, openDatabase } from "../server/db/client";
import { rekeyNotifications } from "../server/db/notification-rekey";
import { taskSigningKey } from "../server/db/control-state";

const source = process.argv[2];
if (!source || !existsSync(source)) throw new Error("usage: bun scripts/rehearse-reminder-repair.ts <path-to-config.sqlite>");
const dir = mkdtempSync(join(tmpdir(), "cc-rehearsal-"));
const copy = join(dir, "copy.sqlite");
// A consistent snapshot even while the server runs: SQLite's own backup into the copy.
new Database(source, { readonly: true }).run(`VACUUM INTO '${copy.replaceAll("'", "''")}'`);
const db = openDatabase(copy);
migrateDatabase(db);
const dry = rekeyNotifications(db, { dryRun: true });
const applied = rekeyNotifications(db, { key: taskSigningKey(db) });
const raw = new Database(copy, { readonly: true });
const integrity = (raw.prepare("pragma integrity_check").get() as { integrity_check: string }).integrity_check;
const states = raw.prepare("select state, count(*) as n from task_notifications where category = 'failure' group by state order by state").all();
const rows = (raw.prepare("select count(*) as n from task_notifications").get() as { n: number }).n;
console.log(JSON.stringify({ dry_run: dry, applied_on_copy: applied, rows_after: rows, failure_states_after: states, integrity, copy }, null, 2));
