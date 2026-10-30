import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import { CollaborationService } from "../server/collaboration";
import type { ScopeBinding, ServerConfig, Session } from "../server/contracts";
import { createMemoryDB } from "../server/db/client";
import { collaborationBatches } from "../server/db/schema";
import { observeBudget, observeParallel, parseBatchQuery, type BatchPosition, type BatchQuery } from "../server/generation-batches";
import type { GenerationBatch, GenerationBatchItem } from "../src/shared/collaboration";

const origin = "http://127.0.0.1:4377";
const source: ScopeBinding = { id: "A", tenant: "A", team: "", project: "rain", label: "A", owners: { eikona: { tenant: "A", project: "rain", actor: "owner-user", audience: "eikona" } }, connection_ids: [] };
const config: ServerConfig = { origin, port: 4377, owners: {}, principals: [
  { issuer: "test", subject: "admin", name: "Admin", role: "admin", scopes: [source] },
  { issuer: "test", subject: "stranger", name: "Stranger", role: "admin", scopes: [{ ...source, id: "B", tenant: "B" }] },
  { issuer: "test", subject: "member", name: "Member", role: "viewer", scopes: [source] },
] };
const session = (subject: string): Session => ({ id: subject, issuer: "test", subject, name: subject, accessToken: "", accessAudience: [], csrf: "csrf", epoch: 1, expires: Date.now() + 3_600_000 });
const item = (extra: Partial<GenerationBatchItem> = {}) => ({ id: "row", owner: "eikona", modality: "image", model_ref: "m", candidate_count: 1, folder_id: null, input_ref: "in", input_digest: "d", plan_digest: "p", state: "succeeded", project_ref: "rain", ...extra }) as GenerationBatchItem;
const batch = (id: string, created_at: string, extra: Partial<GenerationBatch> = {}): GenerationBatch => ({
  id, project_id: "", revision: 1, name: `批次 ${id}`, state: "succeeded", idempotency_key: "k-" + id, items: [item()], total_cost: 0, created_at, updated_at: created_at, ...extra,
});
const query = (raw: Record<string, string>) => parseBatchQuery(new URLSearchParams(raw));

/** A shared project whose batches are stored as given, read through the same service the routes use. */
function storedProject(rows: GenerationBatch[]) {
  const db = createMemoryDB(); const auth = new SessionAuth(config); const service = new CollaborationService(db, config, auth);
  const admin = session("admin");
  const [org] = service.execute(admin, "organization.create", "new", "0", { name: "Studio", source_scope: "A" });
  const [project] = service.execute(admin, "project.create", org, "0", { name: "Project" });
  for (const row of rows) db.insert(collaborationBatches).values({ id: row.id, projectId: project, name: row.name, state: row.state, revision: row.revision, idempotencyKey: row.idempotency_key, totalCost: row.total_cost, createdAt: row.created_at, updatedAt: row.updated_at, items: JSON.stringify(row.items) }).run();
  const page = (q: BatchQuery, after?: BatchPosition) => service.batchPage(admin, project, q, after);
  return { db, auth, service, admin, org, project, page, ids: (q: BatchQuery) => page(q).rows.map((row) => row.id) };
}

describe("batch list paging", () => {
  it("accepts the documented filters and refuses anything that could silently widen a list", () => {
    expect(query({})).toEqual({ limit: 20 });
    expect(query({ q: "  雨夜 ", state: "succeeded,failed,succeeded", owner: "eikona", from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00+08:00", limit: "50" }))
      .toEqual({ q: "雨夜", states: ["succeeded", "failed"], owners: ["eikona"], from: "2026-10-01T00:00:00.000Z", to: "2026-10-01T16:00:00.000Z", limit: 50 });
    for (const bad of <Record<string, string>[]>[{ state: "done" }, { owner: "sonora" }, { from: "yesterday" }, { from: "2026-10-02T00:00:00Z", to: "2026-10-01T00:00:00Z" }, { limit: "0" }, { limit: "101" }, { limit: "2.5" }, { q: "x".repeat(201) }])
      expect(() => query(bad), JSON.stringify(bad)).toThrow("invalid_query");
  });

  it("pages newest first with a stable tiebreak, so no batch is skipped or repeated across pages", () => {
    const same = "2026-10-20T00:00:00.000Z";
    // Mixed-case ids sort in byte order, as SQLite compares them.
    const f = storedProject([batch("a", same), batch("B", same), batch("c", "2026-10-21T00:00:00.000Z"), batch("d", "2026-10-19T00:00:00.000Z"), batch("e", same)]);
    const q: BatchQuery = { limit: 2 };
    const seen: string[] = [];
    let after: BatchPosition | undefined;
    for (let page = 0; page < 5; page += 1) {
      const result = f.page(q, after);
      expect(result.total).toBe(5);
      seen.push(...result.rows.map((row) => row.id));
      if (!result.next) break;
      after = result.next;
    }
    expect(seen).toEqual(["c", "e", "a", "B", "d"]);
  });

  it("filters by name, state, owner and a half-open time range", () => {
    const f = storedProject([
      batch("a", "2026-10-20T00:00:00.000Z", { name: "雨夜站台 Rain", state: "failed" }),
      batch("b", "2026-10-21T00:00:00.000Z", { name: "海岸来信" }),
      batch("c", "2026-10-22T00:00:00.000Z", { name: "雨夜回声", items: [item({ id: "one" }), item({ id: "two", owner: "scaena" })] }),
    ]);
    expect(f.ids({ q: "雨夜", limit: 20 })).toEqual(["c", "a"]);
    expect(f.ids({ q: "rAIN", limit: 20 })).toEqual(["a"]);
    // `%` and `_` are plain characters in a search, not patterns.
    expect(f.ids({ q: "%", limit: 20 })).toEqual([]);
    expect(f.ids({ states: ["failed"], limit: 20 })).toEqual(["a"]);
    expect(f.ids({ owners: ["scaena"], limit: 20 })).toEqual(["c"]);
    expect(f.ids({ owners: ["eikona", "scaena"], states: ["succeeded"], limit: 20 })).toEqual(["c", "b"]);
    expect(f.ids({ from: "2026-10-21T00:00:00.000Z", to: "2026-10-22T00:00:00.000Z", limit: 20 })).toEqual(["b"]);
    // A batch id typed into the search finds that batch even when its name does not match.
    expect(f.ids({ q: "b", limit: 20 })).toEqual(["b"]);
    expect(f.page({ q: "雨夜", limit: 1 })).toMatchObject({ total: 2, next: { id: "c" } });
  });
});

describe("batch list and detail routes", () => {
  function setup({ running = 1, fail = true, status = "running" } = {}) {
    const rows = Array.from({ length: 25 }, (_, index) => { const day = String(index + 1).padStart(2, "0"); return batch(`b${day}`, `2026-10-${day}T00:00:00.000Z`); });
    for (let n = 0; n < running; n += 1) rows.push(batch(n ? `b-running-${n}` : "b-running", `2026-10-26T00:00:${String(n).padStart(2, "0")}.000Z`, { state: "running", items: [item({ state: "running", operation_ref: `eikona-batch:running-${n}` })] }));
    const { db, auth, service, admin, org, project } = storedProject(rows);
    let ownerReads = 0, active = 0, peak = 0;
    const read = new Set<string>(), operations = new Set<string>();
    const owners = { imageBatch: async (operation: string, _session: unknown, _scope: unknown, body: { operation_ref: string }) => {
      ownerReads += 1; active += 1; peak = Math.max(peak, active); read.add(body.operation_ref); operations.add(operation);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      if (fail) throw new Error("owner offline");
      return { schema_version: "eikona.batch_member_page.v1", operation_ref: body.operation_ref, request_batch_ref: "in", request_batch_digest: "d", plan_digest: "p", items: [], status };
    } };
    const [member] = service.execute(admin, "organization.member.set", org, "0", { identity: "test|member", role: "member", status: "active" });
    service.execute(admin, "project.members.set", project, "1", { grants: [{ subject_type: "member", subject_id: member, role: "viewer" }] });
    for (const subject of ["admin", "stranger", "member"]) auth.sessions.set(subject, session(subject));
    const app = createApp(config, { db, auth, readers: owners as never });
    const call = async (path: string, subject = "admin") => {
      const response = await app(new Request(`${origin}/api/control-center/v1${path}`, { headers: subject ? { Cookie: `yeisme_session=${subject}` } : {} }));
      return { status: response.status, body: await response.json() };
    };
    const get = (path: string, subject = "admin") => call(`/projects/${project}${path}`, subject);
    const suspend = () => service.execute(admin, "organization.member.set", org, "1", { identity: "test|member", role: "member", status: "suspended" });
    return { get, call, project, auth, suspend, reads: () => ownerReads, peak: () => peak, distinct: () => read.size, operations: () => [...operations] };
  }

  it("returns one page at a time, observes only that page, and reports an owner it could not read", async () => {
    const f = setup();
    const first = await f.get("/generation-batches?limit=10");
    expect(first.status).toBe(200);
    expect(first.body.rows.map((row: GenerationBatch) => row.id).slice(0, 2)).toEqual(["b-running", "b25"]);
    expect(first.body).toMatchObject({ total: 26, coverage: "partial", epoch: 1 });
    expect(first.body.sources).toEqual([{ owner: "eikona", project_ref: "rain", state: "source_unavailable", observed_at: expect.any(String), reason: "owner_unavailable" }]);
    // Only the one running batch on the page was observed, and its stored state stands.
    expect(f.reads()).toBe(1);
    expect(first.body.rows[0].state).toBe("running");
    const second = await f.get(`/generation-batches?limit=10&cursor=${encodeURIComponent(first.body.next_cursor)}`);
    expect(second.body.rows.map((row: GenerationBatch) => row.id)).toEqual(["b16", "b15", "b14", "b13", "b12", "b11", "b10", "b09", "b08", "b07"]);
    expect(second.body.coverage).toBe("complete");
    expect(f.reads()).toBe(1);
    // A cursor is bound to its filters: reusing it under another filter is refused rather than mixing pages.
    expect((await f.get(`/generation-batches?limit=10&state=succeeded&cursor=${encodeURIComponent(first.body.next_cursor)}`)).status).toBe(409);
    expect((await f.get("/generation-batches?cursor=forged.cursor")).status).toBe(400);
    expect((await f.get("/generation-batches?state=done")).status).toBe(400);
  });

  it("shares one owner read between a list and a detail asking about the same batch at the same time", async () => {
    const f = setup();
    const [list, detail] = await Promise.all([f.get("/generation-batches?limit=5"), f.get("/generation-batches/b-running")]);
    expect([list.status, detail.status]).toEqual([200, 200]);
    expect(f.reads()).toBe(1);
  });

  it("reads a bounded number of live items per request, a few at a time, and reaches the rest on the next poll", async () => {
    const f = setup({ running: 30, fail: false });
    const first = await f.get("/generation-batches?limit=30");
    expect(first.status).toBe(200);
    expect([f.reads(), f.peak()]).toEqual([observeBudget, observeParallel]);
    expect(first.body).toMatchObject({ coverage: "partial", sources: [{ owner: "eikona", project_ref: "rain", state: "not_checked", reason: "observation_deferred" }] });
    // The items left over are read first on the next poll.
    await f.get("/generation-batches?limit=30");
    expect(f.distinct()).toBe(30);
    // Observation only reads members: nothing is submitted, retried or reconciled by a list.
    expect(f.operations()).toEqual(["members"]);
  });

  it("announces a batch that finishes once, and not again on later reads or when paging back to old batches", async () => {
    const f = setup({ fail: false, status: "succeeded" });
    await f.get("/generation-batches?limit=5");
    await f.get("/generation-batches?limit=5");
    await f.get("/generation-batches/b-running");
    // Batches that finished before anyone looked are not announced by paging through them.
    await f.get("/generation-batches?limit=100");
    const reminders = await f.call(`/notifications?scope=${f.project}`);
    expect(reminders.status).toBe(200);
    expect((reminders.body.rows as { category: string; title: string }[]).filter((row) => row.category === "generation_batch").map((row) => row.title)).toEqual(["批次「批次 b-running」已完成"]);
  });

  it("ends a cursor with the login, the session epoch, its 15 minutes or the reader's access, and answers an empty filter plainly", async () => {
    const f = setup();
    expect((await f.get("/generation-batches", "")).status).toBe(401);
    const empty = await f.get("/generation-batches?q=" + encodeURIComponent("没有这样的批次"));
    expect(empty.body).toMatchObject({ rows: [], total: 0, next_cursor: null, coverage: "complete", sources: [] });
    // Sharing changes bump every session's epoch, and a cursor from the earlier epoch is refused.
    const page = await f.get("/generation-batches?limit=5");
    f.auth.sessions.bumpAll();
    expect((await f.get(`/generation-batches?limit=5&cursor=${encodeURIComponent(page.body.next_cursor)}`)).body.error).toBe("cursor_expired");
    const fresh = await f.get("/generation-batches?limit=5");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 16 * 60_000);
      expect((await f.get(`/generation-batches?limit=5&cursor=${encodeURIComponent(fresh.body.next_cursor)}`)).body.error).toBe("cursor_expired");
    } finally { vi.useRealTimers(); }
    // A member who loses access gets the same answer as someone who never had it, cursor or not.
    const seen = await f.get("/generation-batches?limit=5", "member");
    expect(seen.status).toBe(200);
    f.suspend();
    const revoked = await f.get(`/generation-batches?limit=5&cursor=${encodeURIComponent(seen.body.next_cursor)}`, "member");
    expect([revoked.status, (await f.get("/generation-batches/b02", "member")).status]).toEqual([404, 404]);
  });

  it("keeps an owner's own error text out of the response", async () => {
    const f = setup();
    const list = await f.get("/generation-batches");
    const detail = await f.get("/generation-batches/b-running");
    expect(JSON.stringify([list.body, detail.body])).not.toContain("owner offline");
    expect(detail.body.sources[0].reason).toBe("owner_unavailable");
  });

  it("opens one batch by id, even one far from the first page, and answers alike for missing and unseen batches", async () => {
    const f = setup();
    const opened = await f.get("/generation-batches/b02");
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ batch: { id: "b02", project_id: f.project }, coverage: "complete", epoch: 1 });
    expect(f.reads()).toBe(0);
    const missing = await f.get("/generation-batches/nope");
    const unseen = await f.get("/generation-batches/b02", "stranger");
    expect([missing.status, unseen.status]).toEqual([404, 404]);
    expect(missing.body.error).toBe(unseen.body.error);
  });
});
