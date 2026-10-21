import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMemoryDB,
  defaultDatabasePath,
  migrateDatabase,
  openDatabase,
} from "../server/db/client";
import { SessionStore } from "../server/db/session-store";
import { RunStore } from "../server/db/run-store";
import { AuditStore } from "../server/db/audit";
import type { Session, ServerConfig } from "../server/contracts";
import type {
  ProviderRunProjection,
  UsageEventProjection,
} from "../server/provider-live";

const session = (over: Partial<Session> = {}): Session => ({
  id: "s1",
  issuer: "yeisme:personal",
  subject: "owner",
  name: "Owner",
  csrf: "csrf-1",
  accessToken: "",
  accessAudience: ["aud-a", "aud-b"],
  expires: Date.now() + 600_000,
  personal: true,
  last_seen: Date.now(),
  epoch: 1,
  ...over,
});

const run = (over: Partial<ProviderRunProjection> = {}): ProviderRunProjection => ({
  run_ref: "run_1",
  owner: "eikona",
  modality: "image",
  model_ref: "openai/gpt-image-2.5-sunburst",
  scope_id: "scope-1",
  project_ref: "project-1",
  trace_ref: "trace_1",
  source_ref: "eikona-run-1",
  state: "queued",
  output_refs: ["artifact:one"],
  upstream_cost: 0.4,
  currency: "CNY",
  cost_state: "confirmed",
  observed_at: "2026-10-12T08:00:00Z",
  created_at: "2026-10-12T08:00:00Z",
  evidence_refs: [],
  error_code: null,
  connection_state: "configured",
  ...over,
});

const usage = (over: Partial<UsageEventProjection> = {}): UsageEventProjection => ({
  source_ref: "eikona-run-1",
  trace_ref: "trace_1",
  owner: "eikona",
  model_ref: "openai/gpt-image-2.5-sunburst",
  modality: "image",
  quantity: 1,
  unit: "images",
  upstream_cost: 0.4,
  currency: "CNY",
  cost_state: "confirmed",
  status: "succeeded",
  project_ref: "project-1",
  created_at: "2026-10-12T08:00:00Z",
  ...over,
});

describe("control center persistence", () => {
  it("round-trips sessions with audiences, epoch bumps, pruning and subject scoping", () => {
    const store = new SessionStore(createMemoryDB());
    store.set("s1", session());
    store.set("s2", session({ id: "s2", subject: "other" }));
    const loaded = store.get("s1")!;
    expect(loaded.accessAudience).toEqual(["aud-a", "aud-b"]);
    expect(loaded.personal).toBe(true);
    expect(loaded.epoch).toBe(1);
    expect(store.size).toBe(2);
    store.bumpAll();
    expect(store.get("s1")!.epoch).toBe(2);
    store.bumpSubject("yeisme:personal", "other");
    expect(store.get("s2")!.epoch).toBe(3);
    expect(store.get("s1")!.epoch).toBe(2);
    store.set("expired", session({ id: "expired", expires: Date.now() - 1 }));
    store.prune();
    expect(store.has("expired")).toBe(false);
    expect([...store.values()].map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("keeps sessions and runs across a restart on the same database file", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-db-"));
    try {
      const path = join(dir, "control-center.json.sqlite");
      const first = openDatabase(path);
      migrateDatabase(first);
      new SessionStore(first).set("s1", session());
      const runs = new RunStore(first);
      runs.insertRun(run(), 3);
      runs.insertRun(run({ run_ref: "run_2", state: "succeeded" }), 5);

      // Simulated restart: a fresh handle over the same file.
      const second = openDatabase(path);
      const recovered = new SessionStore(second).get("s1")!;
      expect(recovered.subject).toBe("owner");
      expect(recovered.accessAudience).toEqual(["aud-a", "aud-b"]);

      const restartedRuns = new RunStore(second);
      expect(restartedRuns.getRun("run_1")!.state).toBe("queued");
      const interrupted = restartedRuns.markInterrupted();
      expect(interrupted).toBe(1);
      const marked = restartedRuns.getRun("run_1")!;
      expect(marked.state).toBe("unknown");
      expect(marked.error_code).toBe("server_restarted");
      expect(restartedRuns.getRun("run_2")!.state).toBe("succeeded");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reserves budget only for non-terminal runs and releases on completion", () => {
    const store = new RunStore(createMemoryDB());
    store.insertRun(run(), 3);
    store.insertRun(run({ run_ref: "run_2", state: "running" }), 4);
    expect(store.reservedBudget()).toBe(7);
    store.updateRun(run({ state: "succeeded" }));
    expect(store.reservedBudget()).toBe(4);
    store.markInterrupted(); // unknown stays reserved, never silently freed
    expect(store.reservedBudget()).toBe(4);
    store.updateRun(run({ run_ref: "run_2", state: "failed" }));
    expect(store.reservedBudget()).toBe(0);
  });

  it("dedupes usage by owner source ref and keeps idempotency last-write-wins", () => {
    const db = createMemoryDB();
    const store = new RunStore(db);
    store.putUsage(usage());
    store.putUsage(usage({ upstream_cost: 0.5, status: "reconciled" }));
    const rows = store.usageRows("project-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].upstream_cost).toBe(0.5);
    expect(store.usageRows("other-project")).toHaveLength(0);
    store.putIdempotency("key-1", "run_1");
    store.putIdempotency("key-1", "run_2");
    expect(store.getIdempotency("key-1")).toBe("run_2");
  });

  it("defaults the database path beside the config file", () => {
    expect(defaultDatabasePath("/home/u/config/control-center.json")).toBe(
      "/home/u/config/control-center.sqlite",
    );
  });

  it("audit begin blocks on a broken database and complete never masks outcomes", () => {
    const real = createMemoryDB();
    const audit = new AuditStore(real);
    const id = audit.begin({
      actor: "yeisme:personal|owner",
      action: "requests.content_read",
      owner: "eikona",
      targetRef: "req-1",
      purpose: "operator review",
    });
    audit.complete(id, "succeeded");
    const page = audit.page({ limit: 25 });
    expect(page.rows[0].outcome).toBe("succeeded");
    expect(page.rows[0].meta).toBeNull();
    expect(page.next_before).toBeNull();

    const broken = new Proxy(real, {
      get(target, prop) {
        if (prop === "insert")
          return () => {
            throw new Error("disk full");
          };
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const failing = new AuditStore(broken as never);
    expect(() =>
      failing.begin({
        actor: "yeisme:personal|owner",
        action: "requests.content_read",
      }),
    ).toThrow("audit_unavailable");
    // complete is best-effort: the initiated row stays truthful.
    expect(() => audit.complete(999999, "failed")).not.toThrow();
  });

  it("paginates audit rows newest first with an action filter", () => {
    const audit = new AuditStore(createMemoryDB());
    for (let i = 0; i < 30; i++)
      audit.record(
        {
          actor: "yeisme:personal|owner",
          action: i % 2 === 0 ? "media.read" : "auth.login",
        },
        "succeeded",
      );
    const first = audit.page({ limit: 25 });
    expect(first.rows).toHaveLength(25);
    expect(first.rows[0].id).toBeGreaterThan(first.rows[24].id);
    const rest = audit.page({ limit: 25, before: first.rows[24].id });
    expect(rest.rows).toHaveLength(5);
    expect(rest.next_before).toBeNull();
    const mediaOnly = audit.page({ limit: 100, action: "media.read" });
    expect(mediaOnly.rows).toHaveLength(15);
    expect(mediaOnly.rows.every((r) => r.action === "media.read")).toBe(true);
  });

  it("derives the database config contract on ServerConfig", () => {
    const config = { database: { path: "/tmp/x.sqlite" } } as ServerConfig;
    expect(config.database?.path).toBe("/tmp/x.sqlite");
  });
});
