import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionAuth } from "../server/auth";
import { createApp } from "../server/app";
import { hashPassword } from "../server/password";
import type { ServerConfig } from "../server/contracts";

const dir = mkdtempSync(join(tmpdir(), "yeisme-invites-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const origin = "http://127.0.0.1:4328";
const ownerKey = "owner-invite-test-key-456";

type Who = { cookie: string; csrf: string };

async function setupServer() {
  const home = mkdtempSync(join(dir, "srv-"));
  const ownerRef = join(home, "owner.key");
  writeFileSync(ownerRef, (await hashPassword(ownerKey)) + "\n", { mode: 0o600 });
  const scope = (id: string, label: string) => ({ id, tenant: "studio", team: "", project: id, label, owners: {} });
  const config: ServerConfig = {
    origin,
    port: 4328,
    owners: {},
    auth_mode: "personal",
    personal: {
      name: "Owner",
      username: "owner-admin",
      role: "admin",
      password_hash_ref: ownerRef,
      scope_ids: ["rain"],
      users: [],
    },
    principals: [{ issuer: "config", subject: "owner", name: "Owner", scopes: [scope("rain", "雨夜重逢")] }],
  };
  const file = join(home, "control-center.json");
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  config.config_file = file;
  const auth = new SessionAuth(config);
  const app = createApp(config, { auth });
  const call = async (path: string, init: { method?: string; body?: unknown; who?: Who; csrf?: boolean } = {}) =>
    app(
      new Request(origin + "/api/control-center/v1" + path, {
        method: init.method || "GET",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...(init.who ? { Cookie: init.who.cookie } : {}),
          ...(init.who && init.csrf !== false ? { "X-CSRF-Token": init.who.csrf } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
    );
  const signIn = async (username: string, key: string): Promise<Who> => {
    const res = await call("/auth/personal", { method: "POST", body: { username, key } });
    if (res.status !== 200) throw new Error("login failed: " + res.status);
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    const sess = (await (await call("/session", { who: { cookie, csrf: "" } })).json()) as { csrf: string };
    return { cookie, csrf: sess.csrf };
  };
  const redeem = async (token: string): Promise<Who | number> => {
    const res = await call("/auth/invite", { method: "POST", body: { token } });
    if (res.status !== 200) return res.status;
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    const sess = (await (await call("/session", { who: { cookie, csrf: "" } })).json()) as { csrf: string };
    return { cookie, csrf: sess.csrf };
  };
  return { auth, call, signIn, redeem, file };
}

describe("personal one-time invitation tokens", () => {
  it("creates an account with a bundled one-time invite, redeems once, rejects replay, and cascades revocation", async () => {
    const { call, signIn, redeem, file } = await setupServer();
    const admin = await signIn("owner-admin", ownerKey);

    const createdRes = await call("/admin/personal-users", {
      method: "POST",
      who: admin,
      body: {
        username: "lin.zhou",
        name: "林舟",
        role: "viewer",
        scope_ids: ["rain"],
        issue_invite_ttl_hours: 24,
      },
    });
    expect(createdRes.status).toBe(201);
    const created = (await createdRes.json()) as {
      access_key: string;
      invite: { id: string; state: string };
      invite_token: string;
    };
    expect(created.invite_token).toMatch(/^yki_live_/);
    expect(created.invite.state).toBe("pending");
    expect(readFileSync(file, "utf8")).not.toContain(created.invite_token);

    // First guest redemption succeeds and establishes a working viewer session
    const guest1 = await redeem(created.invite_token);
    expect(typeof guest1).toBe("object");
    const guestWho = guest1 as Who;
    expect((await call("/session", { who: guestWho })).status).toBe(200);

    // Second redemption with the exact same ?token= is rejected (401)
    expect(await redeem(created.invite_token)).toBe(401);

    // Admin list shows state=consumed without exposing token hash or plaintext
    const listRes = await call("/admin/personal-invites", { who: admin });
    expect(listRes.status).toBe(200);
    const listText = await listRes.text();
    expect(listText).not.toContain(created.invite_token);
    const listJson = JSON.parse(listText) as { invites: { id: string; state: string }[] };
    expect(listJson.invites[0]).toMatchObject({ id: created.invite.id, state: "consumed" });

    // Owner's own key-based session is independent of invite revocation
    const ownSession = await signIn("lin.zhou", created.access_key);
    expect((await call("/session", { who: ownSession })).status).toBe(200);

    // Revoking the consumed invite terminates the guest session immediately while keeping lin.zhou's key session alive
    const revRes = await call(`/admin/personal-invites/${created.invite.id}/revoke`, {
      method: "POST",
      who: admin,
      body: {},
    });
    expect(revRes.status).toBe(200);
    expect((await call("/session", { who: guestWho })).status).toBe(401);
    expect((await call("/session", { who: ownSession })).status).toBe(200);

    // Audit records never leak plaintext invite tokens
    const auditText = await (await call("/audit?limit=50", { who: admin })).text();
    expect(auditText).not.toContain(created.invite_token);
    expect(auditText).toContain("auth.invite_redeemed");
    expect(auditText).toContain("admin.invite_created");
    expect(auditText).toContain("admin.invite_revoked");
  });

  it("disabling a user revokes all unconsumed invites and ends invite-backed sessions", async () => {
    const { call, signIn, redeem } = await setupServer();
    const admin = await signIn("owner-admin", ownerKey);
    await call("/admin/personal-users", {
      method: "POST",
      who: admin,
      body: { username: "guest.a", name: "访客甲", role: "viewer", scope_ids: ["rain"] },
    });
    const invA = (await (
      await call("/admin/personal-invites", {
        method: "POST",
        who: admin,
        body: { username: "guest.a", label: "Active session", ttl_hours: 12 },
      })
    ).json()) as { invite_token: string };
    const invB = (await (
      await call("/admin/personal-invites", {
        method: "POST",
        who: admin,
        body: { username: "guest.a", label: "Unused link", ttl_hours: 12 },
      })
    ).json()) as { invite_token: string };

    const activeGuest = (await redeem(invA.invite_token)) as Who;
    expect((await call("/session", { who: activeGuest })).status).toBe(200);

    // Revoke user account
    expect((await call("/admin/personal-users/guest.a/revoke", { method: "POST", who: admin, body: {} })).status).toBe(200);

    // Active invite session is dead, and unused invite link cannot be redeemed
    expect((await call("/session", { who: activeGuest })).status).toBe(401);
    expect(await redeem(invB.invite_token)).toBe(401);
  });
});
