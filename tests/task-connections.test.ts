import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  TaskConnections,
  safeTask,
  connectionURL,
} from "../server/task-connections";
import { observationDelay, progressLabel } from "../src/task-observation";
import { readTaskPages, mergeTaskObservation } from "../src/task-polling";
import type {
  ScopeBinding,
  ServerConfig,
  TaskConnection,
} from "../server/contracts";
const root = mkdtempSync(join(tmpdir(), "task-connection-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const ref = join(root, "secret");
writeFileSync(ref, "test-service-credential", { mode: 0o600 });
const c: TaskConnection = {
  id: "e",
  owner: "eikona",
  instance_id: "test",
  label: "Eikona",
  environment: "test",
  project: "p",
  endpoint: "http://127.0.0.1:1234/mcp",
  credential_ref: ref,
  allow_private_http: true,
  enabled: true,
};
const scope: ScopeBinding = {
  id: "s",
  tenant: "personal",
  team: "",
  project: "p",
  label: "P",
  connection_ids: ["e"],
  owners: {
    eikona: { tenant: "p", project: "p", actor: "owner", audience: "eikona" },
  },
};
const cfg: ServerConfig = {
  origin: "http://127.0.0.1",
  port: 1,
  principals: [],
  owners: {},
  connections: [c],
};
const row = {
  schema_version: "yeisme.task_observation.v1",
  locator: {
    owner: "eikona",
    project: "p",
    task_family: "run",
    task_ref: "run-1",
  },
  state: "queued",
  native_state: "queued",
  stage: "queued",
  revision: "1",
  created_at: "2026-10-01T00:00:00Z",
  progress: { kind: "indeterminate" },
  results: [],
  allowed_actions: [],
  provider_payload: "secret sentinel",
};
describe("task observation transport", () => {
  it("only accepts configured safe endpoint types", () => {
    expect(connectionURL(c).pathname).toBe("/mcp");
    for (const endpoint of [
      "http://169.254.169.254/mcp",
      "http://public.example/mcp",
      "https://user:secret@example.com/mcp",
      "https://x/mcp?key=s",
    ])
      expect(() => connectionURL({ ...c, endpoint })).toThrow();
  });
  it("projects typed safe fields, not private payload or fake progress", () => {
    const r = safeTask(
      { ...row, progress: { kind: "percent", percent: 200 } },
      c,
    );
    expect(JSON.stringify(r)).not.toContain("secret sentinel");
    expect(r.progress.percent).toBeNull();
    expect(() =>
      safeTask({ ...row, locator: { ...row.locator, project: "other" } }, c),
    ).toThrow();
    expect(
      progressLabel({ kind: "count", total: 0, completed: 0, percent: null }),
    ).toBe("未提供百分比");
  });
  it("disables content actions locally while preserving cancel gating", () => {
    const projected = safeTask(
      {
        ...row,
        allowed_actions: [
          { action: "preview", enabled: true, reason: "owner-ready" },
          { action: "download", enabled: true },
          { action: "cancel", enabled: true },
        ],
      },
      { ...c, allow_cancel: true, allow_content: false },
    );
    expect(projected.allowed_actions).toEqual([
      { action: "preview", enabled: false, reason: "content_not_authorized" },
      { action: "download", enabled: false, reason: "content_not_authorized" },
      { action: "cancel", enabled: true, reason: "" },
    ]);
    expect(safeTask({ ...row, allowed_actions: [null, {}, { action: "other" }, { action: ["preview"] }, { action: "preview", enabled: false, reason: "owner-denied" }, { action: "download", enabled: true }, { action: "cancel", enabled: true }] }, { ...c, allow_content: true, allow_cancel: false }).allowed_actions).toEqual([
      { action: "preview", enabled: false, reason: "owner-denied" },
      { action: "download", enabled: true, reason: "" },
      { action: "cancel", enabled: false, reason: "" },
    ]);
  });
  it("hides owner result references and rejects disabled media actions", async () => {
    const exposed = safeTask({
      ...row,
      results: [{ ref: "https://owner.test/signed?token=secret", name: "private" }],
      allowed_actions: [{ action: "preview", enabled: false, reason: "artifact_not_found" }],
    }, { ...c, allow_content: true });
    expect(exposed.results[0].ref).toBe("artifact-0");
    expect(JSON.stringify(exposed)).not.toContain("owner.test");
  });
  it("discovers in-flight jobs, scopes signed identities and never invokes generation", async () => {
    const calls: string[] = [];
    let running = false;
    const fetcher = async (_url: unknown, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      if (b.method === "initialize")
        return Response.json({
          id: b.id,
          result: { protocolVersion: "2025-06-18" },
        });
      const a = b.params.arguments.action;
      calls.push(a);
      return Response.json({
        id: b.id,
        result: {
          structuredContent: {
            result: {
              data: a.endsWith(".list")
                ? { rows: [row] }
                : { ...row, state: running ? "running" : "queued" },
            },
          },
        },
      });
    };
    const t = new TaskConnections(cfg, fetcher as typeof fetch);
    const p = await t.list(scope, "active");
    expect(p.rows).toHaveLength(1);
    running = true;
    expect((await t.detail(p.rows[0].task_key!, scope)).state).toBe("running");
    await expect(
      t.detail(p.rows[0].task_key!, { ...scope, id: "other" }),
    ).rejects.toThrow();
    expect(calls).toEqual([
      "control_center.tasks.list",
      "control_center.tasks.get",
    ]);
    await expect(t.call(c, "generate", {})).rejects.toThrow();
  });
  it("reports denied or absent contracts rather than success with zero jobs", async () => {
    const t = new TaskConnections(
      cfg,
      (async () => new Response("", { status: 403 })) as typeof fetch,
    );
    const p = await t.list(scope, "active");
    expect(p.rows).toEqual([]);
    expect(p.connections[0].state).toBe("needs_authorization");
  });
  it("stops upstream reads after authorization denial", async () => {
    let calls = 0;
    const t = new TaskConnections(cfg, (async () => {
      calls++;
      return new Response("", { status: 403 });
    }) as typeof fetch);
    await t.list(scope, "active");
    await t.list(scope, "active");
    expect(calls).toBe(1);
  });
  it("keeps identical refs distinct across configured instances and honors exhausted sources", async () => {
    const other = { ...c, id: "other", instance_id: "second", project: "p2" };
    const both = { ...scope, connection_ids: ["e", "other"] };
    const calls: string[] = [];
    const f = async (_url: unknown, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      if (b.method === "initialize")
        return Response.json({
          id: b.id,
          result: { protocolVersion: "2025-06-18" },
        });
      const a = b.params.arguments.args;
      calls.push(a.project_id);
      return Response.json({
        id: b.id,
        result: {
          structuredContent: {
            result: {
              data: {
                rows: a.cursor
                  ? []
                  : [
                      {
                        ...row,
                        locator: { ...row.locator, project: a.project_id },
                      },
                    ],
                next_cursor: a.project_id === "p" && !a.cursor ? "next" : "",
              },
            },
          },
        },
      });
    };
    const t = new TaskConnections(
      { ...cfg, connections: [c, other] },
      f as typeof fetch,
    );
    const first = await t.list(both, "active");
    expect(first.rows).toHaveLength(2);
    expect(first.rows[0].task_key).not.toBe(first.rows[1].task_key);
    await t.list(both, "active", first.next_cursors);
    expect(calls).toEqual(["p", "p2", "p"]);
  });
  it("adapts Scaena path/query and Sonora projection envelopes", async () => {
    for (const owner of ["scaena", "sonora"] as const) {
      const connection = { ...c, owner };
      let args: any;
      const f = async (_url: unknown, init?: RequestInit) => {
        const b = JSON.parse(String(init?.body));
        if (b.method === "initialize")
          return Response.json({
            id: b.id,
            result: { protocolVersion: "2025-06-18" },
          });
        args = b.params.arguments.args;
        const data = { rows: [{ ...row, locator: { ...row.locator, owner } }] };
        return Response.json({
          id: b.id,
          result: {
            structuredContent:
              owner === "sonora"
                ? { result: { data: { projection: data } } }
                : { data },
          },
        });
      };
      const t = new TaskConnections(
        { ...cfg, connections: [connection] },
        f as typeof fetch,
      );
      expect((await t.list(scope, "active")).rows).toHaveLength(1);
      if (owner === "scaena")
        expect(args).toEqual({
          path: { project_id: "p" },
          query: { mode: "active", limit: "50" },
        });
    }
  });
  it("follows empty pages and preserves stale rows only for transient failures", async () => {
    const task = { ...safeTask(row, c), task_key: "key", connection_id: "e" };
    let n = 0;
    const page = await readTaskPages(async () => ({
      rows: n++ ? [task] : [],
      connections: [],
      next_cursors: (n === 1 ? { e: "next" } : {}) as Record<string, string>,
    }));
    expect(page.rows).toHaveLength(1);
    expect(n).toBe(2);
    const connection = {
      id: "e",
      owner: "eikona" as const,
      instance_id: "test",
      label: "E",
      environment: "test",
      project: "p",
      observed_at: "2026-10-01T00:00:00Z",
      state: "ready",
    };
    const old = { ...page, connections: [connection] };
    expect(
      mergeTaskObservation(old, {
        rows: [],
        connections: [{ ...connection, state: "source_unavailable" }],
        next_cursors: {},
      }).rows,
    ).toHaveLength(1);
    expect(
      mergeTaskObservation(old, {
        rows: [],
        connections: [{ ...connection, state: "needs_authorization" }],
        next_cursors: {},
      }).rows,
    ).toHaveLength(0);
  });
  it("limits Sonora content to a task-owned audio grant on the configured origin", async () => {
    const connection: TaskConnection = {
      ...c,
      owner: "sonora",
      allow_content: true,
    };
    const artifactRef = "sonora://audio-asset/result";
    const task = {
      ...row,
      locator: {
        ...row.locator,
        owner: "sonora",
        task_family: "voice-render-job",
      },
      results: [{ ref: artifactRef }],
      allowed_actions: [{ action: "preview", enabled: true }, { action: "download", enabled: true }],
    };
    const goodURL =
      "http://127.0.0.1:1234/api/v1/artifact-access/" +
      "a".repeat(32) +
      "?t=" +
      "x".repeat(43);
    let url = goodURL,
      deny = false,
      grantCalls = 0;
    const fetcher = async (_url: unknown, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      if (b.method === "initialize")
        return Response.json({
          id: b.id,
          result: { protocolVersion: "2025-06-18" },
        });
      const { action, args } = b.params.arguments;
      let projection: unknown = task;
      if (action.endsWith(".list")) projection = { rows: [task] };
      if (action === "control_center.tasks.artifact_access") {
        grantCalls++;
        expect(args).toEqual({
          project_id: "p",
          task_family: "voice-render-job",
          task_ref: "run-1",
          artifact_ref: artifactRef,
        });
        if (deny)
          return Response.json({
            id: b.id,
            result: {
              isError: true,
              structuredContent: { error: { code: "AUTH_ACTION_DENIED" } },
            },
          });
        projection = {
          schema_version: "sonora.task_artifact_grant.v1",
          artifact_ref: artifactRef,
          url,
          expires_at: new Date(Date.now() + 100000).toISOString(),
        };
      }
      return Response.json({
        id: b.id,
        result: { structuredContent: { result: { data: { projection } } } },
      });
    };
    const t = new TaskConnections(
      { ...cfg, connections: [connection] },
      fetcher as typeof fetch,
    );
    const key = (await t.list(scope, "history")).rows[0].task_key!;
    await expect(
      t.artifact(key, scope, "sonora://audio-asset/unrelated"),
    ).rejects.toThrow("artifact_not_found");
    expect(grantCalls).toBe(0);
    expect((await t.artifact(key, scope, artifactRef)).url.href).toBe(goodURL);
    expect(t.mediaHeaders(key, scope).Authorization).toBe(
      "Bearer test-service-credential",
    );
    for (const bad of [
      goodURL.replace("127.0.0.1", "127.0.0.2"),
      goodURL + "&extra=1",
      goodURL + "&t=other",
      goodURL.replace("/artifact-access/", "/other/"),
      goodURL + "#fragment",
    ]) {
      url = bad;
      await expect(t.artifact(key, scope, artifactRef)).rejects.toThrow(
        "media_address_denied",
      );
    }
    deny = true;
    await expect(t.artifact(key, scope, artifactRef)).rejects.toThrow(
      "content_not_authorized",
    );
    expect((await t.list(scope, "active")).connections[0].state).toBe("ready");
    connection.allow_content = false;
    await expect(t.artifact(key, scope, artifactRef)).rejects.toThrow(
      "content_not_authorized",
    );
    expect(() => t.mediaHeaders(key, scope)).toThrow("content_not_authorized");
  });
  it("binds Scaena grant paths to the exact project, task, artifact and family", async () => {
    const connection: TaskConnection = {
      ...c,
      owner: "scaena",
      allow_content: true,
      studio_origin: "https://studio.test",
    };
    const artifactRef = "asset:result",
      family = "video-task";
    const task = {
      ...row,
      locator: { ...row.locator, owner: "scaena", task_family: family },
      episode_ref: "ep-1",
      work_url: "https://evil.test/?token=unsafe",
      results: [{ ref: artifactRef }],
      allowed_actions: [{ action: "preview", enabled: true }, { action: "download", enabled: true }],
    };
    const goodURL =
      "http://127.0.0.1:1234/api/v1/projects/p/control-center/tasks/run-1/artifacts/asset:result/access-grants/artifact-grant:" +
      "a".repeat(32) +
      "?task_family=video-task";
    let url = goodURL;
    const fetcher = async (_url: unknown, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      if (b.method === "initialize")
        return Response.json({
          id: b.id,
          result: { protocolVersion: "2025-06-18" },
        });
      const { action, args } = b.params.arguments;
      let data: unknown = action.endsWith(".list") ? { rows: [task] } : task;
      if (action === "control_center.tasks.artifact_access") {
        expect(args).toEqual({
          path: {
            project_id: "p",
            task_ref: "run-1",
            artifact_ref: artifactRef,
          },
          query: { task_family: family },
        });
        data = {
          schema_version: "scaena.task_artifact_grant.v1",
          artifact_ref: artifactRef,
          url,
          mime: "video/mp4",
          expires_at: new Date(Date.now() + 100000).toISOString(),
        };
      }
      return Response.json({
        id: b.id,
        result: { structuredContent: { data } },
      });
    };
    const t = new TaskConnections(
      { ...cfg, connections: [connection] },
      fetcher as typeof fetch,
    );
    const key = (await t.list(scope, "history")).rows[0].task_key!;
    const resolved = await t.resolve(scope, {
      connection: "e",
      project: "p",
      family,
      ref: "run-1",
    });
    expect(resolved.work_url).toBe(
      "https://studio.test/#/work?project=p&episode=ep-1",
    );
    await expect(
      t.resolve(scope, {
        connection: "unknown",
        project: "p",
        family,
        ref: "run-1",
      }),
    ).rejects.toThrow("task_not_found");
    await expect(
      t.resolve(scope, {
        connection: "e",
        project: "other",
        family,
        ref: "run-1",
      }),
    ).rejects.toThrow("task_not_found");
    expect((await t.artifact(key, scope, artifactRef)).artifact.mime).toBe(
      "video/mp4",
    );
    expect(t.mediaHeaders(key, scope).Authorization).toBe(
      "Bearer test-service-credential",
    );
    for (const bad of [
      goodURL.replace("/p/", "/other/"),
      goodURL.replace("/run-1/", "/other/"),
      goodURL.replace("asset:result", "asset:other"),
      goodURL.replace("video-task", "run"),
      goodURL + "&task_family=run",
      goodURL.replace("127.0.0.1", "127.0.0.2"),
    ]) {
      url = bad;
      await expect(t.artifact(key, scope, artifactRef)).rejects.toThrow(
        "media_address_denied",
      );
    }
  });
  it.each(["sonora", "scaena", "eikona"] as const)(
    "validates %s cancellation receipts without resubmitting",
    async (owner) => {
      const connection: TaskConnection = {
        ...c,
        owner,
        allow_cancel: true,
      };
      const task = {
        ...row,
        locator: {
          ...row.locator,
          owner,
          task_family:
            owner === "sonora"
              ? "local-job"
              : owner === "scaena"
                ? "delegation"
                : "run",
        },
        state: "pending",
      };
      let wrong = false,
        conflict = false,
        receiptRef = "owner:cancel:original";
      const actions: string[] = [];
      const f = async (_u: unknown, init?: RequestInit) => {
        const b = JSON.parse(String(init?.body));
        if (b.method === "initialize")
          return Response.json({
            id: b.id,
            result: { protocolVersion: "2025-06-18" },
          });
        const { action, args } = b.params.arguments;
        actions.push(action);
        if (conflict && action.endsWith(".cancel"))
          return Response.json({
            id: b.id,
            result: {
              isError: true,
              structuredContent: { error: { code: "VERSION_CONFLICT" } },
            },
          });
        const projection = action.endsWith(".list")
          ? { rows: [task] }
          : {
              task,
              receipt: {
                schema_version: "yeisme.task_cancel_receipt.v1",
                task_ref: wrong ? "other" : "run-1",
                ref: receiptRef,
                expected_revision:
                  owner !== "scaena"
                    ? args.expected_revision
                    : args.query.expected_revision,
                outcome: "requested",
              },
            };
        return Response.json({
          id: b.id,
          result: {
            structuredContent:
              owner === "sonora"
                ? { result: { data: { projection } } }
                : owner === "eikona"
                  ? { result: { data: projection } }
                  : { data: projection },
          },
        });
      };
      const t = new TaskConnections(
          { ...cfg, connections: [connection] },
          f as typeof fetch,
        ),
        key = (await t.list(scope, "active")).rows[0].task_key!;
      const receipt = await t.cancel(key, scope, "1", "same-cancel-identity");
      expect(receipt.receipt.outcome).toBe("requested");
      await t.cancel(key, scope, "", "same-cancel-identity", true);
      expect(
        actions.filter((a) => a === "control_center.tasks.cancel"),
      ).toHaveLength(1);
      wrong = true;
      await expect(
        t.cancel(key, scope, "", "same-cancel-identity", true),
      ).rejects.toThrow("invalid_cancel_receipt");
      wrong = false;
      receiptRef = "";
      await expect(
        t.cancel(key, scope, "", "same-cancel-identity", true),
      ).rejects.toThrow("invalid_cancel_receipt");
      receiptRef = "owner:cancel:original";
      conflict = true;
      await expect(
        t.cancel(key, scope, "1", "same-cancel-identity"),
      ).rejects.toThrow("version_conflict");
      connection.allow_cancel = false;
      await expect(
        t.cancel(key, scope, "1", "same-cancel-identity"),
      ).rejects.toThrow("cancel_not_authorized");
    },
  );
  it("uses bounded adaptive polling", () => {
    expect(observationDelay(true, true, false)).toBe(2000);
    expect(observationDelay(true, false, true)).toBe(30000);
    expect(observationDelay(false, false, false, 8)).toBe(30000);
  });
  it("validates paged Scaena and Sonora task events", async () => {
    for (const owner of ["scaena", "sonora"] as const) {
      let page = 0; const connection = { ...c, owner }; const task = { ...row, locator: { ...row.locator, owner, task_family: owner === "sonora" ? "workflow-run" : "run" } };
      const t = new TaskConnections({ ...cfg, connections: [connection] }, (async (_url, init) => { const b = JSON.parse(String(init?.body)); if (b.method === "initialize") return Response.json({ id: b.id, result: { protocolVersion: "2025-06-18" } }); const args = b.params.arguments.args; if (b.params.arguments.action.endsWith(".events")) { if (owner === "scaena") expect(args).toEqual({ path: { project_id: "p", task_ref: "run-1" }, query: { task_family: "run", ...(args.query.cursor ? { cursor: args.query.cursor } : {}), limit: "100" } }); return Response.json({ id: b.id, result: { structuredContent: { data: page++ ? { events: [{ id: "two", occurred_at: "2026-10-01T00:00:01Z", stage: "running", state: "running" }], gap: false } : { events: [{ id: "one", occurred_at: "2026-10-01T00:00:00Z", stage: "queued", state: "queued" }], next_cursor: "next", gap: false } } } }); } return Response.json({ id: b.id, result: { structuredContent: owner === "sonora" ? { result: { data: { projection: { rows: [task] } } } } : { data: { rows: [task] } } } }); }) as typeof fetch);
      const key = (await t.list(scope, "history")).rows[0].task_key!; const first = await t.events(key, scope); const second = await t.events(key, scope, first.next_cursor); expect([first.events[0].stage, second.events[0].stage]).toEqual(["queued", "running"]);
    }
  });

});

describe('connection observation facts', () => {
  it('verifies capability and scoped list, shares bounded probes, never upgrades content intent to permission', async () => {
    const calls: string[] = [];
    const fetcher = async (_url: unknown, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      if (b.method === 'initialize') return Response.json({ id: b.id, result: { protocolVersion: '2025-06-18' } });
      const { action, args } = b.params.arguments;
      calls.push(action);
      expect(args.project_id).toBe('p');
      const data = action.endsWith('capabilities')
        ? { schema_version: 'yeisme.task_observation.v1', task_families: ['run'], private_payload: 'must-not-project' }
        : { rows: [row] };
      return Response.json({ id: b.id, result: { structuredContent: { result: { data } } } });
    };
    const reader = new TaskConnections({ ...cfg, connections: [{ ...c, allow_content: true }] }, fetcher as typeof fetch);
    const [a, b] = await Promise.all([reader.observe(scope), reader.observe(scope)]);
    expect(a).toEqual(b);
    expect(a[0].runtime).toMatchObject({ state: 'ready', authorization: 'verified', contract: 'supported', content: 'not_verified', task_families: ['run'] });
    expect(JSON.stringify(a)).not.toContain('must-not-project');
    await reader.observe(scope);
    expect(calls).toEqual(['control_center.capabilities', 'control_center.tasks.list']);
    expect(await reader.observe({ ...scope, connection_ids: [] })).toEqual([]);
  });
  it('rejects malformed capabilities, isolates failures, and discards a cached success after denial', async () => {
    let deny = false;
    const other = { ...c, id: 'bad', endpoint: 'http://127.0.0.1:1235/mcp' };
    const reader = new TaskConnections({ ...cfg, connections: [c, other] }, (async (url, init) => {
      const b = JSON.parse(String(init?.body));
      if (deny && String(url).includes('1234')) return new Response('', { status: 403 });
      if (b.method === 'initialize') return Response.json({ id: b.id, result: { protocolVersion: '2025-06-18' } });
      const data = b.params.arguments.action.endsWith('capabilities')
        ? { schema_version: 'yeisme.task_observation.v1', task_families: String(url).includes('1235') ? [42] : ['run'] }
        : { rows: [] };
      return Response.json({ id: b.id, result: { structuredContent: { result: { data } } } });
    }) as typeof fetch);
    const both = { ...scope, connection_ids: ['e', 'bad'] };
    const first = await reader.observe(both);
    expect(first.map(v => v.state)).toEqual(['ready', 'needs_contract']);
    deny = true;
    await reader.list(scope, 'active');
    const second = await reader.observe(scope);
    expect(second[0].runtime).toMatchObject({ authorization: 'denied', last_success_at: null, task_families: [] });
  });
  it.each([
    [true, "supported"],
    [false, "unsupported"],
    [undefined, "not_verified"],
    ["true", "not_verified"],
    [null, "not_verified"],
  ] as const)("maps artifact_access=%s to content=%s", async (artifact_access, content) => {
    const fetcher = async (_url: unknown, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      if (b.method === "initialize") return Response.json({ id: b.id, result: { protocolVersion: "2025-06-18" } });
      const action = b.params.arguments.action;
      const data = action.endsWith("capabilities")
        ? { schema_version: "yeisme.task_observation.v1", task_families: ["run"], ...(artifact_access === undefined ? {} : { artifact_access }) }
        : { rows: [] };
      return Response.json({ id: b.id, result: { structuredContent: { result: { data } } } });
    };
    const reader = new TaskConnections({ ...cfg, connections: [{ ...c, allow_content: true }] }, fetcher as typeof fetch);
    expect((await reader.observe(scope))[0].runtime?.content).toBe(content);
  });
  it.each(["AUTH_ACTION_DENIED", "FORBIDDEN", "AUTH_REQUIRED", "unauthenticated", "owner_action_denied", 401, 403])("isolates content denial %s, caches facts, and refreshes after success", async (denial) => {
    for (const action of ["artifact.access", "control_center.tasks.artifact_access"]) {
      let rejectContent = true;
      let probes = 0;
      const connection = { ...c, allow_content: true };
      const reader = new TaskConnections({ ...cfg, connections: [connection] }, (async (_url, init) => {
        const b = JSON.parse(String(init?.body));
        if (b.method === "initialize") return Response.json({ id: b.id, result: { protocolVersion: "2025-06-18" } });
        const requested = b.params.arguments.action;
        if (requested === action && rejectContent) {
          if (typeof denial === "number") return new Response(null, { status: denial });
          return Response.json({ id: b.id, result: { isError: true, structuredContent: { error: { code: denial } } } });
        }
        if (requested.endsWith("capabilities")) probes++;
        const data = requested.endsWith("capabilities")
          ? { schema_version: "yeisme.task_observation.v1", task_families: ["run"], artifact_access: true }
          : requested.endsWith(".list") ? { rows: [row] } : row;
        return Response.json({ id: b.id, result: { structuredContent: { result: { data } } } });
      }) as typeof fetch);
      expect((await reader.observe(scope))[0].runtime?.content).toBe("supported");
      const key = (await reader.list(scope, "active")).rows[0].task_key!;
      expect(reader.mediaHeaders(key, scope)).toEqual({});
      await expect(reader.call(connection, action, {})).rejects.toThrow("content_not_authorized");
      expect(() => reader.mediaHeaders(key, scope)).toThrow("content_not_authorized");
      const page = await reader.list(scope, "active");
      expect(page.connections[0].state).toBe("ready");
      expect(page.rows).toHaveLength(1);
      expect((await reader.detail(key, scope)).locator.task_ref).toBe("run-1");
      expect((await reader.observe(scope))[0].runtime).toMatchObject({ state: "ready", authorization: "verified", content: "denied" });
      expect(probes).toBe(2);
      const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5_000);
      try {
        expect((await reader.observe(scope))[0].runtime?.content).toBe("denied");
        expect(probes).toBe(2);
      } finally { now.mockRestore(); }
      rejectContent = false;
      await reader.call(connection, action, {});
      expect((await reader.observe(scope))[0].runtime?.content).toBe("supported");
      expect(probes).toBe(3);
      expect(reader.mediaHeaders(key, scope)).toEqual({});
      connection.allow_content = false;
      expect((await reader.observe(scope))[0].runtime?.content).toBe("not_requested");
      await expect(reader.artifact(key, scope, "result")).rejects.toThrow("content_not_authorized");
      expect((await reader.list(scope, "active")).rows).toHaveLength(1);
      expect((await reader.detail(key, scope)).locator.task_ref).toBe("run-1");
    }
  });
  it.each(["TIMEOUT", "SCHEMA_MISSING"])("does not misreport %s as content authorization denial", async (code) => {
    const connection = { ...c, allow_content: true };
    const reader = new TaskConnections({ ...cfg, connections: [connection] }, (async (_url, init) => {
      const b = JSON.parse(String(init?.body));
      if (b.method === "initialize") return Response.json({ id: b.id, result: { protocolVersion: "2025-06-18" } });
      const action = b.params.arguments.action;
      const data = action.endsWith("capabilities")
        ? { schema_version: "yeisme.task_observation.v1", task_families: ["run"], artifact_access: true }
        : { rows: [row] };
      return Response.json({ id: b.id, result: { structuredContent: action === "artifact.access" ? { error: { code } } : { data } } });
    }) as typeof fetch);
    await expect(reader.call(connection, "artifact.access", {})).rejects.toThrow("needs_contract");
    expect((await reader.observe(scope))[0].runtime).toMatchObject({ state: "ready", authorization: "verified", content: "supported" });
    expect((await reader.list(scope, "active")).rows).toHaveLength(1);
  });
  it("overlays current denials and local intent on an in-flight observation", async () => {
    const connection = { ...c, allow_content: true };
    let taskDenied = false;
    const reader = new TaskConnections({ ...cfg, connections: [connection] }, (async (_url, init) => {
      const b = JSON.parse(String(init?.body));
      if (b.method === "initialize") return Response.json({ id: b.id, result: { protocolVersion: "2025-06-18" } });
      const action = b.params.arguments.action;
      if (action === "artifact.access" || taskDenied) return new Response(null, { status: 403 });
      const data = action.endsWith("capabilities")
        ? { schema_version: "yeisme.task_observation.v1", task_families: ["run"], artifact_access: true }
        : { rows: [row] };
      return Response.json({ id: b.id, result: { structuredContent: { data } } });
    }) as typeof fetch);
    const call = reader.call.bind(reader);
    const delayed = vi.spyOn(reader, "call").mockImplementation(async (target, action, args) => {
      const result = await call(target, action, args);
      if (action === "control_center.tasks.list") {
        await expect(call(target, "artifact.access", {})).rejects.toThrow("content_not_authorized");
      }
      return result;
    });
    try {
      expect((await reader.observe(scope))[0].runtime).toMatchObject({ state: "ready", authorization: "verified", content: "denied" });
    } finally { delayed.mockRestore(); }
    expect((await reader.observe(scope))[0].runtime?.content).toBe("denied");
    connection.allow_content = false;
    expect((await reader.observe(scope))[0].runtime?.content).toBe("not_requested");
    taskDenied = true;
    expect((await reader.list(scope, "active")).connections[0].state).toBe("needs_authorization");
    expect((await reader.observe(scope))[0].runtime).toMatchObject({ state: "needs_authorization", authorization: "denied", last_success_at: null, content: "not_requested" });
  });
});
