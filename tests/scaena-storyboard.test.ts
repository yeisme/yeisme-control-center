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


const sha = (char: string) => "sha256:" + char.repeat(64);
const readerConfig: ServerConfig = { origin: "http://127.0.0.1:4491", port: 4491, owners: { scaena: { origin: "https://scaena.example.test", audience: "aud-scaena" } }, principals: [] };

function breakdown(ref: string, state: string, version: number, updated: string, extra: Record<string, unknown> = {}) {
  return { breakdown_ref: ref, episode_ref: "ep-1", source_ref: "src-1", source_version: 1, source_digest: sha("b"), version, state, updated_at: updated, scene_count: 1, shot_count: 2, duration_ms: 9000, finding_count: 0, allowed_actions: ["accept"], ...extra };
}

function projection(items: unknown[], extra: Record<string, unknown> = {}) {
  return { data: { schema_version: "scaena.storyboard_workspace_projection.v1", project_ref: "project-a", episode_ref: "ep-1", revision: 4, digest: sha("a"), source: { source_ref: "src-1", episode_ref: "ep-1", revision: 1, digest: sha("b"), current: true, state: "accepted", safe_refs: [] }, items, ...extra } };
}

const read = (body: unknown, query: { episode_ref?: string; limit?: number } = { episode_ref: "ep-1" }, calls?: URL[]) =>
  new ScaenaStoryboardReader(readerConfig, vi.fn(async (input: RequestInfo | URL) => { calls?.push(new URL(String(input))); return Response.json(body); })).snapshot(scope, session, query);

describe("Scaena storyboard reader: episode board contract", () => {
  it("never calls Scaena without an episode, because the route requires one", async () => {
    const fetcher = vi.fn();
    const result = await new ScaenaStoryboardReader(readerConfig, fetcher).snapshot(scope, session);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toMatchObject({ coverage: "unknown", blocker: "episode_ref_required", items: [] });
  });

  it("asks for a small page and orders attempts newest first, so the head is the current breakdown", async () => {
    const calls: URL[] = [];
    const result = await read(projection([
      breakdown("bd-old", "failed", 1, "2026-10-20T00:00:00.000Z"),
      breakdown("bd-new", "accepted", 3, "2026-10-22T00:00:00.000Z"),
      breakdown("bd-mid", "rejected", 2, "2026-10-21T00:00:00.000Z"),
    ]), { episode_ref: "ep-1" }, calls);
    expect(calls[0].searchParams.get("limit")).toBe("3");
    expect(result.items.map((item) => item.breakdown_ref)).toEqual(["bd-new", "bd-mid", "bd-old"]);
    expect(result.outline).toMatchObject({ head_breakdown_ref: "bd-new", older_attempts: 2, truncated: false });
  });

  it("treats a missing source as 'not started', not as a broken contract", async () => {
    const result = await read({ data: { schema_version: "scaena.storyboard_workspace_projection.v1", project_ref: "project-a", episode_ref: "ep-1", revision: 1, digest: sha("a"), items: [] } });
    expect(result).toMatchObject({ coverage: "complete", items: [] });
    expect(result.blocker).toBeUndefined();
  });

  it("still rejects a breakdown that names a source the projection does not carry", async () => {
    const body = projection([breakdown("bd-1", "accepted", 1, "2026-10-22T00:00:00.000Z")]);
    delete (body.data as Record<string, unknown>).source;
    expect(await read(body)).toMatchObject({ coverage: "needs_contract", items: [] });
  });

  it("flags unfetched older attempts instead of silently dropping them", async () => {
    const result = await read(projection([breakdown("bd-1", "accepted", 3, "2026-10-22T00:00:00.000Z")], { next_cursor: "older" }));
    expect(result).toMatchObject({ coverage: "complete", truncated: true });
    expect(result.outline?.truncated).toBe(true);
  });

  it("maps in-flight and cancelled breakdowns to honest states", async () => {
    const running = await read(projection([breakdown("bd-1", "running", 1, "2026-10-22T00:00:00.000Z")]));
    expect(running.items[0]).toMatchObject({ native_state: "running", state: "in_progress" });
    const cancelled = await read(projection([breakdown("bd-1", "cancelled", 1, "2026-10-22T00:00:00.000Z")]));
    expect(cancelled.items[0]).toMatchObject({ state: "blocked", blockers: ["breakdown_cancelled"] });
  });

  it("keeps structure for the outline and drops action summaries, media and prompts", async () => {
    const result = await read(projection([breakdown("bd-1", "accepted", 3, "2026-10-22T00:00:00.000Z", {
      scenes: [{ scene_ref: "sc-2", order: 2, heading: "站台·夜", shots: [{ shot_ref: "sh-3", scene_ref: "sc-2", order: 1, shot_size: "全景", camera_angle: "平视", camera_movement: "推", duration_ms: 3000, action_summary: "SECRET-ACTION-TEXT", candidate_refs: ["cand-1"] }] }, { scene_ref: "sc-1", order: 1, heading: "x".repeat(200), shots: [] }],
      media: [{ candidate_ref: "cand-1", shot_ref: "sh-3", representation_ref: "rep-1", content_ref: "content-secret", digest: sha("c"), media_type: "image/png", status: "ready" }],
      raw_prompt: "SECRET-PROMPT",
    })]));
    const serialized = JSON.stringify(result);
    for (const forbidden of ["SECRET-ACTION-TEXT", "SECRET-PROMPT", "content-secret", "representation_ref", "action_summary", "candidate_refs", "allowed_actions"]) expect(serialized).not.toContain(forbidden);
    expect(result.outline?.scenes.map((scene) => scene.scene_ref)).toEqual(["sc-1", "sc-2"]);
    expect(result.outline?.scenes[0].heading).toHaveLength(80);
    expect(result.outline?.scenes[1].shots[0]).toEqual({ shot_ref: "sh-3", order: 1, shot_size: "全景", camera_angle: "平视", camera_movement: "推", duration_ms: 3000 });
    expect(result.outline).toMatchObject({ scene_count: 1, shot_count: 2, duration_ms: 9000 });
  });

  it("rejects a projection for a different episode than the one asked for", async () => {
    const body = projection([breakdown("bd-1", "accepted", 1, "2026-10-22T00:00:00.000Z")]);
    expect(await read(body, { episode_ref: "ep-2" })).toMatchObject({ coverage: "needs_contract" });
  });
});

describe("Scaena storyboard reader: untrusted owner text", () => {
  it("drops refs and tokens with control characters or absurd length instead of passing them on", async () => {
    const result = await read(projection([breakdown("bd-1", "accepted", 1, "2026-10-22T00:00:00.000Z", {
      blockers: ["ok_token", "bad\ntoken", "x".repeat(400), 7],
      scenes: [{ scene_ref: "sc-1\u0007", order: 1, heading: "ok", shots: [] }, { scene_ref: "sc-2", order: 2, heading: "ok", shots: [{ shot_ref: "sh\r1", order: 1 }, { shot_ref: "sh-2", order: 2 }] }],
    })]));
    expect(result.items[0].blockers).toEqual(["ok_token"]);
    expect(result.outline?.scenes.map((scene) => scene.scene_ref)).toEqual(["sc-2"]);
    expect(result.outline?.scenes[0].shots.map((shot) => shot.shot_ref)).toEqual(["sh-2"]);
  });

  it("rejects a breakdown whose ref carries control characters as a contract violation", async () => {
    expect(await read(projection([breakdown("bd\n1", "accepted", 1, "2026-10-22T00:00:00.000Z")]))).toMatchObject({ coverage: "needs_contract" });
  });
});
