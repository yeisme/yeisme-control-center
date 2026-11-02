import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ControlDB } from "./client";
import { controlState } from "./schema";

export function readState(db: ControlDB, name: string): string | null {
  return db.select().from(controlState).where(eq(controlState.name, name)).get()?.value ?? null;
}

/** Sets a named value, replacing an earlier one. */
export function writeState(db: ControlDB, name: string, value: string, at = new Date().toISOString()) {
  db.insert(controlState).values({ name, value, updatedAt: at })
    .onConflictDoUpdate({ target: controlState.name, set: { value, updatedAt: at } }).run();
}

/** Sets a named value only when it is unset, and returns the value that stands, so first writers agree. */
export function ensureState(db: ControlDB, name: string, value: string, at = new Date().toISOString()): string {
  db.insert(controlState).values({ name, value, updatedAt: at }).onConflictDoNothing().run();
  return readState(db, name)!;
}

/** The control center's small named values (`control_state`), as one handle for code that should not know the table. */
export interface ControlState {
  read(name: string): string | null;
  write(name: string, value: string): void;
  ensure(name: string, value: string): string;
}

export function controlStateOf(db: ControlDB): ControlState {
  return {
    read: (name) => readState(db, name),
    write: (name, value) => writeState(db, name, value),
    ensure: (name, value) => ensureState(db, name, value),
  };
}

/**
 * The key that signs task keys. It lives in the database, so a restart or a release keeps every task key, and with
 * it every reminder, link and recent item, valid. A memory database gets a fresh key per process, as before.
 */
export function taskSigningKey(db: ControlDB): Buffer {
  const existing = readState(db, "task_signing_key");
  if (existing) return Buffer.from(existing, "base64");
  db.insert(controlState).values({ name: "task_signing_key", value: randomBytes(32).toString("base64"), updatedAt: new Date().toISOString() })
    .onConflictDoNothing().run();
  return Buffer.from(readState(db, "task_signing_key")!, "base64");
}
