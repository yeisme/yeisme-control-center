import { describe, expect, it } from "vitest";
import { ActionService } from "../server/actions";
import { runAction } from "../src/shared/action-runner";
import type { ActionPreviewRequest } from "../src/shared/action-contract";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import type { ServerConfig, Session } from "../server/contracts";

const input: ActionPreviewRequest = {
  scope_id: "scope-1",
  owner: "control-center",
  target_kind: "task",
  target_ref: "task-1",
  action: "task.cancel",
  expected_revision: "rev-1",
  idempotency_key: "cancel_task_0001",
  input: { confirm: true, expected_revision: "rev-1", idempotency_key: "cancel_task_0001" },
};

describe("control center action contract", () => {
  it("previews allowlisted actions without touching an owner", () => {
    const service = new ActionService();
    const preview = service.preview(input);
    expect(preview.availability).toBe("available");
    expect(preview.blockers).toEqual([]);
    expect(preview.preview_digest).toMatch(/^sha256:/);
  });

  it("keeps owner actions explicitly blocked until their contract exists", async () => {
    const service = new ActionService();
    const preview = service.preview({ ...input, owner: "eikona", action: "review.approve", target_kind: "review", input: { version_ref: "v1" } });
    expect(preview.availability).toBe("needs_contract");
    const receipt = await service.confirm({ scope_id: "scope-1", preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: input.idempotency_key }, async (record) => ActionService.unavailable(record, "owner_review_contract_not_configured"));
    expect(receipt.state).toBe("needs_contract");
  });

  it("builds one receipt shape for every outcome: succeeded, any other settled state, and a refusal", async () => {
    const service = new ActionService();
    const preview = service.preview(input);
    const record = service.record(preview.preview_ref, "legacy", "scope-1");
    const done = ActionService.succeeded(record);
    expect(done).toEqual({ receipt_ref: expect.stringMatching(/^receipt_[0-9a-f]{32}$/), action: "task.cancel", owner: "control-center", target_ref: "task-1", state: "succeeded", owner_state: null, error_code: null, observed_at: expect.any(String), operation_ref: null, result_refs: [] });
    expect(Object.keys(done)).toEqual(["receipt_ref", "action", "owner", "target_ref", "state", "owner_state", "error_code", "observed_at", "operation_ref", "result_refs"]);
    const detailed = ActionService.succeeded(record, { owner_state: "updated", operation_ref: "op-1", result_refs: ["a", "b"], observed_at: "2026-10-30T00:00:00.000Z", generation_items: [] });
    expect(detailed).toMatchObject({ state: "succeeded", owner_state: "updated", error_code: null, operation_ref: "op-1", result_refs: ["a", "b"], observed_at: "2026-10-30T00:00:00.000Z", generation_items: [] });
    // Items appear only when there are some to carry, and always last.
    expect(Object.keys(detailed).at(-1)).toBe("generation_items");
    expect("generation_items" in done).toBe(false);
    expect(ActionService.outcome(record, "unknown", { error_code: "generation_reconcile_required", owner_state: "unknown" })).toMatchObject({ state: "unknown", error_code: "generation_reconcile_required", owner_state: "unknown" });
    expect(ActionService.outcome(record, "submitted", { owner_state: "running" }).state).toBe("submitted");
    expect(ActionService.unavailable(record, "owner_action_adapter_not_configured")).toMatchObject({ state: "needs_contract", error_code: "owner_action_adapter_not_configured", owner_state: null, result_refs: [] });
    // Two receipts never share a reference.
    expect(ActionService.succeeded(record).receipt_ref).not.toBe(done.receipt_ref);
  });

  it("reuses a receipt for the same preview and idempotency key", async () => {
    const service = new ActionService();
    const preview = service.preview(input);
    let executions = 0;
    const execute = async (record: Parameters<NonNullable<Parameters<typeof service.confirm>[1]>>[0]) => {
      executions += 1;
      return { ...ActionService.unavailable(record, "test"), state: "succeeded" as const };
    };
    const request = { scope_id: "scope-1", preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: input.idempotency_key };
    const first = await service.confirm(request, execute);
    const second = await service.confirm(request, execute);
    expect(first.receipt_ref).toBe(second.receipt_ref);
    expect(executions).toBe(1);
    expect(() => service.receipt(first.receipt_ref, "scope-2")).toThrowError(/scope_denied/);
  });
});

describe("action runner", () => {
  it("does not confirm a preview blocked by a missing owner contract", async () => {
    const phases: string[] = [];
    const result = await runAction({
      previewAction: async () => ({ preview_ref: "p", preview_digest: "d", expires_at: new Date().toISOString(), normalized_input: {}, blockers: ["owner_review_contract_not_configured"], required_approvals: [], availability: "needs_contract" }),
      confirmAction: async () => { throw new Error("must_not_confirm"); },
    }, { ...input, action: "review.approve", owner: "eikona", target_kind: "review", input: { version_ref: "v1" } }, "csrf", (phase) => phases.push(phase));
    expect(result.phase).toBe("needs_contract");
    expect(phases).toEqual(["editing", "previewing", "needs_contract"]);
  });
});

describe("action HTTP contract", () => {
  const config: ServerConfig = {
    origin: "http://127.0.0.1:4299",
    port: 4299,
    owners: {},
    principals: [{ issuer: "https://id.example", subject: "one", name: "One", role: "admin", scopes: [{ id: "scope-1", tenant: "tenant", team: "team", project: "project", label: "Scope", owners: {} }] }],
  };
  const session: Session = { id: "action-session", issuer: "https://id.example", subject: "one", name: "One", csrf: "csrf", accessToken: "token", accessAudience: [], expires: Date.now() + 60_000, epoch: 1 };
  const req = (path: string, method = "GET", body?: unknown) => new Request(config.origin + "/api/control-center/v1" + path, { method, headers: { Cookie: "yeisme_session=" + session.id, Origin: config.origin, "X-CSRF-Token": session.csrf }, body: body ? JSON.stringify(body) : undefined });

  it("keeps delivery and Aigora admin actions at needs_contract with their own reasons, and writes nothing", async () => {
    const admin: ServerConfig = { ...config, principals: [{ ...config.principals[0], role: "admin" }] };
    const auth = new SessionAuth(admin);
    auth.sessions.set(session.id, session);
    const app = createApp(admin, { auth });
    const gaps = [
      { owner: "control-center", action: "delivery.prepare", target_kind: "delivery", input: { asset_refs: ["asset-1"] }, reason: "owner_delivery_contract_not_configured" },
      { owner: "control-center", action: "delivery.send", target_kind: "delivery", input: { delivery_ref: "delivery-1", destination_ref: "destination-1" }, reason: "owner_delivery_contract_not_configured" },
      { owner: "aigora", action: "owner.config.update", target_kind: "owner_config", input: { revision: "r1", changes: {} }, reason: "owner_config_contract_not_configured" },
      { owner: "aigora", action: "owner.membership.update", target_kind: "membership", input: { member_ref: "member-1", changes: {}, revision: "r1" }, reason: "owner_membership_contract_not_configured" },
    ];
    for (const [index, gap] of gaps.entries()) {
      const key = `contract_gap_${String(index).padStart(4, "0")}_action`;
      const preview = await (await app(req("/actions/preview?scope=scope-1", "POST", { scope_id: "scope-1", owner: gap.owner, target_kind: gap.target_kind, target_ref: `${gap.target_kind}-1`, action: gap.action, expected_revision: "rev-1", idempotency_key: key, input: gap.input }))).json();
      expect([preview.availability, preview.blockers], gap.action).toEqual(["needs_contract", [gap.reason]]);
      const receipt = await (await app(req("/actions/confirm?scope=scope-1", "POST", { scope_id: "scope-1", preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: key }))).json();
      expect([receipt.state, receipt.error_code, receipt.owner_state, receipt.result_refs], gap.action).toEqual(["needs_contract", gap.reason, null, []]);
    }
  });

  it("exposes descriptors and keeps owner review actions at needs_contract", async () => {
    const auth = new SessionAuth(config);
    auth.sessions.set(session.id, session);
    const app = createApp(config, { auth });
    const list = await (await app(req("/actions?scope=scope-1"))).json();
    expect(list.actions.some((item: any) => item.action === "review.approve" && item.owner === "scaena")).toBe(true);
    const preview = await (await app(req("/actions/preview?scope=scope-1", "POST", {
      scope_id: "scope-1", owner: "eikona", target_kind: "review", target_ref: "review-1", action: "review.approve", expected_revision: "rev-1", idempotency_key: "review_action_0001", input: { version_ref: "v1" },
    }))).json();
    expect(preview.availability).toBe("needs_contract");
    const confirmed = await (await app(req("/actions/confirm?scope=scope-1", "POST", { scope_id: "scope-1", preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: "review_action_0001" }))).json();
    expect(confirmed.state).toBe("needs_contract");
    const receipt = await (await app(req(`/actions/receipts/${encodeURIComponent(confirmed.receipt_ref)}?scope=scope-1`))).json();
    expect(receipt.receipt_ref).toBe(confirmed.receipt_ref);
  });
});

