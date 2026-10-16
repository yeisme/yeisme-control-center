import { expect, it, vi } from "vitest";
import { MediaBridge } from "../server/media";
import { TaskConnections } from "../server/task-connections";
import type { ScopeBinding, Session } from "../server/contracts";
const scope: ScopeBinding = {
  id: "s",
  tenant: "t",
  team: "",
  project: "p",
  label: "P",
  owners: {},
};
const session = { id: "one" } as Session;
function setup(mime = "image/png", status = 200) {
  const artifact = vi.fn(async () => ({
    url: new URL("http://127.0.0.1/api/v1/artifact-access/acc_test"),
    expires: Date.now() + 100000,
    artifact: { ref: "ref" },
  }));
  const fetcher = vi.fn(
    async (_url: unknown, init?: RequestInit) =>
      new Response(init?.method === "HEAD" ? null : new Uint8Array([1, 2, 3]), {
        status,
        headers: {
          "Content-Type": mime,
          "Content-Length": "3",
          ...(status === 206 ? { "Content-Range": "bytes 0-2/10" } : {}),
        },
      }),
  );
  const detail = vi.fn(async () => ({
    results: [{ ref: "ref" }, { ref: "r" }],
  }));
  return {
    artifact,
    detail,
    fetcher,
    bridge: new MediaBridge(
      {
        artifact,
        detail,
        locate: () => ({ c: { allow_content: true } }),
        mediaHeaders: () => ({}),
      } as unknown as TaskConnections,
      fetcher as typeof fetch,
    ),
  };
}
it("bounds concurrent transfers and releases capacity when a client aborts without draining", async () => {
  const { bridge, fetcher, detail } = setup();
  fetcher.mockImplementation(
    async () =>
      new Response(new ReadableStream<Uint8Array>({ pull() {} }), {
        headers: { "Content-Type": "audio/wav", "Content-Length": "3" },
      }),
  );
  const handle = await bridge.issue(session, scope, "t", "r", "preview"),
    key = handle.url.split("/").pop()!.split("?")[0];
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const responses = await Promise.all(
    controllers.map((c) =>
      bridge.read(
        key,
        new Request("http://localhost", { signal: c.signal }),
        session,
        scope,
      ),
    ),
  );
  await expect(
    bridge.read(key, new Request("http://localhost"), session, scope),
  ).rejects.toThrow("media_busy");
  controllers[0].abort();
  await expect(responses[0].arrayBuffer()).rejects.toThrow();
  const next = await bridge.read(
    key,
    new Request("http://localhost"),
    session,
    scope,
  );
  await next.body?.cancel();
  for (let i = 1; i < responses.length; i++) await responses[i].body?.cancel();
  detail.mockResolvedValueOnce({ results: [] });
  const n = fetcher.mock.calls.length;
  await expect(
    bridge.read(key, new Request("http://localhost"), session, scope),
  ).rejects.toThrow("artifact_not_found");
  expect(fetcher).toHaveBeenCalledTimes(n);
});
it("streams only session-bound content and repeats owner authorization", async () => {
  const { bridge, detail, fetcher } = setup();
  const handle = await bridge.issue(session, scope, "task", "ref", "preview");
  const issueCalls = fetcher.mock.calls.length;
  expect(handle.url).not.toContain("acc_test");
  const key = new URL(handle.url, "http://localhost").pathname
    .split("/")
    .pop()!;
  await expect(
    bridge.read(
      key,
      new Request("http://localhost"),
      { ...session, id: "other" },
      scope,
    ),
  ).rejects.toThrow("media_not_found");
  expect(fetcher).toHaveBeenCalledTimes(issueCalls);
  const response = await bridge.read(
    key,
    new Request("http://localhost"),
    session,
    scope,
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.arrayBuffer()).byteLength).toBe(3);
  expect(detail).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
});
it("requires a new explicit access request after the owner grant expires", async () => {
  const { bridge, artifact, fetcher } = setup();
  const value = await bridge.issue(session, scope, "t", "r", "preview"),
    key = value.url.split("/").pop()!.split("?")[0];
  const issueCalls = fetcher.mock.calls.length;
  fetcher.mockImplementation(async () => new Response(null, { status: 410 }));
  await expect(
    bridge.read(key, new Request("http://localhost"), session, scope),
  ).rejects.toThrow("media_unavailable");
  expect(artifact).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(issueCalls + 1);
  await expect(
    bridge.read(key, new Request("http://localhost"), session, scope),
  ).rejects.toThrow("media_unavailable");
  expect(artifact).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(issueCalls + 2);
});
it("accepts a single Range and HEAD, rejects multipart and unsafe MIME", async () => {
  const { bridge } = setup("image/png", 206);
  const value = await bridge.issue(session, scope, "t", "r", "download");
  const key = value.url.split("/").pop()!.split("?")[0];
  const response = await bridge.read(
    key,
    new Request("http://localhost", { headers: { Range: "bytes=0-2" } }),
    session,
    scope,
  );
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe("bytes 0-2/10");
  await response.arrayBuffer();
  await expect(
    bridge.read(
      key,
      new Request("http://localhost", { headers: { Range: "bytes=0-2,4-5" } }),
      session,
      scope,
    ),
  ).rejects.toThrow("invalid_range");
  const head = await bridge.read(
    key,
    new Request("http://localhost", {
      method: "HEAD",
      headers: { Range: "bytes=0-2" },
    }),
    session,
    scope,
  );
  expect(head.body).toBeNull();
  const unsafe = setup("text/html");
  const h = await unsafe.bridge.issue(session, scope, "t", "r", "preview");
  await expect(
    unsafe.bridge.read(
      h.url.split("/").pop()!.split("?")[0],
      new Request("http://localhost"),
      session,
      scope,
    ),
  ).rejects.toThrow("media_limits_exceeded");
});
