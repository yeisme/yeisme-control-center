import { describe, expect, it } from "vitest";
import { buildWorkQueue, filterAndPageWorkQueue } from "../server/work-queue";
import type { ScopeBinding, Session } from "../server/contracts";
import type { TaskSnapshot, TaskConnectionState } from "../src/task-observation";
import { sortWorkQueueItems, type WorkQueueItem } from "../src/shared/work-queue";
import type { CredentialStatus } from "../src/shared/credentials";

const scope: ScopeBinding = {
  id: "scope:one",
  tenant: "tenant:one",
  team: "team:one",
  project: "project:one",
  label: "测试范围",
  owners: {},
  collection: { auctra: { tenant: "tenant:one", project: "project:one", actor: "actor:one", audience: "audience:auctra" } },
};

const session: Session = {
  id: "session:one",
  issuer: "issuer:one",
  subject: "subject:one",
  name: "测试用户",
  accessToken: "",
  accessAudience: [],
  expires: Date.now() + 60_000,
  csrf: "csrf",
  personal: true,
  epoch: 4,
};

function task(overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    schema_version: "yeisme.task_observation.v1",
    locator: { owner: "eikona", instance_id: "instance:one", project: "project:one", task_family: "image", task_ref: "task:one" },
    task_key: "task:one",
    title: "测试任务",
    state: "failed",
    native_state: "failed",
    stage: "complete",
    revision: "rev:one",
    created_at: "2026-10-20T00:00:00.000Z",
    updated_at: "2026-10-20T00:01:00.000Z",
    observed_at: "2026-10-20T00:01:00.000Z",
    started_at: "2026-10-20T00:00:10.000Z",
    progress: { kind: "indeterminate", completed: null, total: null, percent: null },
    source: "fixture",
    actor: "actor:one",
    parent_ref: null,
    results: [],
    allowed_actions: [],
    coverage: "complete",
    ...overrides,
  };
}

function connection(overrides: Partial<TaskConnectionState> = {}): TaskConnectionState {
  return {
    id: "connection:one",
    owner: "sonora",
    instance_id: "instance:sonora",
    label: "Sonora",
    environment: "fixture",
    project: "project:one",
    state: "needs_contract",
    observed_at: "2026-10-20T00:02:00.000Z",
    ...overrides,
  };
}

describe("work queue projection", () => {
  it("derives failure, review, handoff, source blocker and contract-gap items", () => {
    const response = buildWorkQueue({
      scope,
      session,
      tasks: [
        task(),
        task({ task_key: "task:review", state: "waiting_review", native_state: "waiting_review", title: "待审阅", locator: { ...task().locator, task_ref: "task:review" } }),
        task({ task_key: "task:handoff", state: "handoff_ready", native_state: "handoff_ready", title: "待交接", locator: { ...task().locator, task_ref: "task:handoff" } }),
      ],
      connections: [connection()],
      notifications: [],
    }, Date.parse("2026-10-20T00:04:00.000Z"));

    expect(response.schema_version).toBe("yeisme.work_queue.v1");
    expect(response.epoch).toBe(4);
    expect(response.items.map((item) => item.kind)).toEqual(expect.arrayContaining([
      "task_failure",
      "review_required",
      "handoff_ready",
      "contract_gap",
    ]));
    expect(response.counts.contract_gap).toBeGreaterThan(0);
  });

  it("does not duplicate a live task when a matching reminder exists", () => {
    const response = buildWorkQueue({
      scope,
      session,
      tasks: [task()],
      connections: [],
      notifications: [{
        id: "notification:one",
        scope_id: scope.id,
        session_id: session.id,
        subject: session.subject,
        task_key: "task:one",
        task_revision: "rev:one",
        failure_fingerprint: "fingerprint",
        state: "unread",
        priority: "normal",
        presence: "live",
        task_state: "failed",
        native_state: "failed",
        title: "同一任务提醒",
        owner: "eikona",
        project: "project:one",
        first_seen_at: "2026-10-20T00:00:00.000Z",
        last_seen_at: "2026-10-20T00:01:00.000Z",
        acknowledged_at: null,
        muted_at: null,
        archived_at: null,
        snoozed_until: null,
        last_error_code: "same_failure",
        reopened: false,
      }],
    });
    expect(response.items.filter((item) => item.source_ref === "task:one")).toHaveLength(1);
  });

  it("meets reminders on the task identity, and leaves handled failure versions off the queue", () => {
    const reminder = (over: Record<string, unknown>) => ({
      id: "n", scope_id: scope.id, session_id: "", subject: session.subject, task_key: "task:one.sig-old", task_revision: "rev:one",
      failure_fingerprint: "fp", state: "unread", priority: "normal", presence: "live", task_state: "failed", native_state: "failed",
      title: "旧签名提醒", owner: "eikona", project: "project:one", first_seen_at: "2026-10-20T00:00:00.000Z", last_seen_at: "2026-10-20T00:01:00.000Z",
      acknowledged_at: null, muted_at: null, archived_at: null, snoozed_until: null, last_error_code: "", reopened: false, ...over,
    }) as never;
    // After a restart the live task carries a newly signed key; the reminder still names the same task.
    const live = buildWorkQueue({ scope, session, tasks: [task({ task_key: "task:one.sig-new" })], connections: [], notifications: [reminder({}), reminder({ id: "n2" })] });
    expect(live.items.filter((item) => item.kind === "task_failure")).toHaveLength(1);
    const archived = buildWorkQueue({ scope, session, tasks: [task({ task_key: "task:one.sig-new" })], connections: [], notifications: [reminder({ state: "archived" })] });
    expect(archived.items.filter((item) => item.kind === "task_failure")).toHaveLength(0);
    // A newer failure version of the same task is not hidden by the archived older one.
    const newer = buildWorkQueue({ scope, session, tasks: [task({ task_key: "task:one.sig-new", revision: "rev:two" })], connections: [], notifications: [reminder({ state: "archived" })] });
    expect(newer.items.filter((item) => item.kind === "task_failure")).toHaveLength(1);
  });

  it("turns only task-failure reminders into task items, never a batch, project, operation or credential reminder", () => {
    const reminder = (over: Record<string, unknown>) => ({
      id: "n", scope_id: scope.id, session_id: "", subject: session.subject, task_key: "", task_revision: "", task_identity: "",
      failure_fingerprint: "fp", state: "unread", priority: "normal", presence: "live", task_state: "succeeded", native_state: "",
      title: "提醒", owner: "control-center", project: "project:one", first_seen_at: "2026-10-20T00:00:00.000Z", last_seen_at: "2026-10-20T00:01:00.000Z",
      acknowledged_at: null, muted_at: null, archived_at: null, snoozed_until: null, last_error_code: "", reopened: false, ...over,
    }) as never;
    const queue = (notifications: unknown[]) => buildWorkQueue({ scope, session, tasks: [], connections: [], notifications: notifications as never }).items;
    const others = ["generation_batch", "project_assignment", "operation", "credential"].map((category) => reminder({ id: category, category, title: category, failure_fingerprint: category }));
    expect(queue(others)).toEqual([]);
    // Even one that carries a failing state (an operation reminder keeps the run's state) is not a failed task.
    expect(queue([reminder({ id: "op", category: "operation", task_state: "failed", owner: "drivebridge", failure_fingerprint: "op", title: "DriveBridge 导出失败" })])).toEqual([]);
    // A failure reminder with no category, or the default one, still stands for its task while the task is not listed.
    const failure = (category: string | undefined) => queue([reminder({ id: "f", ...(category ? { category } : {}), task_key: "task:gone.sig", task_state: "failed", native_state: "failed", owner: "eikona", title: "已消失的失败" })]);
    for (const category of [undefined, "failure"]) expect(failure(category).map((item) => `${item.kind}:${item.title}`)).toEqual(["task_failure:已消失的失败"]);
    expect(queue([reminder({ id: "u", category: "failure", task_key: "task:gone.sig", task_state: "unknown", owner: "sonora" })]).map((item) => item.kind)).toEqual(["task_unknown"]);
    // Handled operation reminders do not hide a real task failure that shares nothing with them.
    const mixed = buildWorkQueue({ scope, session, tasks: [task()], connections: [], notifications: [reminder({ id: "op", category: "operation", state: "archived", task_state: "failed" })] });
    expect(mixed.items.filter((item) => item.kind === "task_failure")).toHaveLength(1);
  });

  it("sorts by risk before freshness and binds paging to filtered items", () => {
    const items = [
      { work_ref: "low", kind: "handoff_ready", owner: "auctra", project: "p", scope_id: "s", title: "low", state: "handoff_ready", native_state: "handoff_ready", priority: "normal", attention_reason: "", observed_at: "2026-10-20T00:10:00Z", freshness: "fresh", coverage: "complete", revision: "", source_ref: "low", safe_links: [], allowed_actions: [], preview_state: "needs_contract" },
      { work_ref: "high", kind: "task_unknown", owner: "eikona", project: "p", scope_id: "s", title: "high", state: "unknown", native_state: "unknown", priority: "critical", attention_reason: "", observed_at: "2026-10-20T00:01:00Z", freshness: "fresh", coverage: "unknown", revision: "", source_ref: "high", safe_links: [], allowed_actions: [], preview_state: "not_applicable" },
    ] as WorkQueueItem[];
    expect(sortWorkQueueItems(items).map((item) => item.work_ref)).toEqual(["high", "low"]);
    const response = { schema_version: "yeisme.work_queue.v1" as const, epoch: 1, scope: "s", observed_at: "2026-10-20T00:00:00Z", coverage: { state: "complete" as const, observed_at: "2026-10-20T00:00:00Z", sources: [] }, counts: { total: 2, actionable: 2, blocked: 1, review_required: 0, unknown: 1, handoff_ready: 1, stale: 0, contract_gap: 0 }, items };
    const page = filterAndPageWorkQueue(response, { kind: "task_unknown" }, 0, 1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.work_ref).toBe("high");
    expect(page.next_offset).toBeUndefined();
  });
});

describe("work queue: episode flow attention", () => {
  const stageOf = (stage: string, state: string, extra: Record<string, unknown> = {}) => ({
    stage, owner: stage === "production_breakdown" ? "scaena" : "auctra", object_kind: stage, source_ref: `${stage}-ref`, state, native_state: state, revision: "1", observed_at: new Date().toISOString(), freshness: "fresh", coverage: "complete", source_current: state === "accepted", blockers: [], safe_refs: [], project_ref: "project:one", episode_ref: "ep-1", ...extra,
  });
  const flowOf = (stages: unknown[], episode = "ep-1") => ({ schema_version: "yeisme.creative_flow.v1" as const, scope: scope.id, project_ref: "project:one", episode_ref: episode, observed_at: new Date().toISOString(), coverage: "partial" as const, source_coverage: [], stages: stages as never, edges: [], launch_contexts: [] });
  const queue = (creativeFlows: ReturnType<typeof flowOf>[]) => buildWorkQueue({ scope, session, tasks: [], connections: [], notifications: [], creativeFlows });
  const flowItems = (response: ReturnType<typeof queue>) => response.items.filter((item) => item.workflow_stage).map((item) => `${item.workflow_stage}:${item.kind}`);

  it("does not queue stages that are unstarted, running, or merely waiting for Auctra to accept", () => {
    const response = queue([flowOf([
      stageOf("screenplay", "blocked", { native_state: "missing", blockers: ["source_not_accepted"] }),
      stageOf("director_plan", "missing"),
      stageOf("creative_storyboard", "missing"),
      stageOf("production_handoff", "missing"),
      stageOf("production_breakdown", "in_progress", { native_state: "running" }),
    ])]);
    expect(flowItems(response)).toEqual([]);
  });

  it("queues genuine problems with their own blockers", () => {
    const response = queue([flowOf([stageOf("screenplay", "accepted"), stageOf("production_breakdown", "blocked", { native_state: "failed", blockers: ["breakdown_cancelled"] })])]);
    expect(flowItems(response)).toEqual(["production_breakdown:service_blocked"]);
  });

  it("does not offer a handoff that Scaena has already taken up, but does before that", () => {
    const handoff = stageOf("production_handoff", "accepted");
    expect(flowItems(queue([flowOf([handoff])]))).toEqual(["production_handoff:handoff_ready"]);
    expect(flowItems(queue([flowOf([handoff, stageOf("production_breakdown", "waiting_review", { native_state: "review_required" })])]))).toEqual(["production_breakdown:review_required"]);
  });

  it("merges several episodes without collapsing them, and emits at most one contract gap", () => {
    const review = (episode: string) => flowOf([stageOf("creative_storyboard", "waiting_review", { episode_ref: episode, source_ref: `storyboard-${episode}` })], episode);
    expect(queue([review("ep-1"), review("ep-2")]).items.filter((item) => item.workflow_stage === "creative_storyboard")).toHaveLength(2);
    const gaps = queue([flowOf([]), flowOf([], "ep-2"), flowOf([], "ep-3")]).items.filter((item) => item.kind === "contract_gap" && item.object_kind === "creative_flow");
    expect(gaps).toHaveLength(1);
  });
});

describe("work queue: flow item wording", () => {
  it("titles an episode problem in Chinese with the episode, never a raw stage code", () => {
    const now = new Date().toISOString();
    const flow = { schema_version: "yeisme.creative_flow.v1" as const, scope: scope.id, project_ref: "project:one", episode_ref: "ep-2", observed_at: now, coverage: "partial" as const, source_coverage: [], edges: [], launch_contexts: [], stages: [{ stage: "creative_storyboard", owner: "auctra", object_kind: "storyboard_plan", source_ref: "storyboard:ep02-r1", state: "waiting_review", native_state: "pending_review", revision: "1", observed_at: now, freshness: "fresh", coverage: "complete", source_current: true, blockers: [], safe_refs: [], project_ref: "project:one", episode_ref: "ep-2" }] as never };
    const item = buildWorkQueue({ scope, session, tasks: [], connections: [], notifications: [], creativeFlows: [flow] }).items.find((candidate) => candidate.workflow_stage);
    expect(item?.title).toBe("创意分镜 · ep-2");
    expect(item?.source_ref).toBe("storyboard:ep02-r1");
  });
});

describe("work queue: coverage, outages and sampling for episode flows", () => {
  const at = new Date().toISOString();
  const coverageOf = (response: ReturnType<typeof buildWorkQueue>, owner: string) => response.coverage.sources.find((source) => source.owner === owner);
  const flow = (extra: Record<string, unknown> = {}) => ({ schema_version: "yeisme.creative_flow.v1" as const, scope: scope.id, project_ref: "project:one", episode_ref: "ep-1", observed_at: at, coverage: "partial" as const, source_coverage: [{ owner: "auctra" as const, state: "complete" as const, observed_at: at }, { owner: "scaena" as const, state: "complete" as const, observed_at: at }], stages: [], edges: [], launch_contexts: [], ...extra });
  const stage = (name: string, state: string, extra: Record<string, unknown> = {}) => ({ stage: name, owner: name === "production_breakdown" ? "scaena" : "auctra", object_kind: name, source_ref: `${name}-ref`, state, native_state: state, revision: "1", observed_at: at, freshness: "fresh", coverage: "complete", source_current: state === "accepted", blockers: [], safe_refs: [], project_ref: "project:one", episode_ref: "ep-1", ...extra });

  it("shows an owner outage as a queue item and in coverage, instead of dropping the owner", () => {
    const outage = flow({ source_coverage: [{ owner: "auctra", state: "unavailable", observed_at: at, reason: "owner_unavailable" }, { owner: "scaena", state: "complete", observed_at: at }], stages: [stage("production_breakdown", "accepted")] });
    const response = buildWorkQueue({ scope, session, tasks: [], connections: [], notifications: [], creativeFlows: [outage as never] });
    expect(coverageOf(response, "auctra")).toMatchObject({ state: "unavailable", reason: "owner_unavailable" });
    expect(response.coverage.state).toBe("partial");
    expect(response.items.filter((item) => item.kind === "service_blocked" && item.owner === "auctra")).toHaveLength(1);
  });

  it("does not turn an outage into a 'missing contract' item", () => {
    const down = flow({ source_coverage: [{ owner: "auctra", state: "unavailable", observed_at: at }, { owner: "scaena", state: "unavailable", observed_at: at }] });
    const response = buildWorkQueue({ scope, session, tasks: [], connections: [], notifications: [], creativeFlows: [down as never] });
    expect(response.items.some((item) => item.kind === "contract_gap")).toBe(false);
    expect(response.items.filter((item) => item.kind === "service_blocked")).toHaveLength(2);
  });

  it("keeps the worst state per owner across episodes, not the latest", () => {
    const healthy = flow({ stages: [stage("screenplay", "accepted")] });
    const broken = flow({ episode_ref: "ep-2", source_coverage: [{ owner: "auctra", state: "forbidden", observed_at: at }, { owner: "scaena", state: "complete", observed_at: at }] });
    const response = buildWorkQueue({ scope, session, tasks: [], connections: [], notifications: [], creativeFlows: [healthy as never, broken as never] });
    expect(coverageOf(response, "auctra")?.state).toBe("forbidden");
    const reversed = buildWorkQueue({ scope, session, tasks: [], connections: [], notifications: [], creativeFlows: [broken as never, healthy as never] });
    expect(coverageOf(reversed, "auctra")?.state).toBe("forbidden");
  });

  it("says when it only looked at the most recently updated episodes", () => {
    const response = buildWorkQueue({ scope, session, tasks: [], connections: [], notifications: [], creativeFlows: [flow({ stages: [stage("screenplay", "accepted")] }) as never], flowSample: { checked: 3, total: 9 } });
    expect(coverageOf(response, "auctra")).toMatchObject({ state: "partial", reason: "episodes_sampled" });
    const full = buildWorkQueue({ scope, session, tasks: [], connections: [], notifications: [], creativeFlows: [flow({ stages: [stage("screenplay", "accepted")] }) as never], flowSample: { checked: 3, total: 3 } });
    expect(coverageOf(full, "auctra")?.state).toBe("complete");
  });

  it("still offers the handoff while the breakdown was built from an older screenplay", () => {
    const handoff = stage("production_handoff", "accepted");
    const stale = stage("production_breakdown", "accepted", { source_current: false, blockers: ["screenplay_revision_mismatch"] });
    const kinds = buildWorkQueue({ scope, session, tasks: [], connections: [], notifications: [], creativeFlows: [flow({ stages: [handoff, stale] }) as never] }).items.filter((item) => item.workflow_stage).map((item) => `${item.workflow_stage}:${item.kind}`).sort();
    expect(kinds).toEqual(["production_handoff:handoff_ready"]);
  });

  it("names the stage's own project in the command templates when the owner's project differs from the scope's", () => {
    const review = stage("creative_storyboard", "waiting_review", { project_ref: "project:auctra-own" });
    const item = buildWorkQueue({ scope, session, tasks: [], connections: [], notifications: [], creativeFlows: [flow({ stages: [review] }) as never] }).items.find((candidate) => candidate.workflow_stage);
    const command = item?.safe_links.find((link) => link.target === "auctra")?.command || "";
    expect(command).toContain("project:auctra-own");
    expect(command).not.toContain("'project:one'");
  });
});

describe("work queue: credential renewal", () => {
  const observedAt = "2026-11-01T12:00:00.000Z";
  const now = Date.parse(observedAt);
  const credential = (over: Partial<CredentialStatus>): CredentialStatus => ({ id: "open_tool:gateway", owner: "gateway", label: "MCP Gateway", state: "rejected", reason: "unauthenticated", shared_with: [], ...over });
  const gatewayDown = { tool: "gateway", label: "MCP Gateway", state: "forbidden", reason: "open_tool_unauthenticated", observed_at: observedAt, freshness: "fresh", coverage: { state: "forbidden" }, checks: [], backends: [], operations: { attention: [] } } as never;
  const refusedConnection = connection({ id: "eikona-main", owner: "eikona", label: "Eikona 主库", state: "needs_authorization", observed_at: observedAt, runtime: { state: "needs_authorization", checked_at: observedAt, last_success_at: null, transport: "verified", authorization: "denied", contract: "unknown", task_families: [], content: "not_requested", reason: "needs_authorization" } });
  const queue = (credentials: CredentialStatus[], extra: Partial<Parameters<typeof buildWorkQueue>[0]> = {}) => buildWorkQueue({ scope, session, tasks: [], connections: [], notifications: [], credentials, ...extra }, now);
  const kinds = (response: ReturnType<typeof queue>) => response.items.map((item) => `${item.kind}:${item.source_ref}`);

  it("adds one item per credential that cannot be used or will not be for long, linked to the credentials and the renewal steps of its tool", () => {
    const response = queue([
      credential({}),
      credential({ id: "open_tool:drivebridge", owner: "drivebridge", label: "DriveBridge", state: "expiring", stage: "1d", reason: undefined, days_left: 1, expires_at: "2026-11-02T08:00:00.000Z" }),
      credential({ id: "connection:eikona-main", owner: "eikona", label: "Eikona 主库", state: "unreadable", reason: "permissions" }),
      credential({ id: "provider:sonora", owner: "sonora", label: "Sonora 生成", state: "expired", reason: undefined }),
      // Nothing to do about these: the credentials panel shows a limited one, and nothing is pushed at anyone.
      credential({ id: "connection:lim", owner: "scaena", label: "Scaena", state: "limited", reason: "content_denied" }),
      credential({ id: "open_tool:lim", owner: "gateway", label: "MCP Gateway", state: "limited", reason: "read_forbidden" }),
      credential({ id: "connection:b", state: "ok", reason: undefined }),
      credential({ id: "connection:c", state: "unknown_expiry", reason: undefined }),
    ]);
    expect(kinds(response).sort()).toEqual(["credential_renewal:connection:eikona-main", "credential_renewal:open_tool:drivebridge", "credential_renewal:open_tool:gateway", "credential_renewal:provider:sonora"]);
    const gateway = response.items.find((item) => item.source_ref === "open_tool:gateway")!;
    expect(gateway).toMatchObject({ title: "MCP Gateway · 凭据被拒", state: "rejected", priority: "critical", owner: "gateway", attention_reason: "unauthenticated", preview_state: "not_applicable", allowed_actions: [], credential: { slot: "open_tool:gateway", state: "rejected", reason: "unauthenticated" } });
    expect(gateway.safe_links).toEqual([
      { kind: "control-center", label: "查看凭据状态", target: "services", ref: "open_tool:gateway" },
      { kind: "control-center", label: "续签方法", target: "guide", ref: "guide-renew-gateway" },
    ]);
    // A tool without a guide section of its own points at the general one.
    expect(response.items.find((item) => item.source_ref === "provider:sonora")!.safe_links[1]).toMatchObject({ target: "guide", ref: "guide-renew" });
    const drive = response.items.find((item) => item.source_ref === "open_tool:drivebridge")!;
    expect(drive).toMatchObject({ title: "DriveBridge · 即将到期，还剩 1 天", state: "expiring", priority: "high", credential: { stage: "1d", days_left: 1, expires_at: "2026-11-02T08:00:00.000Z" } });
    expect(response.items.find((item) => item.source_ref === "connection:eikona-main")!.priority).toBe("critical");
    // A key the same on every read, whatever state the credential is in, so an open Inspector stays open.
    expect(queue([credential({ state: "expired", reason: undefined })]).items[0].work_ref).toBe(gateway.work_ref);
  });

  const connectionRow = (over: Partial<CredentialStatus>) => credential({ id: "connection:eikona-main", owner: "eikona", label: "Eikona 主库", ...over });

  it("replaces the service_blocked item of a refused or unreadable connection or tool, and only those", () => {
    // Without the credential rows the same facts make the old items.
    const plain = queue([], { connections: [refusedConnection], openTools: [gatewayDown] });
    expect(kinds(plain).sort()).toEqual(["service_blocked:eikona-main", "service_blocked:gateway"]);
    const refused = queue([credential({}), connectionRow({ state: "rejected", reason: "owner_denied" })], { connections: [refusedConnection], openTools: [gatewayDown] });
    expect(kinds(refused).sort()).toEqual(["credential_renewal:connection:eikona-main", "credential_renewal:open_tool:gateway"]);
    // An expiring credential does not explain why the tool is blocked, so both items stay.
    const expiring = queue([credential({ state: "expiring", stage: "7d", reason: undefined, days_left: 6 })], { openTools: [gatewayDown] });
    expect(kinds(expiring).sort()).toEqual(["credential_renewal:open_tool:gateway", "service_blocked:gateway"]);
    // A different tool's item is not touched, nor are a backend of this one or a contract gap.
    const backends = { ...(gatewayDown as object), backends: [{ id: "b1", enabled: true, state: "down", native_state: "down", checked_at: observedAt }] } as never;
    expect(kinds(queue([credential({})], { openTools: [backends] })).sort()).toEqual(["credential_renewal:open_tool:gateway", "service_blocked:gateway:b1"]);
    expect(kinds(queue([credential({ id: "open_tool:drivebridge", owner: "drivebridge" })], { openTools: [gatewayDown] })).sort()).toEqual(["credential_renewal:open_tool:drivebridge", "service_blocked:gateway"]);
  });

  it("keeps the blocked item whose own reason the credential row does not explain", () => {
    const unreadableConnection = connection({ id: "eikona-main", owner: "eikona", label: "Eikona 主库", state: "credential_unreadable", observed_at: observedAt, runtime: { state: "credential_unreadable", checked_at: observedAt, last_success_at: null, transport: "unknown", authorization: "unknown", contract: "unknown", task_families: [], content: "not_requested", reason: "credential_unreadable" } });
    const gatewayUnreadable = { ...(gatewayDown as object), reason: "open_tool_credential_unreadable" } as never;
    const gatewayEndpoint = { ...(gatewayDown as object), state: "unavailable", reason: "open_tool_endpoint_denied", coverage: { state: "unavailable" } } as never;
    const gatewayUnavailable = { ...(gatewayDown as object), state: "unavailable", reason: "open_tool_unavailable", coverage: { state: "unavailable" } } as never;
    const fileOnly = { state: "unreadable", reason: "permissions" } as const;
    // The owner refused the credential, and the file is also not private: two facts, and the file alone does not explain the refusal.
    expect(kinds(queue([connectionRow(fileOnly)], { connections: [refusedConnection] })).sort()).toEqual(["credential_renewal:connection:eikona-main", "service_blocked:eikona-main"]);
    // A tool whose address is refused is blocked for that, not for the credential.
    expect(kinds(queue([credential(fileOnly)], { openTools: [gatewayEndpoint] })).sort()).toEqual(["credential_renewal:open_tool:gateway", "service_blocked:gateway"]);
    // A refusal seen before the tool went away does not explain that it is down now.
    expect(kinds(queue([credential({})], { openTools: [gatewayUnavailable] })).sort()).toEqual(["credential_renewal:open_tool:gateway", "service_blocked:gateway"]);
    // The credential could not be read, and the blocked item says exactly that: one item.
    expect(kinds(queue([connectionRow({ state: "unreadable", reason: "read_failed" })], { connections: [unreadableConnection] }))).toEqual(["credential_renewal:connection:eikona-main"]);
    expect(kinds(queue([credential({ state: "unreadable", reason: "permissions" })], { openTools: [gatewayUnreadable] }))).toEqual(["credential_renewal:open_tool:gateway"]);
    // A refusal by the tool itself (a 403) is the credential's too.
    expect(kinds(queue([credential({ reason: "forbidden" })], { openTools: [{ ...(gatewayDown as object), reason: "open_tool_forbidden" } as never] }))).toEqual(["credential_renewal:open_tool:gateway"]);
  });

  it("counts a refused, unreadable or expired credential as blocking, and an expiring one as not", () => {
    const counts = (state: CredentialStatus["state"]) => queue([credential({ state, reason: undefined })]).counts.blocked;
    expect([counts("rejected"), counts("unreadable"), counts("expired"), counts("expiring"), counts("limited")]).toEqual([1, 1, 1, 0, 0]);
  });

  it("makes no item for a limited credential, and leaves the blocked item of its tool as it is", () => {
    const limited = credential({ state: "limited", reason: "read_forbidden" });
    expect(queue([limited]).items).toEqual([]);
    expect(queue([limited]).counts.total).toBe(0);
    // The tool is down for a reason of its own: that item stays, and the limited credential adds nothing next to it.
    expect(kinds(queue([limited], { openTools: [gatewayDown] }))).toEqual(["service_blocked:gateway"]);
  });

  it("is built from the rows it is given and asks nobody: no credential rows, no credential items", () => {
    expect(queue([]).items).toEqual([]);
    expect(queue(undefined as never).items).toEqual([]);
  });
});
