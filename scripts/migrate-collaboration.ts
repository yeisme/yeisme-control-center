import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SessionAuth } from "../server/auth";
import { CollaborationService } from "../server/collaboration";
import { defaultDatabasePath, openDatabase, migrateDatabase } from "../server/db/client";
import type { ServerConfig } from "../server/contracts";

const args = process.argv.slice(2);
const index = args.indexOf("--config");
if (index < 0 || !args[index + 1] || args.some((arg, i) => i !== index + 1 && !["--config", "--apply"].includes(arg))) {
  console.error("Usage: bun scripts/migrate-collaboration.ts --config <path> [--apply]"); process.exit(2);
}
const filename = resolve(args[index + 1]);
const config = JSON.parse(readFileSync(filename, "utf8")) as ServerConfig;
const db = openDatabase(args.includes("--apply") ? config.database?.path || defaultDatabasePath(filename) : ":memory:");
migrateDatabase(db);
const service = new CollaborationService(db, config, new SessionAuth(config));
// A scope is imported independently; names and common owner refs never merge permissions.
console.log(JSON.stringify(service.importLegacy(!args.includes("--apply")), null, 2));
