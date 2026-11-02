import { describe, expect, it } from "vitest";
import { SessionAuth } from "../server/auth";
import { createApp } from "../server/app";
import type { ServerConfig, Session } from "../server/contracts";

// A viewer may read everything in its scope but must not change owner, Provider or account state.
const scope = { id: "scope-a", tenant: "tenant", team: "team", project: "project", label: "Scope A", owners: {} };
function setup() {
  const config: ServerConfig = {
    origin: "http://127.0.0.1:4393",
    port: 4393,
    owners: {},
    principals: [
      { issuer: "https://id.example", subject: "boss", name: "Boss", role: "admin", scopes: [scope] },
      { issuer: "https://id.example", subject: "reader", name: "Reader", role: "viewer", scopes: [scope] },
    ],
  };
  const auth = new SessionAuth(config);
  const session = (subject: string): Session => ({ id: `session-${subject}`, issuer: "https://id.example", subject, name: subject, csrf: "csrf", accessToken: "", accessAudience: [], expires: Date.now() + 60_000, epoch: 1 });
  const admin = session("boss"), viewer = session("reader");
  auth.sessions.set(admin.id, admin);
  auth.sessions.set(viewer.id, viewer);
  const app = createApp(config, { auth });
  const request = (who: Session, path: string, body?: unknown) => app(new Request(config.origin + "/api/control-center/v1" + path, { method: "POST", headers: { Cookie: `yeisme_session=${who.id}`, Origin: config.origin, "X-CSRF-Token": who.csrf, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { config, admin, viewer, request };
}
const preview = (action: string, target_kind: string, target_ref: string, input: Record<string, unknown>, owner = "control-center") =>
  ({ scope_id: "scope-a", owner, target_kind, target_ref, action, expected_revision: "0", idempotency_key: `viewer_${action.replace(/\W/g, "_")}_0001`, input });

describe("viewers cannot run admin or paid actions", () => {
  it("refuses every non-collaboration action preview", async () => {
    const { viewer, request } = setup();
    const attempts = [
      preview("admin.user.create", "personal_user", "user:new", { username: "new", name: "New", role: "admin", scope_ids: ["scope-a"] }),
      preview("admin.user.revoke", "personal_user", "user:boss", { username: "boss" }),
      preview("provider_runs.create", "provider_run", "eikona", { prompt: "x" }, "eikona"),
      preview("task.cancel", "task", "eikona:task-1", { reason: "x" }, "eikona"),
      preview("project.metadata.rename", "project", "auctra:novel-1", { expected_revision: "0", display_name: "改名" }),
      preview("project.metadata.hide", "project", "auctra:novel-1", { expected_revision: "0" }),
    ];
    for (const body of attempts) {
      const response = await request(viewer, "/actions/preview?scope=scope-a", body);
      expect(response.status, body.action).toBe(403);
      expect((await response.json()).error, body.action).toBe("control_center_admin_required");
    }
  });

  it("re-checks the role at confirm, so a preview made before a downgrade cannot be executed", async () => {
    const { config, admin, request } = setup();
    const made = await request(admin, "/actions/preview?scope=scope-a", preview("project.metadata.rename", "project", "auctra:novel-1", { expected_revision: "0", display_name: "改名" }));
    expect(made.status).toBe(200);
    const { preview_ref, preview_digest } = await made.json();
    config.principals[0]!.role = "viewer";
    const confirmed = await request(admin, "/actions/confirm?scope=scope-a", { scope_id: "scope-a", preview_ref, preview_digest, idempotency_key: "viewer_confirm_0001" });
    expect(confirmed.status).toBe(403);
    expect((await confirmed.json()).error).toBe("control_center_admin_required");
  });

  it("refuses Provider run submit and reconcile before reading the body", async () => {
    const { viewer, request } = setup();
    for (const path of ["/provider-runs?scope=scope-a", "/provider-runs/run_1/reconcile?scope=scope-a"]) {
      const response = await request(viewer, path, { prompt: "x" });
      expect(response.status, path).toBe(403);
      expect((await response.json()).error, path).toBe("control_center_admin_required");
    }
  });

  it("keeps account management personal-only even for team admins", async () => {
    const { admin, request } = setup();
    const response = await request(admin, "/actions/preview?scope=scope-a", preview("admin.user.create", "personal_user", "user:new", { username: "new", name: "New", role: "viewer", scope_ids: ["scope-a"] }));
    expect(response.status).toBe(403);
  });
});
