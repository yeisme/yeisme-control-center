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
    principals: [{ issuer: "https://id.example", subject: "one", name: "One", scopes: [{ id: "scope-1", tenant: "tenant", team: "team", project: "project", label: "Scope", owners: {} }] }],
  };
  const session: Session = { id: "action-session", issuer: "https://id.example", subject: "one", name: "One", csrf: "csrf", accessToken: "token", accessAudience: [], expires: Date.now() + 60_000, epoch: 1 };
  const req = (path: string, method = "GET", body?: unknown) => new Request(config.origin + "/api/control-center/v1" + path, { method, headers: { Cookie: "yeisme_session=" + session.id, Origin: config.origin, "X-CSRF-Token": session.csrf }, body: body ? JSON.stringify(body) : undefined });

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

