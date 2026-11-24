import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import { AuthError, SessionAuth } from "../server/auth";
import type { EpisodeArtifactAccessPort } from "../server/episode-artifact-access";
import type { TaskConnection } from "../server/contracts";
import { config, makeSession, origin } from "./fixtures/drama-fakes";

const connection = (id: string, owner: "scaena" | "eikona" = "scaena", patch: Partial<TaskConnection> = {}): TaskConnection => ({
  id, owner, instance_id: "i", label: id, environment: "test", project: "scaena-project",
  endpoint: "https://owner.example.test/mcp", credential_ref: "/unused-test-reference",
  enabled: true, allow_content: true, ...patch,
});

function setup(options: { session?: ReturnType<typeof makeSession> | null; connections?: TaskConnection[]; port?: EpisodeArtifactAccessPort } = {}) {
  const session = options.session === null ? null : options.session || makeSession();
  const auth = new SessionAuth(config);
  vi.spyOn(auth, "current").mockImplementation(() => {
    if (!session) throw new AuthError("login_required", 401);
    return session;
  });
  const tasks = { connections: vi.fn(() => options.connections || [connection("scaena-main")]), list: async () => ({ rows: [], connections: [], next_cursors: {} }), observe: async () => [] };
  const app = createApp(config, { auth, tasks: tasks as never, episodeArtifacts: options.port });
  const post = (body: unknown, headers: Record<string, string> = {}, scope = "scope-a", artifact = "artifact-1") => app(new Request(`${origin}/api/control-center/v1/episode-production/artifacts/${artifact}/access?scope=${scope}`, {
    method: "POST", headers: { Origin: origin, Cookie: `yeisme_session=${session?.id || "missing"}`, "X-CSRF-Token": session?.csrf || "", ...headers }, body: JSON.stringify(body),
  }));
  return { post, tasks, session };
}

const body = { episode_ref: "ep-1", connection: "scaena-main", expected_revision: "3", digest: "sha256:" + "a".repeat(64), purpose: "preview" } as const;

describe("POST /episode-production/artifacts/:artifact_ref/access", () => {
  it("requires a session and CSRF", async () => {
    const noSession = setup({ session: null });
    expect((await noSession.post(body)).status).toBe(401);
    const auth = setup();
    expect((await auth.post(body, { "X-CSRF-Token": "wrong" })).status).toBe(403);
  });

  it("rejects a scope outside the session and malformed or forbidden requests before the port", async () => {
    const port = { trustedOrigin: "https://owner.example.test", authorize: vi.fn() } as unknown as EpisodeArtifactAccessPort;
    const scoped = setup({ port });
    expect((await scoped.post(body, {}, "not-a-scope")).status).toBe(404);
    expect((await scoped.post({ ...body, actor: "nope" })).status).toBe(400);
    expect((await scoped.post({ ...body, connection: "unknown" })).status).toBe(403);
    expect(port.authorize).not.toHaveBeenCalled();
  });

  it("fails closed without an injected owner port", async () => {
    const result = await setup().post(body);
    expect(result.status).toBe(409);
    expect((await result.json()).error).toBe("needs_contract");
  });

  it("requires an exact injected mapping and returns a same-origin handle", async () => {
    const port: EpisodeArtifactAccessPort = {
      trustedOrigin: "https://owner.example.test",
      authorize: vi.fn(async (_scope, target, purpose) => target.artifact_ref === "artifact-1" ? {
        grantId: "grant-1", scopeId: "scope-a", target, purpose, revoked: false, credentialRevoked: false,
        validatedURL: new URL("https://owner.example.test/media/artifact-1"), expires: Date.now() + 60_000,
        mime: "video/mp4", size: 10, name: "clip.mp4",
      } : null),
    };
    const result = await setup({ port }).post(body);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ url: expect.stringMatching(/^\/api\/control-center\/v1\/media\//), mime: "video/mp4", filename: "clip.mp4" });
    expect(port.authorize).toHaveBeenCalledWith(expect.objectContaining({ id: "scope-a" }), expect.objectContaining({ artifact_ref: "artifact-1", episode_ref: "ep-1" }), "preview");
  });
});
