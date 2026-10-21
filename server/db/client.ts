import { createRequire } from "node:module";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/**
 * Both runtimes expose the same drizzle "sync" SQLite API surface; the handle
 * is typed once and the Bun driver is cast at this single boundary.
 */
export type ControlDB = BetterSQLite3Database<typeof schema>;

export const memoryPath = ":memory:";

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
const requireModule = createRequire(import.meta.url);

type DrizzleFactory = (client: unknown) => ControlDB;

function prepare(db: ControlDB, path: string) {
  db.run(sql`PRAGMA journal_mode = WAL`);
  db.run(sql`PRAGMA foreign_keys = ON`);
  db.run(sql`PRAGMA busy_timeout = 5000`);
  if (path !== memoryPath)
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        chmodSync(path + suffix, 0o600);
      } catch {
        // Best-effort permission tightening; SQLite may not have created the
        // sidecar files yet.
      }
    }
}

/** Opens (and configures) a SQLite database synchronously for either runtime. */
export function openDatabase(path: string): ControlDB {
  if (isBun) {
    // better-sqlite3's native module panics under Bun, so Bun always uses bun:sqlite.
    const { Database } = requireModule("bun:sqlite") as {
      Database: new (path: string) => unknown;
    };
    const { drizzle } = requireModule("drizzle-orm/bun-sqlite") as {
      drizzle: DrizzleFactory;
    };
    const db = drizzle(new Database(path));
    prepare(db, path);
    return db;
  }
  // CJS interop: better-sqlite3 may load as the constructor itself or as a
  // { default } wrapper depending on the bundler; accept both shapes.
  const betterSqlite = requireModule("better-sqlite3") as
    | (new (path: string) => unknown)
    | { default: new (path: string) => unknown };
  const Database =
    typeof betterSqlite === "function" ? betterSqlite : betterSqlite.default;
  const { drizzle } = requireModule("drizzle-orm/better-sqlite3") as {
    drizzle: DrizzleFactory;
  };
  const db = drizzle(new Database(path));
  prepare(db, path);
  return db;
}

/** Applies pending drizzle-kit migrations generated into server/db/migrations. */
export function migrateDatabase(db: ControlDB): void {
  const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));
  if (isBun) {
    const { migrate } = requireModule("drizzle-orm/bun-sqlite/migrator") as {
      migrate: (db: never, options: { migrationsFolder: string }) => void;
    };
    migrate(db as never, { migrationsFolder });
    return;
  }
  const { migrate } = requireModule("drizzle-orm/better-sqlite3/migrator") as {
    migrate: (db: never, options: { migrationsFolder: string }) => void;
  };
  migrate(db as never, { migrationsFolder });
}

/** Fresh migrated in-memory database, used by tests and config-less dev runs. */
export function createMemoryDB(): ControlDB {
  const db = openDatabase(memoryPath);
  migrateDatabase(db);
  return db;
}

/** Default file location: beside the user-level config file. */
export function defaultDatabasePath(configFile: string): string {
  return configFile.replace(/\.json$/, "") + ".sqlite";
}

export { schema };
