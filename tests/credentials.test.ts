import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthError, SessionAuth, secret } from "../server/auth";
import { credentialHolder, credentialSlots, credentialStatuses, isPersonalAdmin } from "../server/credentials";
import { credentialFileProblem, credentialReasonOf, type CredentialFileStat } from "../server/credential-file";
import { projection, summarizeOperations } from "../server/open-tools/projection";
import type { ScopeBinding, ServerConfig, Session, TaskConnection } from "../server/contracts";
import type { OpenToolCheck, OpenToolProjection } from "../src/shared/open-tools";
import type { TaskConnectionState } from "../src/task-observation";
import { dayMs, type CredentialStatus } from "../src/shared/credentials";

const now = Date.parse("2026-11-02T00:00:00Z");
const at = (days: number) => new Date(now + days * dayMs).toISOString();

const file = (mode = 0o100600, size = 24, regular = true): CredentialFileStat => ({ isFile: () => regular, mode, size });
/** Every path is a good private file unless the test names another stat for it. */
const statOf = (special: Record<string, CredentialFileStat | null> = {}) => (ref: string) => ref in special ? special[ref] : file();

const scope: ScopeBinding = { id: "scope-a", tenant: "a", team: "", project: "a", label: "Scope", owners: {}, connection_ids: ["eikona-main", "anatomia-main", "off"], open_tools: ["drivebridge", "gateway"] };
function config(extra: Partial<ServerConfig> = {}): ServerConfig {
  return {
    origin: "https://control.example.test", port: 4312, principals: [], owners: {},
    connections: [
      { id: "eikona-main", owner: "eikona", instance_id: "e", label: "Eikona 主库", environment: "t", endpoint: "https://eikona.example.test/mcp", credential_ref: "/keys/eikona.key", project: "p", enabled: true },
      { id: "anatomia-main", owner: "anatomia", instance_id: "a", label: "Anatomia 拉片", environment: "t", endpoint: "https://anatomia.example.test/mcp", credential_ref: "/keys/anatomia.key", project: "p", enabled: true },
      { id: "off", owner: "sonora", instance_id: "s", label: "已停用", environment: "t", endpoint: "https://sonora.example.test/mcp", credential_ref: "/keys/off.key", project: "p", enabled: false },
      { id: "other-scope", owner: "scaena", instance_id: "x", label: "别的范围", environment: "t", endpoint: "https://scaena.example.test/mcp", credential_ref: "/keys/other.key", project: "p", enabled: true },
    ],
    open_tools: {
      drivebridge: { endpoint: "https://drive.example.test", credential_ref: "/keys/drive.token", credential_expires_at: at(30) },
      gateway: { endpoint: "https://gateway.example.test", credential_ref: "/keys/gateway.token", label: "我的网关" },
    },
    ...extra,
  };
}
const only = (rows: CredentialStatus[], id: string) => rows.find((row) => row.id === id)!;
const statuses = (cfg: ServerConfig, input: Parameters<typeof credentialStatuses>[2] = {}) => credentialStatuses(cfg, scope, { now, stat: statOf(), ...input });

const runtime = (patch: Partial<NonNullable<TaskConnectionState["runtime"]>> = {}): NonNullable<TaskConnectionState["runtime"]> => ({
  state: "ready", checked_at: at(0), last_success_at: at(0), transport: "verified", authorization: "verified", contract: "supported", task_families: [], content: "supported", ...patch,
});
const observation = (id: string, patch: Partial<NonNullable<TaskConnectionState["runtime"]>> = {}): TaskConnectionState => ({ id, owner: "eikona", instance_id: id, label: id, environment: "t", project: "p", state: "ready", observed_at: at(0), runtime: runtime(patch) });

const ok = (id: string, label = id): OpenToolCheck => ({ id, label, state: "ok" });
const refused = (id: string, reason: "open_tool_unauthenticated" | "open_tool_forbidden"): OpenToolCheck => ({ id, label: id, state: "forbidden", reason });
/** A Gateway reading built the way the adapter builds it: `health` is read without the credential, the rest with it. */
const gateway = (checks: OpenToolCheck[]): OpenToolProjection => projection({ tool: "gateway", checks, primary: ["credential", "backends", "tools", "operations", "usage"], optional: ["usage"], operations: summarizeOperations([], "partial") });
const healthyChecks = () => [ok("health"), ok("credential"), ok("backends"), ok("tools"), ok("operations"), ok("usage")];

describe("credential slots", () => {
  it("names every configured credential with a stable id, limited to what the scope reads", () => {
    const full = config({
      providers: { eikona: { owner: "eikona", endpoint: "https://p.example.test", credential_ref: "/keys/provider.key", enabled: true }, sonora: { owner: "sonora", endpoint: "https://p.example.test", credential_env: "SOME_ENV", enabled: true } },
      owners: { aigora: { origin: "https://aigora.example.test", audience: "a", credential_ref: "/keys/aigora.key" }, scaena: { origin: "https://scaena.example.test", audience: "s" } },
      collection: { auctra: { origin: "https://auctra.example.test", audience: "au", credential_ref: "/keys/collector.key", flow_credential_ref: "/keys/reader.key", enabled: true } },
    });
    // The scope binds the eikona and aigora owners and an Auctra project, so their server-side credentials are its own.
    const bound: ScopeBinding = { ...scope, owners: { eikona: { tenant: "a", project: "a", actor: "u", audience: "a" }, aigora: { tenant: "a", project: "a", actor: "u", audience: "a" } }, collection: { auctra: { tenant: "a", project: "a", actor: "u", audience: "au" } } };
    // Disabled and out-of-scope connections, owners without a file and providers fed from the environment are not slots here.
    expect(credentialStatuses(full, bound, { now, stat: statOf() }).map((row) => row.id)).toEqual([
      "connection:eikona-main", "connection:anatomia-main", "open_tool:drivebridge", "open_tool:gateway", "provider:eikona", "owner:aigora", "collection:auctra", "collection:auctra:flow",
    ]);
    // The command line sees everything, switched-off entries included, with no scope to narrow it.
    expect(credentialSlots(full).map((slot) => slot.id)).toContain("connection:other-scope");
    expect(credentialSlots(full).find((slot) => slot.id === "connection:off")).toMatchObject({ enabled: false });
    expect(credentialSlots(full, { ...scope, open_tools: ["gateway"] }).map((slot) => slot.id)).not.toContain("open_tool:drivebridge");
  });

  it("lists a provider, an owner or Auctra only for a scope that binds it, so one scope never sees another's server-side credentials", () => {
    const full = config({
      providers: { eikona: { owner: "eikona", endpoint: "https://p.example.test", credential_ref: "/keys/provider.key", enabled: true } },
      owners: { aigora: { origin: "https://aigora.example.test", audience: "a", credential_ref: "/keys/aigora.key", credential_expires_at: at(3) } },
      collection: { auctra: { origin: "https://auctra.example.test", audience: "au", credential_ref: "/keys/collector.key", flow_credential_ref: "/keys/reader.key", enabled: true } },
    });
    const ids = (target: ScopeBinding) => credentialStatuses(full, target, { now, stat: statOf() }).map((row) => row.id);
    // `scope` binds no owner and no Auctra project: only its connections and open tools remain.
    expect(ids(scope)).toEqual(["connection:eikona-main", "connection:anatomia-main", "open_tool:drivebridge", "open_tool:gateway"]);
    expect(ids({ ...scope, owners: { aigora: { tenant: "a", project: "a", actor: "u", audience: "a" } } })).toContain("owner:aigora");
    expect(ids({ ...scope, owners: { aigora: { tenant: "a", project: "a", actor: "u", audience: "a" } } })).not.toContain("provider:eikona");
    expect(ids({ ...scope, owners: { eikona: { tenant: "a", project: "a", actor: "u", audience: "a" } } })).toEqual(expect.arrayContaining(["provider:eikona"]));
    expect(ids({ ...scope, collection: { auctra: { tenant: "a", project: "a", actor: "u", audience: "au" } } })).toEqual(expect.arrayContaining(["collection:auctra", "collection:auctra:flow"]));
    // An unbound credential is not even a `shared_with` link: the rows of one scope never name another's slots.
    const sharing = config({ owners: { aigora: { origin: "https://aigora.example.test", audience: "a", credential_ref: "/keys/eikona.key" } } });
    expect(only(credentialStatuses(sharing, scope, { now, stat: statOf() }), "connection:eikona-main").shared_with).toEqual([]);
    expect(credentialSlots(sharing).map((slot) => slot.id)).toContain("owner:aigora");
  });

  it("takes the scope's connections from the catalog when it has them, so tool projects registered in the control center get rows", () => {
    const template = config().connections![0];
    const registered: TaskConnection = { ...template, id: "eikona-reg-1a2b", label: "Eikona · 预告片", project: "rain-teaser" };
    const rows = statuses(config(), { scopeConnections: [template, registered, { ...template, id: "eikona-reg-off", enabled: false }] });
    expect(rows.filter((row) => row.id.startsWith("connection:")).map((row) => [row.id, row.label])).toEqual([["connection:eikona-main", "Eikona 主库"], ["connection:eikona-reg-1a2b", "Eikona · 预告片"]]);
    // A registered connection copies its template's file and expiry, so it shares the file with it.
    expect(only(rows, "connection:eikona-reg-1a2b").shared_with).toEqual(["connection:eikona-main"]);
    expect(only(rows, "connection:eikona-main").shared_with).toEqual(["connection:eikona-reg-1a2b"]);
    // Its own observation is used for it, not its template's.
    const denied = statuses(config(), { scopeConnections: [template, registered], connections: [observation("eikona-reg-1a2b", { authorization: "denied" })] });
    expect(only(denied, "connection:eikona-reg-1a2b").state).toBe("rejected");
    expect(only(denied, "connection:eikona-main").state).toBe("unknown_expiry");
    // Without a catalog list the configured connections the scope names are used, as before.
    expect(statuses(config()).filter((row) => row.id.startsWith("connection:")).map((row) => row.id)).toEqual(["connection:eikona-main", "connection:anatomia-main"]);
  });

  it("labels and groups rows by the tool they are for", () => {
    const rows = statuses(config());
    expect(only(rows, "connection:eikona-main")).toMatchObject({ owner: "eikona", label: "Eikona 主库" });
    expect(only(rows, "open_tool:gateway")).toMatchObject({ owner: "gateway", label: "我的网关" });
    expect(only(rows, "open_tool:drivebridge")).toMatchObject({ owner: "drivebridge", label: "DriveBridge" });
  });

  it("finds where a slot keeps its reference and dates, and only for slots that exist", () => {
    const cfg = config({ collection: { auctra: { origin: "https://a.example.test", audience: "au", credential_ref: "/keys/c", flow_credential_ref: "/keys/f" } } });
    expect(credentialHolder(cfg, "collection:auctra:flow")).toMatchObject({ refKey: "flow_credential_ref", expiresKey: "flow_credential_expires_at", issuedKey: "flow_credential_issued_at" });
    expect(credentialHolder(cfg, "collection:auctra")).toMatchObject({ refKey: "credential_ref", expiresKey: "credential_expires_at" });
    expect(credentialHolder(cfg, "open_tool:gateway")?.target).toBe(cfg.open_tools!.gateway);
    expect(credentialHolder(cfg, "provider:eikona")).toBeUndefined();
    expect(credentialHolder(cfg, "connection:missing")).toBeUndefined();
  });
});

describe("credential state", () => {
  it("is unreadable first, from the file's metadata alone", () => {
    const cfg = config();
    cfg.connections![0].credential_expires_at = at(-3);
    const denied = [observation("eikona-main", { authorization: "denied" })];
    for (const [stat, reason] of [
      [null, "missing"], [file(0o040700, 0, false), "not_file"], [file(0o100640), "permissions"], [file(0o100604), "permissions"], [file(0o100060), "permissions"], [file(0o100007), "permissions"], [file(0o100600, 0), "empty"],
    ] as const) {
      expect(only(statuses(cfg, { stat: statOf({ "/keys/eikona.key": stat }), connections: denied }), "connection:eikona-main"), String(reason)).toMatchObject({ state: "unreadable", reason });
    }
    // The checks run in this order: a loose, empty file is a permission problem; a directory is not a file whatever its mode.
    expect(credentialFileProblem("x", () => file(0o100644, 0))).toBe("permissions");
    expect(credentialFileProblem("x", () => file(0o040755, 0, false))).toBe("not_file");
    expect(credentialFileProblem("x", () => file(0o100400))).toBeNull();
    expect(credentialFileProblem("x", () => file(0o100600))).toBeNull();
  });

  it("is rejected when the owner refuses the credential, ahead of its expiry", () => {
    const cfg = config();
    cfg.connections![0].credential_expires_at = at(-1);
    const denied = statuses(cfg, { connections: [observation("eikona-main", { authorization: "denied", last_success_at: null })] });
    expect(only(denied, "connection:eikona-main")).toMatchObject({ state: "rejected", reason: "owner_denied" });
    expect(only(statuses(cfg), "connection:eikona-main").state).toBe("expired");
    const unauthenticated = gateway([ok("health"), refused("credential", "open_tool_unauthenticated"), refused("backends", "open_tool_unauthenticated"), refused("tools", "open_tool_unauthenticated"), refused("operations", "open_tool_unauthenticated"), refused("usage", "open_tool_unauthenticated")]);
    expect(only(statuses(cfg, { openTools: [unauthenticated] }), "open_tool:gateway")).toMatchObject({ state: "rejected", reason: "unauthenticated" });
    // A single 401 is enough, even if other reads still answer.
    const oneRefused = gateway([...healthyChecks().slice(0, 4), refused("operations", "open_tool_unauthenticated"), ok("usage")]);
    expect(only(statuses(cfg, { openTools: [oneRefused] }), "open_tool:gateway")).toMatchObject({ state: "rejected", reason: "unauthenticated" });
    // Every credentialed read refused with 403 is the adapter's own "forbidden" verdict.
    const forbidden = gateway([ok("health"), ...["credential", "backends", "tools", "operations", "usage"].map((id) => refused(id, "open_tool_forbidden"))]);
    expect(forbidden.state).toBe("forbidden");
    expect(only(statuses(cfg, { openTools: [forbidden] }), "open_tool:gateway")).toMatchObject({ state: "rejected", reason: "forbidden" });
  });

  it("is expired from the expiry instant on, and expiring within seven days, with a closer stage inside one day", () => {
    const cfg = config();
    const check = (expires: number) => {
      cfg.open_tools!.drivebridge!.credential_expires_at = new Date(expires).toISOString();
      return only(statuses(cfg), "open_tool:drivebridge");
    };
    expect(check(now - 1)).toMatchObject({ state: "expired" });
    expect(check(now)).toMatchObject({ state: "expired" });
    expect(check(now)).not.toHaveProperty("days_left");
    expect(check(now + 1)).toMatchObject({ state: "expiring", stage: "1d", days_left: 1 });
    expect(check(now + dayMs)).toMatchObject({ state: "expiring", stage: "1d", days_left: 1 });
    expect(check(now + dayMs + 1)).toMatchObject({ state: "expiring", stage: "7d", days_left: 2 });
    expect(check(now + 3 * dayMs)).toMatchObject({ state: "expiring", stage: "7d", days_left: 3, expires_at: at(3) });
    expect(check(now + 7 * dayMs)).toMatchObject({ state: "expiring", stage: "7d", days_left: 7 });
    expect(check(now + 7 * dayMs + 1)).toMatchObject({ state: "ok", days_left: 8 });
    expect(check(now + 7 * dayMs + 1)).not.toHaveProperty("stage");
    expect(check(now + 30 * dayMs)).toMatchObject({ state: "ok", days_left: 30 });
  });

  it("is limited when the credential is accepted but some read is refused, unless it is about to expire", () => {
    const cfg = config();
    // Gateway usage without an audit scope: the main reads pass.
    const usageRefused = gateway([...healthyChecks().slice(0, 5), refused("usage", "open_tool_forbidden")]);
    expect(usageRefused.state).toBe("ready");
    expect(only(statuses(cfg, { openTools: [usageRefused] }), "open_tool:gateway")).toMatchObject({ state: "limited", reason: "read_forbidden" });
    const content = [observation("anatomia-main", { content: "denied" })];
    expect(only(statuses(cfg, { connections: content }), "connection:anatomia-main")).toMatchObject({ state: "limited", reason: "content_denied" });
    // "unsupported" is the owner's gap, not a refusal of this credential.
    expect(only(statuses(cfg, { connections: [observation("anatomia-main", { content: "unsupported" })] }), "connection:anatomia-main").state).toBe("unknown_expiry");
    cfg.connections![1].credential_expires_at = at(2);
    expect(only(statuses(cfg, { connections: content }), "connection:anatomia-main")).toMatchObject({ state: "expiring", stage: "7d" });
    cfg.connections![1].credential_expires_at = at(90);
    expect(only(statuses(cfg, { connections: content }), "connection:anatomia-main")).toMatchObject({ state: "limited" });
  });

  it("is ok once an expiry is recorded and unknown_expiry until then; an unparseable record counts as none", () => {
    const cfg = config();
    expect(only(statuses(cfg), "open_tool:gateway").state).toBe("unknown_expiry");
    expect(only(statuses(cfg), "open_tool:drivebridge").state).toBe("ok");
    cfg.open_tools!.gateway!.credential_expires_at = "not a date";
    expect(only(statuses(cfg), "open_tool:gateway")).toMatchObject({ state: "unknown_expiry" });
    expect(only(statuses(cfg), "open_tool:gateway")).not.toHaveProperty("expires_at");
  });

  it("judges a slot with no observation, or an owner that did not answer, by its file and expiry alone", () => {
    const cfg = config();
    cfg.open_tools!.gateway!.credential_expires_at = at(40);
    const unreachable = gateway([{ id: "health", label: "就绪", state: "failed", reason: "gateway_not_ready" }, ...["credential", "backends", "tools", "operations", "usage"].map((id): OpenToolCheck => ({ id, label: id, state: "unavailable", reason: "open_tool_unreachable" }))]);
    expect(only(statuses(cfg, { openTools: [unreachable] }), "open_tool:gateway").state).toBe("ok");
    expect(only(statuses(cfg, { connections: [], openTools: [] }), "open_tool:gateway").state).toBe("ok");
  });

  it("is unreadable, as read_failed, when the control center says it could not read a file that passes the checks", () => {
    const cfg = config();
    cfg.open_tools!.gateway!.credential_expires_at = at(40);
    cfg.connections![0].credential_expires_at = at(-1);
    // `secret()` refuses a file that only holds whitespace, which a stat cannot see: the reading says so, as a refused read.
    const unreadable = gateway([ok("health"), ...["credential", "backends", "tools", "operations", "usage"].map((id): OpenToolCheck => ({ id, label: id, state: "forbidden", reason: "open_tool_credential_unreadable" }))]);
    expect(only(statuses(cfg, { openTools: [unreadable] }), "open_tool:gateway")).toMatchObject({ state: "unreadable", reason: "read_failed" });
    expect(only(statuses(cfg, { openTools: [unreadable] }), "open_tool:gateway")).not.toHaveProperty("last_accepted_at");
    // A task connection reports it as its state and reason (`connectionStateFor` gives the error code as the state).
    for (const runtimePatch of [{ state: "credential_unreadable", reason: "credential_unreadable" }, { reason: "credential_unreadable" }, { state: "credential_unreadable" }]) {
      expect(only(statuses(cfg, { connections: [observation("eikona-main", runtimePatch)] }), "connection:eikona-main"), JSON.stringify(runtimePatch)).toMatchObject({ state: "unreadable", reason: "read_failed" });
    }
    // The file check is the more exact answer when it has one, and an unreadable credential outranks an expired one.
    expect(only(statuses(cfg, { stat: statOf({ "/keys/eikona.key": file(0o100600, 0) }), connections: [observation("eikona-main", { reason: "credential_unreadable" })] }), "connection:eikona-main")).toMatchObject({ state: "unreadable", reason: "empty" });
    expect(only(statuses(cfg), "connection:eikona-main").state).toBe("expired");
  });

  it("is unreadable when this process may not read a file whose mode looks private, such as a 0600 file of another user", () => {
    const cfg = config();
    const another = file(0o100600);
    another.readable = false;
    expect(only(statuses(cfg, { stat: statOf({ "/keys/eikona.key": another }) }), "connection:eikona-main")).toMatchObject({ state: "unreadable", reason: "permissions" });
    expect(credentialFileProblem("x", () => another)).toBe("permissions");
    expect(credentialFileProblem("x", () => ({ ...file(), readable: true }))).toBeNull();
  });

  it("treats an expiry that is recorded but cannot be read as a mistake to correct, not as none", () => {
    const cfg = config();
    for (const bad of ["not a date", "2026-12-01", "2026-12-01T00:00:00", "2026-02-30T00:00:00Z", ""]) {
      cfg.open_tools!.gateway!.credential_expires_at = bad;
      const row = only(statuses(cfg), "open_tool:gateway");
      expect(row.state, bad).toBe("unknown_expiry");
      expect(row.reason === "invalid_expiry", bad).toBe(bad !== "");
      expect(row).not.toHaveProperty("expires_at");
    }
    cfg.open_tools!.gateway!.credential_expires_at = "2026-12-01T00:00:00+08:00";
    expect(only(statuses(cfg), "open_tool:gateway")).toMatchObject({ state: "ok", expires_at: "2026-11-30T16:00:00.000Z" });
  });
});

describe("credential rows", () => {
  it("take last_accepted_at only from observations that say the credential was accepted", () => {
    const cfg = config();
    expect(only(statuses(cfg), "connection:eikona-main")).not.toHaveProperty("last_accepted_at");
    expect(only(statuses(cfg), "open_tool:gateway")).not.toHaveProperty("last_accepted_at");
    const seen = statuses(cfg, { connections: [observation("eikona-main", { last_success_at: at(-1) })] });
    expect(only(seen, "connection:eikona-main").last_accepted_at).toBe(at(-1));
    expect(only(statuses(cfg, { connections: [observation("eikona-main", { last_success_at: null })] }), "connection:eikona-main")).not.toHaveProperty("last_accepted_at");
    const reading = gateway(healthyChecks());
    expect(only(statuses(cfg, { openTools: [reading] }), "open_tool:gateway").last_accepted_at).toBe(reading.observed_at);
    // A stale reading, or one where nothing credentialed answered, proves nothing about now.
    expect(only(statuses(cfg, { openTools: [{ ...reading, freshness: "stale" }] }), "open_tool:gateway")).not.toHaveProperty("last_accepted_at");
    const onlyHealth = gateway([ok("health"), ...["credential", "backends", "tools", "operations", "usage"].map((id): OpenToolCheck => ({ id, label: id, state: "unavailable", reason: "open_tool_unreachable" }))]);
    expect(only(statuses(cfg, { openTools: [onlyHealth] }), "open_tool:gateway")).not.toHaveProperty("last_accepted_at");
  });

  it("lists, by id only, the other slots that point at the same file", () => {
    const cfg = config();
    cfg.connections![1].credential_ref = "/keys/./eikona.key";
    cfg.open_tools!.gateway!.credential_ref = "/keys/eikona.key";
    cfg.connections![2].credential_ref = "/keys/eikona.key";
    const rows = statuses(cfg);
    expect(only(rows, "connection:eikona-main").shared_with).toEqual(["connection:anatomia-main", "open_tool:gateway"]);
    expect(only(rows, "connection:anatomia-main").shared_with).toEqual(["connection:eikona-main", "open_tool:gateway"]);
    expect(only(rows, "open_tool:gateway").shared_with).toEqual(["connection:eikona-main", "connection:anatomia-main"]);
    // A switched-off connection that uses the file, or a slot of another scope, is not listed; a file of its own has no sharers.
    expect(rows.flatMap((row) => row.shared_with)).not.toContain("connection:off");
    expect(only(rows, "open_tool:drivebridge").shared_with).toEqual([]);
  });

  it("never carry a path, an address or a token", () => {
    const token = "tok_live_super_secret_value";
    const cfg = config({ collection: { auctra: { origin: "https://auctra.example.test", audience: "au", credential_ref: "/keys/collector.key", enabled: true } } });
    const rows = statuses(cfg, {
      connections: [observation("eikona-main", { authorization: "denied" }), observation("anatomia-main", { content: "denied" })],
      openTools: [gateway([ok("health"), refused("credential", "open_tool_unauthenticated"), ok("backends"), ok("tools"), ok("operations"), ok("usage")])],
      stat: statOf({ "/keys/collector.key": null }),
    });
    const json = JSON.stringify(rows);
    for (const leaked of ["/keys", ".key", ".token", "https://", "http://", "example.test", "credential_ref", "endpoint", "Bearer", token]) expect(json, leaked).not.toContain(leaked);
    const allowed = new Set(["id", "owner", "label", "state", "reason", "stage", "expires_at", "days_left", "last_accepted_at", "shared_with"]);
    for (const row of rows) for (const key of Object.keys(row)) expect(allowed.has(key), key).toBe(true);
  });
});

describe("credential files on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "credentials-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const make = (name: string, content: string, mode: number) => {
    const path = join(dir, name);
    writeFileSync(path, content, { mode });
    chmodSync(path, mode);
    return path;
  };

  it("reports the real file's metadata without reading it", () => {
    const good = make("good", "a-token\n", 0o600);
    const loose = make("loose", "a-token\n", 0o644);
    const empty = make("empty", "", 0o600);
    const folder = join(dir, "folder");
    mkdirSync(folder, { mode: 0o700 });
    const cfg = config();
    cfg.connections![0].credential_ref = good;
    cfg.connections![1].credential_ref = loose;
    cfg.open_tools!.drivebridge!.credential_ref = empty;
    cfg.open_tools!.gateway!.credential_ref = folder;
    const rows = credentialStatuses(cfg, scope, { now });
    expect(rows.map((row) => [row.id, row.state, row.reason])).toEqual([
      ["connection:eikona-main", "unknown_expiry", undefined],
      ["connection:anatomia-main", "unreadable", "permissions"],
      ["open_tool:drivebridge", "unreadable", "empty"],
      ["open_tool:gateway", "unreadable", "not_file"],
    ]);
    cfg.open_tools!.gateway!.credential_ref = join(dir, "absent");
    expect(only(credentialStatuses(cfg, scope, { now }), "open_tool:gateway")).toMatchObject({ state: "unreadable", reason: "missing" });
  });

  it("makes secret() refuse the same files with one error that names the reason and never the file", () => {
    const good = make("secret-good", "  a-token \n", 0o600);
    expect(secret(good)).toBe("a-token");
    const cases: [string, string, string][] = [
      ["missing", join(dir, "secret-absent"), "missing"],
      ["folder", dir, "not_file"],
      ["loose", make("secret-loose", "a-token\n", 0o640), "permissions"],
      ["empty", make("secret-empty", "", 0o600), "empty"],
      ["blank", make("secret-blank", " \n\n", 0o600), "empty"],
    ];
    for (const [name, path, reason] of cases) {
      let caught: unknown;
      try { secret(path); } catch (error) { caught = error; }
      expect(caught, name).toBeInstanceOf(AuthError);
      expect(caught, name).toMatchObject({ code: "credential_unreadable", status: 503, reason });
      expect(credentialReasonOf(caught)).toBe(reason);
      expect(String((caught as Error).message) + JSON.stringify(caught)).not.toContain(path);
    }
    expect(credentialReasonOf(new AuthError("other", 503))).toBeUndefined();
    expect(credentialReasonOf(null)).toBeUndefined();
  });
});

describe("what an open tool's refusals say about its credential", () => {
  const readsOf = (checks: OpenToolCheck[]) => only(statuses(config(), { openTools: [gateway(checks)] }), "open_tool:gateway");
  const checks = (patch: Record<string, OpenToolCheck>) => healthyChecks().map((check) => patch[check.id] ?? check);

  it("does not count a 401 on a read made without the credential", () => {
    // `/readyz` is read with no credential; a 401 there says nothing about the token, so it is not "rejected", offers no renewal and the token still counts as accepted.
    const row = readsOf(checks({ health: refused("health", "open_tool_unauthenticated") }));
    expect(row.state).toBe("unknown_expiry");
    expect(row.last_accepted_at).toBeDefined();
    expect(row).not.toHaveProperty("reason");
  });

  it("calls a credential rejected on a 401 from any read it is expected to pass, and then says nothing was accepted", () => {
    for (const id of ["credential", "backends", "tools", "operations"]) {
      const row = readsOf(checks({ [id]: refused(id, "open_tool_unauthenticated") }));
      expect(row, id).toMatchObject({ state: "rejected", reason: "unauthenticated" });
      // Other reads passing in the same reading would otherwise say "refused" and "accepted just now" at once.
      expect(row, id).not.toHaveProperty("last_accepted_at");
    }
  });

  it("calls a 401 on a read the credential may simply not be granted a limit, not a rejection", () => {
    // Gateway usage needs an audit scope the owner console does not issue: refused, while everything else passes.
    for (const reason of ["open_tool_unauthenticated", "open_tool_forbidden"] as const) {
      const row = readsOf(checks({ usage: refused("usage", reason) }));
      expect(row, reason).toMatchObject({ state: "limited", reason: "read_forbidden" });
      expect(row.last_accepted_at, reason).toBeDefined();
    }
    // When every read is refused, the optional one included, the expected reads are what decide.
    const all = readsOf([ok("health"), ...["credential", "backends", "tools", "operations", "usage"].map((id) => refused(id, "open_tool_unauthenticated"))]);
    expect(all).toMatchObject({ state: "rejected", reason: "unauthenticated" });
  });

  it("applies the same rule to DriveBridge, whose two credentialed reads are both expected", () => {
    const drive = (reads: OpenToolCheck[]) => projection({ tool: "drivebridge", checks: reads, primary: ["capabilities", "operations"], operations: summarizeOperations([], "partial") });
    const row = (reads: OpenToolCheck[]) => only(statuses(config(), { openTools: [drive(reads)] }), "open_tool:drivebridge");
    expect(row([refused("health", "open_tool_unauthenticated"), ok("capabilities"), ok("operations")]).state).toBe("ok");
    expect(row([ok("health"), refused("capabilities", "open_tool_unauthenticated"), ok("operations")])).toMatchObject({ state: "rejected", reason: "unauthenticated" });
    expect(row([ok("health"), refused("capabilities", "open_tool_forbidden"), refused("operations", "open_tool_forbidden")])).toMatchObject({ state: "rejected", reason: "forbidden" });
    expect(row([ok("health"), ok("capabilities"), refused("operations", "open_tool_forbidden")])).toMatchObject({ state: "limited", reason: "read_forbidden" });
  });
});

describe("who is given credential rows", () => {
  const personal = (patch: Partial<Session> = {}): Session => ({ id: "s", issuer: "yeisme:personal", subject: "owner", name: "Owner", accessToken: "", accessAudience: [], expires: Date.now() + 60_000, csrf: "c", epoch: 1, personal: true, ...patch });
  const accounts = (extra: Partial<ServerConfig> = {}): ServerConfig => ({
    ...config(), auth_mode: "personal",
    personal: { name: "Owner", username: "head", role: "admin", password_hash_ref: "/not-read", scope_ids: ["scope-a"], users: [
      { username: "ana", name: "Ana", role: "admin", key_hash_ref: "/not-read", scope_ids: ["scope-a"] },
      { username: "vic", name: "Vic", role: "viewer", key_hash_ref: "/not-read", scope_ids: ["scope-a"] },
      { username: "gone", name: "Gone", role: "admin", key_hash_ref: "/not-read", scope_ids: ["scope-a"], enabled: false },
    ] },
    ...extra,
  });

  it("is true for a personal administrator only, by the rule SessionAuth.role applies", () => {
    const cfg = accounts();
    const auth = new SessionAuth(cfg);
    const cases: [string, Session, boolean][] = [
      ["named admin", personal({ subject: "ana" }), true],
      ["named viewer", personal({ subject: "vic" }), false],
      ["disabled admin", personal({ subject: "gone" }), false],
      ["unknown name", personal({ subject: "nobody" }), false],
      ["the account in personal.username", personal({ subject: "head" }), true],
      ["wrong issuer", personal({ subject: "ana", issuer: "https://id.example.test" }), false],
      ["not a personal session", personal({ subject: "ana", personal: false }), false],
    ];
    for (const [name, session, expected] of cases) {
      expect(isPersonalAdmin(cfg, session), name).toBe(expected);
      // The same answer as the server's own role lookup, wherever that has one.
      if (session.personal) expect(isPersonalAdmin(cfg, session), name).toBe(auth.role(session) === "admin");
    }
    // Without named accounts the legacy single account decides: admin only when the configuration says so, under the default name.
    const legacy = (role: "admin" | "viewer", username?: string) => ({ ...config(), auth_mode: "personal" as const, personal: { name: "Owner", ...(username ? { username } : {}), role, password_hash_ref: "/not-read", scope_ids: ["scope-a"] } });
    for (const [name, cfgLegacy, subject, expected] of [["legacy admin", legacy("admin"), "owner", true], ["legacy viewer", legacy("viewer"), "owner", false], ["legacy named admin", legacy("admin", "head"), "head", true], ["legacy admin under another name", legacy("admin", "head"), "owner", false]] as const) {
      expect(isPersonalAdmin(cfgLegacy, personal({ subject })), name).toBe(expected);
      expect(new SessionAuth(cfgLegacy).role(personal({ subject })) === "admin", name).toBe(expected);
    }
    // A server that is not in personal mode has no personal administrator.
    expect(isPersonalAdmin({ ...cfg, auth_mode: "oidc" }, personal({ subject: "head" }))).toBe(false);
  });
});

describe("a private file this process cannot read", () => {
  const dir = mkdtempSync(join(tmpdir(), "credentials-access-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  // Root reads any file, so a mode that shuts the owner out proves nothing there.
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;

  it.skipIf(asRoot)("is refused by the status view and by secret() alike, with no group or other bit set", () => {
    const path = join(dir, "shut");
    writeFileSync(path, "a-token\n", { mode: 0o600 });
    chmodSync(path, 0o200);
    expect(credentialFileProblem(path)).toBe("permissions");
    const cfg = config();
    cfg.open_tools!.gateway!.credential_ref = path;
    expect(only(credentialStatuses(cfg, scope, { now }), "open_tool:gateway")).toMatchObject({ state: "unreadable", reason: "permissions" });
    expect(() => secret(path)).toThrow(expect.objectContaining({ code: "credential_unreadable", reason: "permissions" }));
    chmodSync(path, 0o600);
    expect(credentialFileProblem(path)).toBeNull();
    expect(secret(path)).toBe("a-token");
  });
});
