import type { TaskConnectionState, TaskPage, TaskSnapshot } from "./task-observation";
import { contentActionEnabled } from "./task-observation";

// Aggregate pages within one observation cycle; an empty page with a cursor is
// not end-of-stream. Caps are explicit errors, never successful empty coverage.
export async function readTaskPages(
  read: (cursors?: Record<string, string>) => Promise<TaskPage>,
  maxPages = 100,
): Promise<TaskPage> {
  const first = await read(),
    rows = new Map(first.rows.map((t) => [t.task_key!, t])),
    connections = new Map(first.connections.map((c) => [c.id, c]));
  let cursors = first.next_cursors,
    pages = 1;
  const seen = new Set<string>();
  while (Object.keys(cursors).length) {
    if (pages++ >= maxPages) throw Error("task_page_limit");
    const key = JSON.stringify(Object.entries(cursors).sort());
    if (seen.has(key)) throw Error("task_cursor_repeated");
    seen.add(key);
    const page = await read(cursors);
    for (const task of page.rows) rows.set(task.task_key!, task);
    for (const connection of page.connections) {
      if (connections.get(connection.id)?.state !== "needs_authorization")
        connections.set(connection.id, connection);
    }
    cursors = page.next_cursors;
  }
  const denied = new Set(
    [...connections.values()]
      .filter((c) => c.state === "needs_authorization")
      .map((c) => c.id),
  );
  return {
    rows: [...rows.values()].filter((t) => !denied.has(t.connection_id!)),
    connections: [...connections.values()],
    next_cursors: {},
  };
}
export function mergeConnectionObservations(
  page: TaskPage,
  observations: TaskConnectionState[],
): TaskPage {
  const byId = new Map(observations.map((connection) => [connection.id, connection]));
  const connections: TaskConnectionState[] = page.connections.map((connection) => {
    const observed = byId.get(connection.id);
    byId.delete(connection.id);
    // The fresh task denial wins over a cached capability observation.
    if (connection.state === "needs_authorization")
      return { ...connection, runtime: undefined };
    return observed
      ? { ...connection, ...observed, runtime: observed.runtime }
      : { ...connection, runtime: undefined };
  });
  connections.push(...byId.values());
  const merged = new Map<string, TaskConnectionState>(connections.map((connection) => [connection.id, connection]));
  return {
    ...page,
    connections,
    rows: page.rows
      .filter((task) => merged.get(task.connection_id || "")?.state !== "needs_authorization")
      .map((task) => {
        const content = merged.get(task.connection_id || "")?.runtime?.content;
        return {
          ...task,
          allowed_actions: task.allowed_actions.map((action) =>
            action.action === "cancel" || contentActionEnabled(task.allowed_actions, content, action.action)
              ? action
              : { ...action, enabled: false, reason: action.reason || "content_not_authorized" },
          ),
        };
      }),
  };
}

export function mergeTaskObservation(
  previous: TaskPage | null,
  next: TaskPage,
): TaskPage {
  const failed = new Set(
    next.connections
      .filter((c) => c.state !== "ready" && c.state !== "needs_authorization")
      .map((c) => c.id),
  );
  const rows = new Map<string, TaskSnapshot>();
  for (const task of previous?.rows || [])
    if (failed.has(task.connection_id!)) rows.set(task.task_key!, task);
  const denied = new Set(
    next.connections
      .filter((c) => c.state === "needs_authorization")
      .map((c) => c.id),
  );
  for (const task of next.rows)
    if (!denied.has(task.connection_id!)) rows.set(task.task_key!, task);
  return {
    ...next,
    rows: [...rows.values()],
    connections: next.connections.map((c) => {
      const old = previous?.connections.find((v) => v.id === c.id);
      return c.state === "ready"
        ? c
        : { ...c, observed_at: old?.observed_at || "" };
    }),
  };
}

// A denial in either lane wins. A partial lane never masquerades as full coverage.
export function combineTaskPages(active: TaskPage, history: TaskPage): TaskPage {
  const connections = new Map(active.connections.map(c => [c.id, c]));
  for (const c of history.connections) {
    const old = connections.get(c.id);
    connections.set(c.id, old?.state === 'needs_authorization' ? old
      : c.state !== 'ready' ? c : old && old.state !== 'ready' ? old : c);
  }
  const denied = new Set([...connections.values()].filter(c => c.state === 'needs_authorization').map(c => c.id));
  const rows = new Map<string, TaskSnapshot>();
  for (const task of [...active.rows, ...history.rows])
    if (!denied.has(task.connection_id!)) rows.set(task.task_key!, task);
  return { rows: [...rows.values()], connections: [...connections.values()], next_cursors: {} };
}
