import type { TaskChannelObservation, TaskConnectionState, TaskPage, TaskReadChannel, TaskSnapshot } from "./task-observation";
import { contentActionEnabled } from "./task-observation";

// Aggregate pages within one observation cycle; an empty page with a cursor is
// not end-of-stream. Caps are explicit errors, never successful empty coverage.
export async function readTaskPages(
  read: (cursors?: Record<string, string>) => Promise<TaskPage>,
  maxPages = 100,
): Promise<TaskPage> {
  const { truncated, ...page } = await collectTaskPages(read, maxPages);
  if (truncated) throw Error(truncated);
  return page;
}

// Same aggregation, but a page cap or repeated cursor returns the rows read so
// far and names the reason, so a bounded batch is never shown as the full set.
export async function readTaskPagesBounded(
  read: (cursors?: Record<string, string>) => Promise<TaskPage>,
  maxPages: number,
): Promise<TaskPage & { truncated: "task_page_limit" | "task_cursor_repeated" | null }> {
  return collectTaskPages(read, maxPages);
}

async function collectTaskPages(
  read: (cursors?: Record<string, string>) => Promise<TaskPage>,
  maxPages: number,
): Promise<TaskPage & { truncated: "task_page_limit" | "task_cursor_repeated" | null }> {
  const first = await read(),
    rows = new Map(first.rows.map((t) => [t.task_key!, t])),
    connections = new Map(first.connections.map((c) => [c.id, c]));
  let cursors = first.next_cursors,
    pages = 1,
    truncated: "task_page_limit" | "task_cursor_repeated" | null = null;
  const seen = new Set<string>();
  while (Object.keys(cursors).length) {
    if (pages++ >= maxPages) { truncated = "task_page_limit"; break; }
    const key = JSON.stringify(Object.entries(cursors).sort());
    if (seen.has(key)) { truncated = "task_cursor_repeated"; break; }
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
    truncated,
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
      ? {
          ...connection,
          ...observed,
          channels: mergeChannels(connection.channels, observed.channels),
          runtime: observed.runtime
            ? {
                ...connection.runtime,
                ...observed.runtime,
                channels: mergeChannels(connection.runtime?.channels, observed.runtime.channels),
              }
            : undefined,
        }
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
    const selected = old?.state === 'needs_authorization' ? old
      : c.state !== 'ready' ? c : old && old.state !== 'ready' ? old : c;
    connections.set(c.id, {
      ...selected,
      channels: mergeChannels(old?.channels, c.channels),
      runtime: selected.runtime
        ? {
            ...selected.runtime,
            channels: mergeChannels(old?.runtime?.channels, c.runtime?.channels),
          }
        : selected.runtime,
    });
  }
  const denied = new Set([...connections.values()].filter(c => c.state === 'needs_authorization').map(c => c.id));
  const rows = new Map<string, TaskSnapshot>();
  for (const task of [...active.rows, ...history.rows])
    if (!denied.has(task.connection_id!)) rows.set(task.task_key!, task);
  return { rows: [...rows.values()], connections: [...connections.values()], next_cursors: {} };
}

function mergeChannels(
  first?: Partial<Record<TaskReadChannel, TaskChannelObservation>>,
  second?: Partial<Record<TaskReadChannel, TaskChannelObservation>>,
) {
  if (!first && !second) return undefined;
  return { ...first, ...second };
}
