import { afterEach, expect, it, vi } from "vitest";
import { MediaBridge } from "../server/media";
import type { EpisodeArtifactAccessPort, EpisodeArtifactGrant, EpisodeArtifactTarget } from "../server/episode-artifact-access";
import type { ScopeBinding, Session } from "../server/contracts";
import type { TaskConnections } from "../server/task-connections";

// Provider-free fixtures for the internal port contract, NOT a Scaena adapter or app fallback.
const scope: ScopeBinding = { id: "s", tenant: "t", team: "", project: "p", label: "P", owners: {} };
const session = { id: "one", personal: true, epoch: 1 } as unknown as Session;
const target: EpisodeArtifactTarget = {
  connection: "episode-owner", episode_ref: "episode-1", artifact_ref: "artifact-1",
  expected_revision: "revision-1", digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};
const request = (headers?: HeadersInit) => new Request("http://localhost/media", { headers });
const keyOf = (url: string) => new URL(url, "http://localhost").pathname.split("/").pop()!;
function setup(status = 200) {
  const grant: EpisodeArtifactGrant = {
    grantId: "original-grant", scopeId: scope.id, target: { ...target }, purpose: "preview",
    revoked: false, credentialRevoked: false,
    validatedURL: new URL("https://owner.invalid/private-access/original"),
    expires: Date.now() + 60000, mime: "audio/wav", size: status === 206 ? 10 : 3, name: "episode-audio",
  };
  const authorize = vi.fn(async (): Promise<EpisodeArtifactGrant | null> => grant);
  const port = { trustedOrigin: "https://owner.invalid", authorize } satisfies EpisodeArtifactAccessPort;
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(
    init?.method === "HEAD" ? null : new Uint8Array([1, 2, 3]),
    { status, headers: { "Content-Type": "audio/wav", "Content-Length": "3",
      ...(status === 206 ? { "Content-Range": "bytes 0-2/10" } : {}) } },
  ));
  const tasks = { locate: vi.fn(() => { throw new Error("must not locate a task"); }),
    detail: vi.fn(() => { throw new Error("must not load a task"); }),
    artifact: vi.fn(() => { throw new Error("must not issue a task artifact"); }),
    mediaHeaders: vi.fn(() => { throw new Error("must not use task credentials"); }) };
  const bridge = new MediaBridge(tasks as unknown as TaskConnections, fetcher as typeof fetch, undefined, port);
  const issue = () => bridge.issueEpisode(session, scope, target, "preview");
  return { bridge, grant, port, authorize, fetcher, tasks, issue };
}
afterEach(() => vi.useRealTimers());

it.each([200, 206])("issues only an opaque same-origin handle and reauthorizes before %s/no-store streaming", async (status) => {
  const { bridge, issue, authorize, fetcher, tasks } = setup(status);
  const handle = await issue();
  expect(handle.url).toMatch(/^\/api\/control-center\/v1\/media\/[^?]+\?scope=s$/);
  expect(JSON.stringify(handle)).not.toContain("owner.invalid");
  expect(fetcher).not.toHaveBeenCalled();
  const response = await bridge.read(keyOf(handle.url), request(status === 206 ? { Range: "bytes=0-2" } : undefined), session, scope);
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("audio/wav");
  expect(await response.arrayBuffer()).toHaveProperty("byteLength", 3);
  expect(authorize).toHaveBeenCalledTimes(2);
  expect(authorize).toHaveBeenLastCalledWith(scope, target, "preview");
  expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
  if (status === 206) expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Range: "bytes=0-2" });
  for (const call of Object.values(tasks)) expect(call).not.toHaveBeenCalled();
});

it("supports HEAD through the same pipeline", async () => {
  const { bridge, issue } = setup();
  const handle = await issue();
  const response = await bridge.read(keyOf(handle.url), new Request("http://localhost/media", { method: "HEAD" }), session, scope);
  expect(response.status).toBe(200);
  expect(response.body).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("returns needs_contract with no playable result for an absent port or unknown mapping", async () => {
  const noPort = new MediaBridge({} as TaskConnections);
  await expect(noPort.issueEpisode(session, scope, target, "preview")).rejects.toThrow("needs_contract");
  const { issue, authorize, fetcher } = setup();
  authorize.mockResolvedValue(null);
  await expect(issue()).rejects.toThrow("needs_contract");
  expect(fetcher).not.toHaveBeenCalled();
});

it("refuses a mapping removed after issue, without falling back to a task", async () => {
  const { bridge, issue, authorize, fetcher, tasks } = setup();
  const handle = await issue();
  authorize.mockResolvedValue(null);
  await expect(bridge.read(keyOf(handle.url), request(), session, scope)).rejects.toThrow("needs_contract");
  expect(fetcher).not.toHaveBeenCalled();
  for (const call of Object.values(tasks)) expect(call).not.toHaveBeenCalled();
});

it("allows normal last_seen touches but rejects stable identity or authority changes", async () => {
  const { bridge, issue, authorize, fetcher } = setup();
  const handle = await issue();
  session.last_seen = Date.now() + 1;
  const response = await bridge.read(keyOf(handle.url), request(), session, { ...scope, label: "renamed" });
  await response.arrayBuffer();
  expect(authorize).toHaveBeenCalledTimes(2);
  await expect(bridge.read(keyOf(handle.url), request(), { ...session, subject: "other" }, scope)).rejects.toThrow("media_not_found");
  await expect(bridge.read(keyOf(handle.url), request(), session, { ...scope, owners: { scaena: { tenant: "t", project: "revoked", actor: "a", audience: "u" } } })).rejects.toThrow("media_not_found");
  await expect(bridge.read(keyOf(handle.url), request(), session, { ...scope, connection_ids: ["revoked"] })).rejects.toThrow("media_not_found");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects another session, epoch or scope before contacting the owner", async () => {
  const { bridge, issue, authorize, fetcher } = setup();
  const handle = await issue();
  for (const [otherSession, otherScope] of [
    [{ ...session, id: "other" }, scope],
    [{ ...session, epoch: 2 } as Session, scope],
    [session, { ...scope, id: "other" }],
    [session, { ...scope, project: "other" }],
  ] as const) {
    await expect(bridge.read(keyOf(handle.url), request(), otherSession, otherScope)).rejects.toThrow("media_not_found");
  }
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(fetcher).not.toHaveBeenCalled();
});

it("expires without refreshing the original grant", async () => {
  vi.useFakeTimers();
  const { bridge, issue, authorize, fetcher } = setup();
  const handle = await issue();
  vi.advanceTimersByTime(60001);
  await expect(bridge.read(keyOf(handle.url), request(), session, scope)).rejects.toThrow("media_handle_expired");
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["revoked", "credentialRevoked"] as const)("checks %s again before reading", async (flag) => {
  const { bridge, issue, grant, fetcher } = setup();
  const handle = await issue();
  grant[flag] = true;
  await expect(bridge.read(keyOf(handle.url), request(), session, scope)).rejects.toThrow("content_not_authorized");
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["connection", "episode_ref", "artifact_ref", "expected_revision", "digest"] as const)("rejects changed bound %s at issue and read", async (field) => {
  const { bridge, issue, grant, fetcher } = setup();
  const handle = await issue();
  grant.target[field] = "changed";
  await expect(bridge.read(keyOf(handle.url), request(), session, scope)).rejects.toThrow("episode_binding_mismatch");
  await expect(issue()).rejects.toThrow("episode_binding_mismatch");
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["grantId", "expires", "validatedURL", "mime", "size"] as const)("does not silently refresh original %s", async (field) => {
  const { bridge, issue, grant, fetcher } = setup();
  const handle = await issue();
  if (field === "expires") grant.expires += 1000;
  else if (field === "validatedURL") grant.validatedURL = new URL("https://owner.invalid/new-grant");
  else if (field === "size") grant.size += 1;
  else if (field === "mime") grant.mime = "audio/mpeg";
  else grant.grantId = "new-grant";
  await expect(bridge.read(keyOf(handle.url), request(), session, scope)).rejects.toThrow("episode_grant_changed");
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  "file:///etc/passwd", "javascript:alert(1)", "https://evil.invalid/private",
  "https://user:password@owner.invalid/private", "https://owner.invalid/private#fragment", "https://owner.invalid/private#",
])("rejects unsafe URL %s before issuing or fetching", async (url) => {
  const { issue, grant, fetcher } = setup();
  grant.validatedURL = new URL(url);
  await expect(issue()).rejects.toThrow("media_url_rejected");
  expect(fetcher).not.toHaveBeenCalled();
});

it("allows HTTP only at the explicitly configured trusted owner origin", async () => {
  const { bridge, issue, port, grant } = setup();
  port.trustedOrigin = "http://127.0.0.1:8123";
  grant.validatedURL = new URL("http://127.0.0.1:8123/private");
  const handle = await issue();
  const response = await bridge.read(keyOf(handle.url), request(), session, scope);
  await response.arrayBuffer();
  grant.validatedURL = new URL("http://127.0.0.1:8124/private");
  await expect(issue()).rejects.toThrow("media_url_rejected");
});

it("rejects redirect responses and never follows Location", async () => {
  const { bridge, issue, fetcher } = setup();
  const handle = await issue();
  fetcher.mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://evil.invalid" } }));
  await expect(bridge.read(keyOf(handle.url), request(), session, scope)).rejects.toThrow("media_unavailable");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
  const followed = new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/wav" } });
  Object.defineProperty(followed, "redirected", { value: true });
  fetcher.mockResolvedValue(followed);
  await expect(bridge.read(keyOf(handle.url), request(), session, scope)).rejects.toThrow("media_url_rejected");
});

it.each(["mime", "size", "expires", "scopeId"] as const)("rejects invalid %s metadata without a handle", async (field) => {
  const { issue, grant, fetcher } = setup();
  if (field === "mime") grant.mime = "text/html";
  else if (field === "size") grant.size = 128 * 1024 * 1024 + 1;
  else if (field === "expires") grant.expires = Date.now() - 1;
  else grant.scopeId = "wrong-scope";
  await expect(issue()).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  "bad digest", "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde", "sha256:0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef",
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n", " episode-ref", "episode-ref ", "episode-ref\n",
])("rejects malformed episode target field %s", async (value) => {
  const { issue, fetcher } = setup();
  const malformed = { ...target, digest: value };
  if (value.startsWith("episode") || value.startsWith(" ")) malformed.episode_ref = value;
  await expect(new MediaBridge({} as TaskConnections, fetch as typeof fetch, undefined, {
    trustedOrigin: "https://owner.invalid", authorize: vi.fn(async () => null),
  }).issueEpisode(session, scope, malformed, "preview")).rejects.toThrow("episode_binding_mismatch");
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects upstream MIME/size mismatches and multipart ranges", async () => {
  const { bridge, issue, fetcher } = setup();
  const handle = await issue();
  await expect(bridge.read(keyOf(handle.url), request({ Range: "bytes=0-1,2-2" }), session, scope)).rejects.toThrow("invalid_range");
  for (const headers of [{ "Content-Type": "audio/mpeg", "Content-Length": "3" }, { "Content-Type": "audio/wav", "Content-Length": "4" }]) {
    fetcher.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers }));
    await expect(bridge.read(keyOf(handle.url), request(), session, scope)).rejects.toThrow("media_limits_exceeded");
  }
});
