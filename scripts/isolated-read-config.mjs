import { realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

function canonical(path) {
  try { return realpathSync(path); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return join(canonical(dirname(resolve(path))), basename(path));
  }
}

/** The caller creates a private directory; source config and credential references stay untouched. */
export function isolateReadConfig(source, { directory, configPath, sourcePath, origin, port }) {
  const root = realpathSync(directory);
  if (!isAbsolute(directory) || (statSync(root).mode & 0o077) !== 0) throw new Error("isolated_directory_not_private");
  const configFile = canonical(configPath);
  const database = canonical(join(root, "read-check.sqlite"));
  for (const path of [configFile, database]) {
    const child = relative(root, path);
    if (!child || child.startsWith("..") || isAbsolute(child)) throw new Error("isolated_path_escape");
  }
  const sourceDatabase = source.database?.path ? resolve(source.database.path) : resolve(sourcePath).replace(/\.json$/, "") + ".sqlite";
  if (canonical(sourcePath) === configFile || canonical(sourceDatabase) === database) throw new Error("source_path_reused");
  const url = new URL(origin);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
    || url.origin !== origin || Number(url.port || 80) !== port) throw new Error("isolated_origin_invalid");
  return {
    ...source,
    origin, bind: "127.0.0.1", port,
    config_file: configFile,
    database: { path: database },
    read_only: true,
    observation: { enabled: false },
    providers: {},
    connections: source.connections?.map((entry) => ({ ...entry, allow_cancel: false })),
    open_tools: source.open_tools && Object.fromEntries(Object.entries(source.open_tools).map(([key, entry]) => {
      const { management_credential_ref, management_credential_expires_at, management_credential_issued_at, ...readOnly } = entry;
      return [key, readOnly];
    })),
  };
}

/** Do not let an inherited Provider URL or background flag reopen execution. */
export function isolatedReadEnvironment(environment, configPath, port) {
  const result = Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith("YEISME_PROVIDER_") && !key.startsWith("YEISME_CONTROL_")));
  return { ...result, YEISME_CONTROL_CONFIG: configPath, YEISME_CONTROL_BIND: "127.0.0.1", YEISME_CONTROL_PORT: String(port), YEISME_CONTROL_BACKGROUND: "off" };
}
