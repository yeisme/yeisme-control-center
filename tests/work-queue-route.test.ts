import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import type { ScopeBinding, ServerConfig, Session } from "../server/contracts";
import type { TaskSnapshot } from "../src/task-observation";

const origin = "https://control.example.test";
const scope: ScopeBinding = { id: "scope-a", tenant: "tenant-a", team: "team-a", project: "project-a", label: "Scope A", owners: {}, connection_ids: ["eikona"] };

function task(key: string, state: string): TaskSnapshot {
  return {
    schema_version: "yeisme.task_observation.v1",
    locator: { owner: "eikona", instance_id: "instance-a", project: "project-a", task_family: "image", task_ref: key },
    task_key: key,
    title: key,
    state,
    native_state: state,
    stage: "complete",
    revision: "revision-1",
    created_at: "2026-10-20T00:00:00.000Z",
    updated_at: "2026-10-20T00:00:00.000Z",
    observed_at: "2026-10-20T00:00:00.000Z",
    started_at: null,
    progress: { kind: "indeterminate", completed: null, total: null, percent: null },
    source: "fixture",
    actor: null,
    parent_ref: null,
    results: [],
    allowed_actions: [],
    coverage: "complete",
  };
}

function setup() {
  const config: ServerConfig = {
    origin,
    port: 4312,
    auth_mode: "personal",
    personal: { name: "Owner", password_hash_ref: "/unused", scope_ids: [scope.id], role: "admin" },
    principals: [{ issuer: "yeisme:personal", subject: "owner", name: "Owner", role: "admin", scopes: [scope] }],
    owners: {},
    connections: [],
  };
  const auth = new SessionAuth(config);
  const session: Session = { id: "session-a", issuer: "yeisme:personal", subject: "owner", name: "Owner", csrf: "csrf", accessToken: "", accessAudience: [], expires: Date.now() + 60_000, personal: true, epoch: 7 };
  vi.spyOn(auth, "current").mockReturnValue(session);
  const tasks = {
    list: async (_scope: ScopeBinding, mode: "active" | "history") => ({ rows: mode === "active" ? [task("task-failed", "failed")] : [task("task-unknown", "unknown")], connections: [], next_cursors: {} }),
    observe: async () => [{ id: "eikona", owner: "eikona", instance_id: "instance-a", label: "Eikona", environment: "fixture", project: "project-a", state: "needs_contract", observed_at: "2026-10-20T00:00:00.000Z" }],
  };
  const app = createApp(config, { auth, tasks: tasks as never });
  const request = (path: string) => new Request(origin + "/api/control-center/v1" + path, { headers: { Cookie: "yeisme_session=" + session.id } });
  return { app, request };
}

describe("work queue route", () => {
  it("returns scoped queue items, counts, epoch and signed pagination", async () => {
    const { app, request } = setup();
    const response = await app(request("/work-queue?scope=scope-a&limit=1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.schema_version).toBe("yeisme.work_queue.v1");
    expect(body.epoch).toBe(7);
    expect(body.scope).toBe("scope-a");
    expect(body.items).toHaveLength(1);
    expect(body.counts.total).toBeGreaterThanOrEqual(3);
    expect(body.next_cursor).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain("password_hash_ref");
  });

  it("binds filters and rejects invalid kinds without upstream fallback", async () => {
    const { app, request } = setup();
    const filtered = await app(request("/work-queue?scope=scope-a&kind=task_unknown"));
    expect(filtered.status).toBe(200);
    expect((await filtered.json()).items.every((item: { kind: string }) => item.kind === "task_unknown")).toBe(true);
    expect((await app(request("/work-queue?scope=scope-a&kind=not-a-kind"))).status).toBe(400);
    expect((await app(request("/work-queue?scope=other"))).status).toBe(404);
  });
});
