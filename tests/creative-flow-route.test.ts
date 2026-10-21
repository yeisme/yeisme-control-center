import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import type { ScopeBinding, ServerConfig, Session } from "../server/contracts";
import type { ScaenaStoryboardReader } from "../server/scaena-storyboard";
import type { AuctraCollectionReader } from "../server/auctra";

const origin = "http://127.0.0.1:4490";
const scope: ScopeBinding = { id: "scope-a", tenant: "tenant-a", team: "team-a", project: "project-a", label: "Project A", owners: { scaena: { tenant: "tenant-a", project: "project-a", actor: "operator", audience: "aud-scaena" } } };
const session: Session = { id: "session-a", issuer: "yeisme:personal", subject: "owner", name: "Owner", csrf: "csrf", accessToken: "", accessAudience: [], expires: Date.now() + 60_000, personal: true, epoch: 3 };

describe("creative flow route", () => {
  it("projects a Scaena breakdown without exposing owner payloads", async () => {
    const config: ServerConfig = { origin, port: 4490, auth_mode: "personal", personal: { name: "Owner", password_hash_ref: "/unused", scope_ids: [scope.id], role: "admin" }, principals: [{ issuer: "yeisme:personal", subject: "owner", name: "Owner", role: "admin", scopes: [scope] }], owners: {} };
    const auth = new SessionAuth(config);
    vi.spyOn(auth, "current").mockReturnValue(session);
    const scaena = { snapshot: vi.fn(async () => ({ owner: "scaena" as const, project_ref: "project-a", observed_at: "2026-10-20T00:01:00.000Z", coverage: "complete" as const, freshness: "fresh" as const, items: [{ breakdown_ref: "breakdown-1", episode_ref: "episode-1", state: "waiting_review", native_state: "review_required", revision: "2", observed_at: "2026-10-20T00:01:00.000Z", blockers: [] }] })) } as unknown as ScaenaStoryboardReader;
    const app = createApp(config, { auth, scaenaStoryboard: scaena });
    const response = await app(new Request(origin + "/api/control-center/v1/creative-flow?scope=scope-a", { headers: { Cookie: "yeisme_session=" + session.id } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.schema_version).toBe("yeisme.creative_flow.v1");
    expect(body.stages[0].stage).toBe("production_breakdown");
    expect(JSON.stringify(body)).not.toContain("Authorization");
    expect(JSON.stringify(body)).not.toContain("provider_payload");
  });

  it("uses the semantic Auctra flow contract when an episode is requested", async () => {
    const config: ServerConfig = { origin, port: 4490, auth_mode: "personal", personal: { name: "Owner", password_hash_ref: "/unused", scope_ids: [scope.id], role: "admin" }, principals: [{ issuer: "yeisme:personal", subject: "owner", name: "Owner", role: "admin", scopes: [scope] }], owners: {} };
    const auth = new SessionAuth(config);
    vi.spyOn(auth, "current").mockReturnValue(session);
    const auctra = {
      creativeFlow: vi.fn(async () => ({
        schema_version: "auctra.creative_flow_source.v1" as const,
        owner: "auctra" as const,
        project_ref: "project-a",
        episode_ref: "episode-1",
        observed_at: "2026-10-20T00:01:00.000Z",
        coverage: "complete" as const,
        stages: [{ stage: "screenplay" as const, owner: "auctra" as const, object_kind: "screenplay", source_ref: "screenplay-1", state: "accepted", native_state: "accepted", revision: "v1", digest: "sha256:abc", observed_at: "2026-10-20T00:01:00.000Z", source_current: true, episode_ref: "episode-1", safe_refs: ["screenplay-1"] }],
      })),
    } as unknown as AuctraCollectionReader;
    const scaena = { snapshot: vi.fn(async () => ({ owner: "scaena" as const, project_ref: "project-a", observed_at: "2026-10-20T00:01:00.000Z", coverage: "needs_contract" as const, freshness: "unknown" as const, items: [], blocker: "contract" })) } as unknown as ScaenaStoryboardReader;
    const app = createApp(config, { auth, auctra, scaenaStoryboard: scaena });
    const response = await app(new Request(origin + "/api/control-center/v1/creative-flow?scope=scope-a&episode_ref=episode-1", { headers: { Cookie: "yeisme_session=" + session.id } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stages[0]).toMatchObject({ stage: "screenplay", source_ref: "screenplay-1", source_current: true });
    expect(body.source_coverage[0]).toMatchObject({ owner: "auctra", state: "complete" });
  });
});

