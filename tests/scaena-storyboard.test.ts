import { describe, expect, it, vi } from "vitest";
import { ScaenaStoryboardReader } from "../server/scaena-storyboard";
import type { ScopeBinding, ServerConfig, Session } from "../server/contracts";

const scope: ScopeBinding = { id: "scope-a", tenant: "tenant-a", team: "team-a", project: "project-a", label: "Project A", owners: { scaena: { tenant: "tenant-a", project: "project-a", actor: "operator", audience: "aud-scaena" } } };
const session: Session = { id: "session-a", issuer: "test", subject: "owner", name: "Owner", csrf: "csrf", accessToken: "owner-token", accessAudience: ["aud-scaena"], expires: Date.now() + 60_000, epoch: 1 };

describe("Scaena storyboard reader", () => {
  it("uses the fixed storyboard route and returns a safe summary", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/v1/projects/project-a/storyboard");
      expect(url.searchParams.get("episode")).toBe("episode-1");
      return Response.json({ data: {
        schema_version: "scaena.storyboard_workspace_projection.v1",
        project_ref: "project-a",
        episode_ref: "episode-1",
        revision: 2,
        digest: "sha256:" + "a".repeat(64),
        source: { source_ref: "source-1", episode_ref: "episode-1", revision: 1, digest: "sha256:" + "b".repeat(64), current: true, state: "accepted", safe_refs: ["source-1"] },
        items: [{ breakdown_ref: "breakdown-1", episode_ref: "episode-1", source_ref: "source-1", source_version: 1, source_digest: "sha256:" + "b".repeat(64), state: "waiting_review", version: 2, updated_at: "2026-10-20T00:01:00.000Z", blockers: ["needs_review"], raw_prompt: "must not pass" }],
      } });
    });
    const config: ServerConfig = { origin: "http://127.0.0.1:4491", port: 4491, owners: { scaena: { origin: "https://scaena.example.test", audience: "aud-scaena" } }, principals: [] };
    const result = await new ScaenaStoryboardReader(config, fetcher).snapshot(scope, session, { episode_ref: "episode-1" });
    expect(result.coverage).toBe("complete");
    expect(result.items[0]).toMatchObject({ breakdown_ref: "breakdown-1", state: "waiting_review" });
    expect(JSON.stringify(result)).not.toContain("raw_prompt");
  });

  it("keeps a missing owner route as needs_contract", async () => {
    const config: ServerConfig = { origin: "http://127.0.0.1:4491", port: 4491, owners: {}, principals: [] };
    const result = await new ScaenaStoryboardReader(config, vi.fn()).snapshot(scope, session);
    expect(result.coverage).toBe("needs_contract");
    expect(result.items).toEqual([]);
  });

  it("rejects a non-contract response instead of inferring success", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: { project_ref: "project-a", items: [{ breakdown_ref: "breakdown-1" }] } }));
    const config: ServerConfig = { origin: "http://127.0.0.1:4491", port: 4491, owners: { scaena: { origin: "https://scaena.example.test", audience: "aud-scaena" } }, principals: [] };
    const result = await new ScaenaStoryboardReader(config, fetcher).snapshot(scope, session, { episode_ref: "episode-1" });
    expect(result.coverage).toBe("needs_contract");
    expect(result.items).toEqual([]);
  });
});

