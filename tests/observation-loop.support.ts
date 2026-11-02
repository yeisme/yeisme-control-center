import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createControlCenter, type ControlServices } from "../server/app";
import { createMemoryDB } from "../server/db/client";
import { taskNotifications } from "../server/db/schema";
import { OpenToolService } from "../server/open-tools/service";
import { createObservationLoop, type ObservationLoopOptions } from "../server/observation-loop";
import { TaskConnections } from "../server/task-connections";
import type { ObservationConfig, PersonalUser, ScopeBinding, ServerConfig, Session, TaskConnection } from "../server/contracts";

const dir = mkdtempSync(join(tmpdir(), "observation-loop-test-"));
export const tokenFile = join(dir, "token");
writeFileSync(tokenFile, "observation-test-token\n", { mode: 0o600 });
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

export const T0 = Date.parse("2026-11-01T12:00:00.000Z");
export const hour = 3_600_000;
export const minute = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const origin = "http://127.0.0.1:4312";

/** A task row as an owner returns it. Times are relative to the fake clock, which starts at T0. */
export const row = (ref: string, state: string, over: Record<string, unknown> = {}) => ({
  schema_version: "yeisme.task_observation.v1",
  locator: { owner: "eikona", project: "p", task_family: "run", task_ref: ref },
  title: `任务 ${ref}`,
  state,
  native_state: state,
  stage: state,
  revision: "rev-1",
  created_at: iso(T0 - 3 * hour),
  updated_at: iso(T0 - hour),
  progress: { kind: "indeterminate" },
  results: [],
  allowed_actions: [],
  coverage: "complete",
  ...over,
});

export interface OwnerWorld {
  [connection: string]: {
    active?: ReturnType<typeof row>[];
    history?: ReturnType<typeof row>[];
    /** Every request gets this HTTP status instead of an answer. */
    status?: number;
    /** Rows per page; an owner with more rows than this pages its lists with `next_cursor`. Default: everything in one page. */
    pageSize?: number;
    /** A list request that continues from this cursor gets an HTTP 500, as an owner that lost the cursor would answer. */
    breakAt?: string;
    /** Answers wait for this before they are given. */
    hold?: Promise<void>;
  };
}

/** The task owners behind the connections: an MCP endpoint per connection id that logs every request. */
export function fakeOwners(world: OwnerWorld) {
  const log: { connection: string; method: string; action?: string; mode?: string; cursor?: string }[] = [];
  const reply = (id: unknown, data: unknown) => Response.json({ id, result: { structuredContent: { result: { data } } } });
  const fetcher = async (input: unknown, init?: RequestInit) => {
    const connection = new URL(String(input)).pathname.split("/").pop()!;
    const body = JSON.parse(String(init?.body));
    const asked = body.params?.arguments;
    log.push({ connection, method: body.method, action: asked?.action, mode: asked?.args?.mode, cursor: asked?.args?.cursor });
    const owner = world[connection];
    if (owner?.hold) await owner.hold;
    if (!owner || owner.status) return new Response("unavailable", { status: owner?.status ?? 404 });
    if (owner.breakAt !== undefined && asked?.args?.cursor === owner.breakAt) return new Response("unavailable", { status: 500 });
    if (body.method === "initialize") return Response.json({ id: body.id, result: { protocolVersion: "2025-06-18" } });
    const { action, args } = body.params.arguments;
    if (action === "control_center.tasks.list") {
      const all = (args.mode === "active" ? owner.active : owner.history) ?? [];
      const size = Math.min(owner.pageSize ?? 50, 50);
      const from = args.cursor === undefined ? 0 : Number(args.cursor);
      // The owner's cursor is just the offset of the next row, as opaque to the control center as any other.
      return reply(body.id, { rows: all.slice(from, from + size), ...(from + size < all.length ? { next_cursor: String(from + size) } : {}) });
    }
    if (action === "control_center.tasks.get") {
      const found = [...(owner.active ?? []), ...(owner.history ?? [])].find((candidate) => candidate.locator.task_ref === args.task_ref);
      return found ? reply(body.id, found) : Response.json({ id: body.id, result: { isError: true, structuredContent: { error: { code: "TASK_NOT_FOUND" } } } });
    }
    return reply(body.id, {});
  };
  /** Every request the owners got, the MCP handshake included: what the loop's budget counts. */
  const requests = (connection?: string) => log.filter((entry) => !connection || entry.connection === connection);
  /** Task list requests only. */
  const reads = (connection?: string) => log.filter((entry) => entry.action === "control_center.tasks.list" && (!connection || entry.connection === connection));
  /** Which cursors a connection was asked for, in order: undefined is page 1. */
  const cursors = (connection: string, mode?: string) => reads(connection).filter((entry) => !mode || entry.mode === mode).map((entry) => entry.cursor);
  return { fetcher: fetcher as unknown as typeof fetch, log, reads, requests, cursors };
}

/** What the control center shows browsers about a connection's read channels (`active`, `history`, ...). */
export const channelsOf = (tasks: TaskConnections, id: string) => (tasks as unknown as { channels: Map<string, Record<string, { state: string }>> }).channels.get(id) ?? {};

/** DriveBridge's three fixed routes, with failed runs. `runs` is the live list; change it to change what the next read sees. */
export function fakeDriveBridge(failed: number) {
  const requests: string[] = [];
  const ago = (minutes: number) => new Date(Date.now() - minutes * minute).toISOString();
  const runs: Record<string, unknown>[] = [
    { id: "op_done", kind: "upload", status: "completed", updated_at: ago(5) },
    ...Array.from({ length: failed }, (_, index) => ({ id: `op_failed_${String(index).padStart(2, "0")}`, kind: "export", status: "failed", error: "open /srv/x: permission denied", path: "/secret/x", updated_at: ago(10 + index) })),
  ];
  const fetcher = async (input: unknown) => {
    const path = new URL(String(input)).pathname;
    requests.push(path);
    const routes: Record<string, unknown> = {
      "/base/healthz": { data: { status: "ok", enabled: true } },
      "/base/api/v1/capabilities": { data: { spec_version: "drivebridge.v1", part_size: 8 * 1048576 } },
      "/base/api/v1/operations": { data: runs },
    };
    return routes[path] ? Response.json(routes[path]) : new Response(null, { status: 404 });
  };
  return { fetcher: fetcher as unknown as typeof fetch, requests, runs, ago };
}

export const connection = (id: string): TaskConnection => ({
  id, owner: "eikona", instance_id: "i", label: id, environment: "test", endpoint: `http://127.0.0.1:9/mcp/${id}`,
  credential_ref: tokenFile, project: "p", enabled: true, allow_private_http: true,
});
export const user = (username: string, role: "admin" | "viewer", over: Partial<PersonalUser> = {}): PersonalUser => ({ username, name: username, role, key_hash_ref: "/unused", scope_ids: ["scope-a"], ...over });

export interface SetupOptions {
  connections?: string[];
  world?: OwnerWorld;
  users?: PersonalUser[];
  /** Role of the legacy owner account. */
  owner?: "admin" | "viewer";
  observation?: Partial<ObservationConfig>;
  /** More base scopes, each with its own connections, all bound to the legacy owner. */
  extraScopes?: { id: string; connections: string[] }[];
  driveBridge?: ReturnType<typeof fakeDriveBridge>;
  loop?: ObservationLoopOptions;
}

export function setup(options: SetupOptions = {}) {
  const ids = options.connections ?? ["eikona-a"];
  const scope: ScopeBinding = { id: "scope-a", tenant: "t", team: "", project: "p", label: "Scope A", owners: {}, connection_ids: ids, ...(options.driveBridge ? { open_tools: ["drivebridge" as const] } : {}) };
  const more: ScopeBinding[] = (options.extraScopes ?? []).map((extra) => ({ id: extra.id, tenant: "t", team: "", project: "p", label: extra.id, owners: {}, connection_ids: extra.connections }));
  const everyConnection = [...new Set([...ids, ...more.flatMap((extra) => extra.connection_ids ?? [])])];
  const config: ServerConfig = {
    origin, port: 4312, auth_mode: "personal",
    personal: { name: "Owner", username: "owner", role: options.owner ?? "admin", password_hash_ref: "/unused", scope_ids: [scope.id, ...more.map((extra) => extra.id)], users: options.users ?? [] },
    principals: [{ issuer: "yeisme:personal", subject: "owner", name: "Owner", role: "admin", scopes: [scope, ...more] }],
    owners: {},
    connections: everyConnection.map(connection),
    observation: { enabled: true, ...options.observation },
    ...(options.driveBridge ? { open_tools: { drivebridge: { endpoint: "https://drive.example/base", credential_ref: tokenFile } } } : {}),
  };
  const owners = fakeOwners(options.world ?? {});
  const clock = { now: T0 };
  const db = createMemoryDB();
  const openTools = new OpenToolService(config, options.driveBridge?.fetcher);
  const { handle, services } = createControlCenter(config, {
    db, clock: () => clock.now, openTools,
    tasks: new TaskConnections(config, owners.fetcher, randomBytes(32)),
  });
  const timers = fakeTimers();
  const loop = createObservationLoop(services, { log: () => undefined, random: () => 0, timers, ...options.loop });
  return { config, scope, services, handle, loop, owners, clock, timers, db, openTools };
}

/** Timers the test fires by hand. */
export function fakeTimers() {
  const scheduled: { callback: () => void; ms: number; cleared: boolean }[] = [];
  return {
    scheduled,
    set: (callback: () => void, ms: number) => { const entry = { callback, ms, cleared: false }; scheduled.push(entry); return entry; },
    clear: (handle: unknown) => { (handle as { cleared: boolean }).cleared = true; },
    /** Timers that have neither run nor been cancelled. */
    pending: () => scheduled.filter((entry) => !entry.cleared),
    /** Runs one timer's callback, once, as the clock reaching it would. */
    fire: (index: number) => { const entry = scheduled[index]; if (entry.cleared) return; entry.cleared = true; entry.callback(); },
  };
}

export const ownerSession = (over: Partial<Session> = {}): Session => ({
  id: "session-owner", issuer: "yeisme:personal", subject: "owner", name: "Owner", csrf: "csrf-owner", accessToken: "", accessAudience: [],
  expires: Date.now() + 600_000, personal: true, epoch: 1, ...over,
});

/** A request as that session would make it. */
export function asSession(services: ControlServices, handle: (request: Request) => Promise<Response>, session: Session) {
  vi.spyOn(services.auth, "current").mockReturnValue(session);
  return async (path: string, method = "GET", body?: unknown) => {
    const response = await handle(new Request(origin + "/api/control-center/v1" + path, {
      method,
      headers: { Cookie: "yeisme_session=" + session.id, Origin: origin, "X-CSRF-Token": session.csrf, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
}

export const rows = (services: ControlServices, subject: string, scope = "scope-a") => services.notifications.list(scope, "", subject);
export const stored = (services: ControlServices) => services.db.select().from(taskNotifications).all();
