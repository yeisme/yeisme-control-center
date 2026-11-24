import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { MediaBridge } from "../server/media";
import type { TaskConnections } from "../server/task-connections";
import type { Session, ScopeBinding } from "../server/contracts";
import type { EpisodeArtifactAccessPort, EpisodeArtifactGrant, EpisodeArtifactTarget } from "../server/episode-artifact-access";

// An ephemeral local HTTP owner proves transfer mechanics, not a live Scaena grant.
it("streams real loopback HTTP bytes and ranges, then denies revoked or expired authorization", async () => {
  const bytes = Buffer.from([1, 2, 3, 4, 5, 6]);
  let requests = 0;
  const owner = createServer((request, response) => {
    requests++;
    response.setHeader("Content-Type", "video/mp4");
    if (request.headers.range === "bytes=1-3") {
      response.writeHead(206, { "Content-Length": "3", "Content-Range": "bytes 1-3/6" });
      response.end(bytes.subarray(1, 4));
    } else {
      response.writeHead(200, { "Content-Length": String(bytes.length) });
      response.end(request.method === "HEAD" ? undefined : bytes);
    }
  });
  await new Promise<void>((resolve, reject) => {
    owner.once("error", reject);
    owner.listen(0, "127.0.0.1", () => resolve());
  });
  try {
    const origin = `http://127.0.0.1:${(owner.address() as AddressInfo).port}`;
    const scope: ScopeBinding = { id: "s", tenant: "t", team: "team", project: "p", label: "local", owners: {} };
    const session: Session = { id: "session", issuer: "test", subject: "reader", name: "Reader", csrf: "test", accessToken: "", accessAudience: [], expires: Date.now() + 60000, epoch: 1, personal: true };
    const target: EpisodeArtifactTarget = { connection: "test-owner", episode_ref: "ep", artifact_ref: "asset", expected_revision: "r1", digest: `sha256:${"a".repeat(64)}` };
    const grant: EpisodeArtifactGrant = { grantId: "local-test", scopeId: scope.id, target, purpose: "preview", revoked: false, credentialRevoked: false, validatedURL: new URL(`${origin}/grant/test`), expires: Date.now() + 60000, mime: "video/mp4", size: bytes.length, name: "test.mp4" };
    const port: EpisodeArtifactAccessPort = { trustedOrigin: origin, authorize: vi.fn(async () => grant) };
    const bridge = new MediaBridge({} as TaskConnections, fetch, undefined, port);
    const handle = await bridge.issueEpisode(session, scope, target, "preview");
    expect(JSON.stringify(handle)).not.toContain(origin);
    const key = new URL(handle.url, "http://control.test").pathname.split("/").pop()!;
    const full = await bridge.read(key, new Request("http://control.test/media"), session, scope);
    expect(full.status).toBe(200);
    expect(full.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
    const range = await bridge.read(key, new Request("http://control.test/media", { headers: { Range: "bytes=1-3" } }), session, scope);
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe("bytes 1-3/6");
    expect(Buffer.from(await range.arrayBuffer())).toEqual(bytes.subarray(1, 4));
    grant.revoked = true;
    await expect(bridge.read(key, new Request("http://control.test/media"), session, scope)).rejects.toThrow("content_not_authorized");
    grant.revoked = false;
    grant.expires = Date.now() - 1;
    await expect(bridge.read(key, new Request("http://control.test/media"), session, scope)).rejects.toThrow("media_grant_expired");
    expect(requests).toBe(2);
  } finally {
    owner.closeAllConnections();
    await new Promise<void>((resolve, reject) => owner.close((error) => error ? reject(error) : resolve()));
  }
});
