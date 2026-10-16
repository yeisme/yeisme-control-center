export interface TaskTarget {
  connection: string;
  project: string;
  family: string;
  ref: string;
}
const taskPrefixes = ["#/tasks?", "#/requests?", "#/history?"] as const;
function taskPrefix(hash: string) {
  return taskPrefixes.find((prefix) => hash.startsWith(prefix));
}
// Only reference parameters are accepted. No caller-provided redirect or action.
export function taskTarget(hash: string): TaskTarget | null {
  const prefix = taskPrefix(hash);
  if (!prefix) return null;
  const p = new URLSearchParams(hash.slice(prefix.length));
  if (
    [...p.keys()].some(
      (k) => !["connection", "project", "family", "ref"].includes(k),
    )
  )
    return null;
  for (const k of ["connection", "project", "family", "ref"])
    if (p.getAll(k).length !== 1 || !p.get(k) || p.get(k)!.length > 512)
      return null;
  return {
    connection: p.get("connection")!,
    project: p.get("project")!,
    family: p.get("family")!,
    ref: p.get("ref")!,
  };
}
export function clientOrigin(value: string): string {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error("invalid_client_origin");
  }
  if (
    u.origin !== value ||
    u.username ||
    u.password ||
    (u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
      ))
  )
    throw new Error("invalid_client_origin");
  return u.origin;
}

export function taskListHash(connection: string, project: string): string {
  return '#/tasks?' + new URLSearchParams({ connection, project });
}
export function taskListTarget(hash: string): Pick<TaskTarget, 'connection' | 'project'> | null {
  const prefix = taskPrefix(hash);
  if (!prefix) return null;
  const params = new URLSearchParams(hash.slice(prefix.length));
  if ([...params.keys()].some(key => !['connection', 'project'].includes(key))) return null;
  for (const key of ['connection', 'project'])
    if (params.getAll(key).length !== 1 || !params.get(key) || params.get(key)!.length > 512) return null;
  return { connection: params.get('connection')!, project: params.get('project')! };
}
