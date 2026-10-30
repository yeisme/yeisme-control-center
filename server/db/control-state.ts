import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ControlDB } from "./client";
import { controlState } from "./schema";

export function readState(db: ControlDB, name: string): string | null {
  return db.select().from(controlState).where(eq(controlState.name, name)).get()?.value ?? null;
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
