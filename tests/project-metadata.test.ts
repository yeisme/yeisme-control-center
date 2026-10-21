import { describe, expect, it } from "vitest";
import { ProjectMetadataStore } from "../server/db/project-metadata-store";
import { createMemoryDB } from "../server/db/client";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import type { ServerConfig, Session } from "../server/contracts";

describe("project metadata", () => {
  it("keeps aliases scoped, falls back to 未命名项目 and uses CAS revisions", () => {
    const store = new ProjectMetadataStore(createMemoryDB());
    expect(store.list("scope-a")).toEqual([]);
    expect(store.hide("scope-a", "auctra", "unnamed", "0", "user-a")).toMatchObject({ display_name: "", display_label: "未命名项目", hidden: true, revision: 1 });
    expect(store.rename("scope-a", "auctra", "novel-1", "0", "  长篇  ", "user-a")).toMatchObject({
      display_name: "长篇",
      display_label: "长篇",
      hidden: false,
      revision: 1,
    });
    expect(store.list("scope-b")).toEqual([]);
    expect(store.hide("scope-a", "auctra", "novel-1", "1", "user-a")).toMatchObject({ hidden: true, revision: 2 });
    expect(() => store.unhide("scope-a", "auctra", "novel-1", "1", "user-a")).toThrowError(/project_metadata_conflict/);
    expect(store.rename("scope-a", "scaena", "scene-1", "0", "scene", "user-a")).toMatchObject({ display_label: "scene" });
    expect(store.get("scope-a", "sonora", "audio-1")).toBeNull();
  });

  it("serves scope-bound metadata and confirms rename/hide through the action receipt", async () => {
    const config: ServerConfig = {
      origin: "http://127.0.0.1:4392",
      port: 4392,
      owners: {},
      principals: [{ issuer: "https://id.example", subject: "one", name: "One", scopes: [
        { id: "scope-a", tenant: "tenant", team: "team", project: "project", label: "Scope A", owners: {} },
        { id: "scope-b", tenant: "tenant", team: "team", project: "project", label: "Scope B", owners: {} },
      ] }],
    };
    const session: Session = { id: "project-metadata-session", issuer: "https://id.example", subject: "one", name: "One", csrf: "csrf", accessToken: "", accessAudience: [], expires: Date.now() + 60_000, epoch: 1 };
    const auth = new SessionAuth(config);
    auth.sessions.set(session.id, session);
    const app = createApp(config, { auth });
    const request = (path: string, method = "GET", body?: unknown) => new Request(config.origin + "/api/control-center/v1" + path, { method, headers: { Cookie: `yeisme_session=${session.id}`, Origin: config.origin, "X-CSRF-Token": session.csrf, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

    const initial = await app(request("/project-metadata?scope=scope-a"));
    expect(initial.status).toBe(200);
    expect((await initial.json()).rows).toEqual([]);
    const preview = await app(request("/actions/preview?scope=scope-a", "POST", {
      scope_id: "scope-a", owner: "control-center", target_kind: "project", target_ref: "auctra:novel-1", action: "project.metadata.rename", expected_revision: "0", idempotency_key: "project_rename_0001", input: { expected_revision: "0", display_name: "远程小说" },
    }));
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    const confirmed = await app(request("/actions/confirm?scope=scope-a", "POST", { scope_id: "scope-a", preview_ref: previewBody.preview_ref, preview_digest: previewBody.preview_digest, idempotency_key: "project_rename_0001" }));
    expect(confirmed.status).toBe(202);
    expect(await confirmed.json()).toMatchObject({ state: "succeeded", owner_state: "visible", target_ref: "auctra:novel-1" });
    const scoped = await app(request("/project-metadata?scope=scope-a"));
    expect((await scoped.json()).rows[0]).toMatchObject({ owner: "auctra", project_ref: "novel-1", display_label: "远程小说", revision: 1 });
    const otherScope = await app(request("/project-metadata?scope=scope-b"));
    expect(await otherScope.json()).toMatchObject({ rows: [] });

    const hidePreview = await app(request("/actions/preview?scope=scope-a", "POST", {
      scope_id: "scope-a", owner: "control-center", target_kind: "project", target_ref: "auctra:novel-1", action: "project.metadata.hide", expected_revision: "1", idempotency_key: "project_hide_0001", input: { expected_revision: "1" },
    }));
    const hideBody = await hidePreview.json();
    const hide = await app(request("/actions/confirm?scope=scope-a", "POST", { scope_id: "scope-a", preview_ref: hideBody.preview_ref, preview_digest: hideBody.preview_digest, idempotency_key: "project_hide_0001" }));
    expect(await hide.json()).toMatchObject({ state: "succeeded", owner_state: "hidden" });
    const replay = await app(request("/actions/confirm?scope=scope-a", "POST", { scope_id: "scope-a", preview_ref: hideBody.preview_ref, preview_digest: hideBody.preview_digest, idempotency_key: "project_hide_0001" }));
    const replayBody = await replay.json();
    expect(replayBody).toMatchObject({ state: "succeeded", owner_state: "hidden" });
    const receipt = await app(request(`/actions/receipts/${encodeURIComponent(replayBody.receipt_ref)}?scope=scope-a`));
    expect(await receipt.json()).toMatchObject({ receipt_ref: replayBody.receipt_ref, action: "project.metadata.hide" });

    const unhidePreview = await app(request("/actions/preview?scope=scope-a", "POST", {
      scope_id: "scope-a", owner: "control-center", target_kind: "project", target_ref: "auctra:novel-1", action: "project.metadata.unhide", expected_revision: "2", idempotency_key: "project_unhide_0001", input: { expected_revision: "2" },
    }));
    const unhideBody = await unhidePreview.json();
    const unhide = await app(request("/actions/confirm?scope=scope-a", "POST", { scope_id: "scope-a", preview_ref: unhideBody.preview_ref, preview_digest: unhideBody.preview_digest, idempotency_key: "project_unhide_0001" }));
    expect(await unhide.json()).toMatchObject({ state: "succeeded", owner_state: "visible" });
  });
});
