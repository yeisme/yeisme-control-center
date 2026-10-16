import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium, expect } from "@playwright/test";
import { hashPassword } from "../server/password";
const release = process.env.CONTROL_CENTER_RELEASE ? path.resolve(process.env.CONTROL_CENTER_RELEASE) : undefined;
if (release && !release.startsWith(path.resolve("temp/integration-test-runs") + path.sep)) throw Error("Candidate release must be local test evidence.");
const run = path.resolve(
  "temp/integration-test-runs/task-visibility-" +
    new Date().toISOString().replace(/[:.]/g, "-"),
);
await fs.mkdir(run + "/artifacts", { recursive: true });
await fs.writeFile(
  run + "/command.txt",
  (release ? "CONTROL_CENTER_RELEASE=" + release + " " : "") + "bun scripts/verify-task-visibility.ts\n",
);
await fs.writeFile(
  run + "/env.json",
  JSON.stringify({
    layer: "component",
    release: release || null,
    browser: true,
    upstream: "fake MCP contract",
    real_owner_processes: false,
    provider_calls: false,
  }),
);
await fs.writeFile(run + "/stdout.log", "");
await fs.writeFile(run + "/stderr.log", "");
const privateDir = await fs.mkdtemp("/tmp/task-visibility-");
const password = "local-browser-test-only";
await fs.writeFile(privateDir + "/password", await hashPassword(password), {
  mode: 0o600,
});
await fs.writeFile(privateDir + "/observer", "test-only-observer", {
  mode: 0o600,
});
const port = await new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = (s.address() as any).port;
    s.close(() => resolve(p));
  });
});
let phase = "queued",
  calls = 0;
const operations: string[] = [];
const row = (variant: "default" | "content-off" | "owner-denied" = "default") => {
  const contentOff = variant === "content-off";
  const denied = variant === "owner-denied";
  return {
    schema_version: "yeisme.task_observation.v1",
    locator: { owner: "eikona", project: "p", task_family: "run", task_ref: contentOff ? "browser-content-off" : denied ? "browser-owner-denied" : "browser-original" },
    title: contentOff ? "本地内容关闭任务" : denied ? "来源内容拒绝任务" : "隔离任务",
    state: phase, native_state: phase, stage: phase, revision: phase,
    created_at: "2026-10-01T00:00:00Z", updated_at: new Date().toISOString(),
    progress: { kind: "indeterminate" },
    results: phase === "succeeded" ? [
      { ref: "eikona://artifact/test-result", name: "Test result", mime: "image/png", bytes: 68, state: "candidate" },
      { ref: "eikona://artifact/video-result", name: "Test video", mime: "video/mp4", bytes: mp4.length, state: "candidate" },
    ] : [],
    allowed_actions: [
      { action: "cancel", enabled: false, reason: "not_supported" },
      { action: "preview", enabled: true },
      { action: "download", enabled: true },
    ],
  };
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1kAAAAASUVORK5CYII=",
  "base64",
);
const videoFixturePath = privateDir + "/video.mp4";
const videoProcess = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=64x64:r=10:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", videoFixturePath]);
const videoExit = await new Promise<number>((resolve) => {
  videoProcess.once("error", () => resolve(127));
  videoProcess.once("exit", (code) => resolve(code ?? 1));
});
if (videoExit !== 0) throw new Error("video_fixture_generation_failed");
const mp4 = await fs.readFile(videoFixturePath);
const wav = Buffer.alloc(44 + 1600);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(1600, 40);
const mediaRow = (owner: "sonora" | "scaena") => ({
  ...row(),
  state: "succeeded",
  native_state: "succeeded",
  stage: "completed",
  title: owner === "sonora" ? "隔离音频" : "隔离片场结果",
  episode_ref: owner === "scaena" ? "e" : undefined,
  locator: {
    owner,
    project: "p",
    task_family: owner === "sonora" ? "voice-render-job" : "delegation",
    task_ref: "media-original",
  },
  results: [
    {
      ref: owner === "sonora" ? "sonora://audio-asset/result" : "asset:result",
      name: "Owner media",
      mime: owner === "sonora" ? "audio/wav" : "image/png",
      bytes: owner === "sonora" ? wav.length : png.length,
      state: "candidate",
    },
  ],
});
let cancelState = "pending",
  cancelRevision = "pending",
  cancelExpectedRevision = "pending",
  cancelOutcome = "cancelled",
  cancelCalls = 0,
  cancelIdentity = "";
const cancellable = () => ({
  ...mediaRow("sonora"),
  title: "隔离可取消任务",
  locator: {
    owner: "sonora",
    project: "p",
    task_family: "local-job",
    task_ref: "sonora://local-job/cancel",
  },
  state: cancelState,
  native_state: cancelState,
  stage: cancelState,
  revision: cancelRevision,
  results: [],
  allowed_actions: [{ action: "cancel", enabled: cancelState === "pending" }],
});
type MockCall = {
  method?: string;
  id?: string;
  params: { name: string; arguments: { action: string; args: Record<string, unknown> } };
};
function isMockCall(value: unknown): value is MockCall {
  if (!value || typeof value !== "object" || !("params" in value)) return false;
  const params = value.params;
  if (!params || typeof params !== "object" || !("name" in params) || typeof params.name !== "string" || !("arguments" in params)) return false;
  const args = params.arguments;
  return !!args && typeof args === "object" && "action" in args && typeof args.action === "string" && "args" in args && !!args.args && typeof args.args === "object" && !Array.isArray(args.args);
}
const mock = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(r) {
    const u = new URL(r.url);
    if (
      (u.pathname.startsWith("/api/v1/artifact-access/") &&
        !u.pathname.includes("/acc_")) ||
      u.pathname.includes("/access-grants/")
    ) {
      if (r.headers.get("authorization") !== "Bearer test-only-observer")
        return new Response(null, { status: 403 });
      const audio = u.pathname.startsWith("/api/v1/artifact-access/");
      const bytes = audio ? wav : png;
      return new Response(r.method === "HEAD" ? null : bytes, {
        headers: {
          "Content-Type": audio ? "audio/wav" : "image/png",
          "Content-Length": String(bytes.length),
        },
      });
    }
    if (u.pathname.startsWith("/api/v1/artifact-access/")) {
      const video = u.pathname.endsWith("acc_" + "b".repeat(48));
      const bytes = video ? mp4 : png;
      const range = r.headers.get("range")?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
      if (start > end || start >= bytes.length) return new Response(null, { status: 416 });
      return new Response(r.method === "HEAD" ? null : bytes.subarray(start, end + 1), {
        status: range ? 206 : 200,
        headers: {
          "Content-Type": video ? "video/mp4" : "image/png",
          "Content-Length": String(end - start + 1),
          "Accept-Ranges": "bytes",
          ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}),
        },
      });
    }
    const raw = (await r.json()) as unknown;
    if (raw && typeof raw === "object" && "method" in raw && raw.method === "initialize") {
      const id = "id" in raw && typeof raw.id === "string" ? raw.id : undefined;
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: { protocolVersion: "2025-06-18" },
      });
    }
    if (!isMockCall(raw)) return Response.json({ error: "invalid_mock_call" }, { status: 400 });
    const b = raw;
    calls++;
    const action = b.params.arguments.action;
    operations.push(action);
    let data: unknown;
    const owner = b.params.name.split(".")[0];
    const variant = u.pathname === "/mcp-off" ? "content-off" : u.pathname === "/mcp-denied" ? "owner-denied" : "default";
    const selectedRow = row(variant);
    if (owner === "eikona" && variant === "owner-denied" && action === "artifact.access")
      return Response.json({ id: b.id, result: { structuredContent: { error: { code: "AUTH_ACTION_DENIED" } } } });
    if (owner === "eikona") {
      if (action === "control_center.capabilities")
        data = { schema_version: "yeisme.task_observation.v1", task_families: ["run"], artifact_access: true };
      else if (action === "control_center.tasks.list")
        data = variant === "default" && !b.params.arguments.args.cursor
          ? { rows: [], next_cursor: "page-2" }
          : { rows: phase === "succeeded" && b.params.arguments.args.mode === "active" ? [] : [selectedRow] };
      else if (action === "control_center.tasks.get")
        data = selectedRow;
      else if (action === "control_center.tasks.events")
        data = { events: [{ id: "accepted", occurred_at: "2026-10-01T00:00:00Z", stage: "accepted", state: "running" }], gap: false };
      else if (action === "artifact.access")
        return Response.json({
          jsonrpc: "2.0",
          id: b.id,
          result: {
            structuredContent: { result: { data: { schema_version: "eikona.artifact_access_grant.v1", expires_at: new Date(Date.now() + 600000).toISOString() } } },
            content: [{ type: "resource_link", uri: `http://127.0.0.1:${mock.port}/api/v1/artifact-access/acc_${(b.params.arguments.args.artifact_uri === "eikona://artifact/video-result" ? "b" : "a").repeat(48)}` }],
          },
        });
      else
        return Response.json({ id: b.id, result: { isError: true } });
      return Response.json({ id: b.id, result: { structuredContent: { result: { data } } } });
    }
    if (owner === "sonora" || owner === "scaena") {
      if (action === "control_center.capabilities")
        data = { schema_version: "yeisme.task_observation.v1", task_families: owner === "sonora" ? ["voice-render-job", "local-job"] : ["delegation"], artifact_access: true };
      else if (action === "control_center.tasks.list") {
        const args = b.params.arguments.args;
        const query = owner === "scaena" && args.query && typeof args.query === "object" ? args.query : args;
        const limit = "limit" in query ? Number(query.limit) : 50;
        data = { rows: (owner === "sonora" ? [mediaRow(owner), cancellable()] : [mediaRow(owner)]).slice(0, limit) };
      }
      else if (action === "control_center.tasks.get")
        data =
          b.params.arguments.args.task_ref === "sonora://local-job/cancel"
            ? cancellable()
            : mediaRow(owner);
      else if (
        action === "control_center.tasks.cancel" ||
        action === "control_center.tasks.cancel_receipt"
      ) {
        const args = b.params.arguments.args;
        if (action === "control_center.tasks.cancel") {
          if (args.expected_revision !== cancelRevision)
            return Response.json({
              id: b.id,
              result: {
                isError: true,
                structuredContent: { error: { code: "VERSION_CONFLICT" } },
              },
            });
          cancelExpectedRevision = String(args.expected_revision);
          cancelCalls++;
          cancelIdentity = String(args.idempotency_key);
          cancelState = "cancelled";
        }
        if (args.idempotency_key !== cancelIdentity)
          return Response.json({ id: b.id, result: { isError: true } });
        data = {
          task: cancellable(),
          receipt: {
            schema_version: "yeisme.task_cancel_receipt.v1",
            ref: "sonora://local-job-cancel/original",
            task_ref: cancellable().locator.task_ref,
            expected_revision: cancelExpectedRevision,
            outcome: cancelOutcome,
            occurred_at: new Date().toISOString(),
          },
        };
      } else if (action === "control_center.tasks.artifact_access")
        data = {
          schema_version: owner + ".task_artifact_grant.v1",
          artifact_ref: mediaRow(owner).results[0].ref,
          mime: mediaRow(owner).results[0].mime,
          bytes: mediaRow(owner).results[0].bytes,
          expires_at: new Date(Date.now() + 120000).toISOString(),
          url:
            `http://127.0.0.1:${mock.port}` +
            (owner === "sonora"
              ? "/api/v1/artifact-access/" +
                "b".repeat(32) +
                "?t=" +
                "x".repeat(43)
              : "/api/v1/projects/p/control-center/tasks/media-original/artifacts/asset:result/access-grants/artifact-grant:" +
                "b".repeat(32) +
                "?task_family=delegation"),
        };
      else data = { events: [], gap: true };
      return Response.json({
        id: b.id,
        result: {
          structuredContent:
            owner === "sonora"
              ? { result: { data: { projection: data } } }
              : { data },
        },
      });
    }
    return Response.json({ id: b.id, result: { isError: true, structuredContent: { error: { code: "UNKNOWN_ACTION" } } } });
  },
});
const base = `http://127.0.0.1:${port}`;
const config = {
  origin: base,
  port,
  owners: {},
  auth_mode: "personal",
  personal: {
    name: "Test owner",
    username: "component-admin",
    role: "admin",
    password_hash_ref: privateDir + "/password",
    scope_ids: ["test"],
  },
  connections: [
    {
      id: "e",
      owner: "eikona",
      instance_id: "isolated",
      label: "Eikona test",
      environment: "test",
      project: "p",
      endpoint: `http://127.0.0.1:${mock.port}/mcp`,
      credential_ref: privateDir + "/observer",
      enabled: true,
      allow_private_http: true,
      allow_content: true,
    },
    {
      id: "e-content-off",
      owner: "eikona",
      instance_id: "isolated",
      label: "Eikona content disabled",
      environment: "test",
      project: "p",
      endpoint: `http://127.0.0.1:${mock.port}/mcp-off`,
      credential_ref: privateDir + "/observer",
      enabled: true,
      allow_private_http: true,
      allow_content: false,
    },
    {
      id: "e-owner-denied",
      owner: "eikona",
      instance_id: "isolated",
      label: "Eikona owner denied",
      environment: "test",
      project: "p",
      endpoint: `http://127.0.0.1:${mock.port}/mcp-denied`,
      credential_ref: privateDir + "/observer",
      enabled: true,
      allow_private_http: true,
      allow_content: true,
    },
    ...(["sonora", "scaena"] as const).map((owner) => ({
      id: owner,
      owner,
      allow_cancel: owner === "sonora",
      studio_origin: owner === "scaena" ? "http://127.0.0.1:16920" : undefined,
      instance_id: "isolated",
      label: owner + " test",
      environment: "test",
      project: "p",
      endpoint: `http://127.0.0.1:${mock.port}/mcp`,
      credential_ref: privateDir + "/observer",
      enabled: true,
      allow_private_http: true,
      allow_content: true,
    })),
  ],
  principals: [
    {
      issuer: "config",
      subject: "test",
      name: "Test owner",
      scopes: [
        {
          id: "test",
          tenant: "personal",
          team: "",
          project: "p",
          connection_ids: ["e", "e-content-off", "e-owner-denied", "sonora", "scaena"],
          label: "Test",
          owners: {},
        },
      ],
    },
  ],
};
await fs.writeFile(privateDir + "/config", JSON.stringify(config), {
  mode: 0o600,
});
const server = spawn("bun", [release ? path.join(release, "server.mjs") : "server/index.ts"], {
  cwd: release || process.cwd(),
  env: { ...process.env, YEISME_CONTROL_CONFIG: privateDir + "/config" },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page: Awaited<ReturnType<NonNullable<typeof browser>["newPage"]>> | undefined;
const results: { name: string; status: string }[] = [];
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("server_start_timeout")),
      10000,
    );
    server.stdout.on("data", (b) => {
      if (String(b).includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once("exit", () => {
      clearTimeout(timer);
      reject(Error("server_exited"));
    });
  });
  const executablePath = process.env.CHROME_PATH || (await fs.access("/usr/bin/google-chrome").then(() => "/usr/bin/google-chrome").catch(() => undefined));
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox"],
  });
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const mediaRequests: string[] = [];
  const accessRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/api/control-center/v1/media/")) mediaRequests.push(parsed.pathname);
    if (request.method() === "POST" && parsed.pathname.includes("/artifacts/") && parsed.pathname.endsWith("/access")) accessRequests.push(parsed.pathname);
  });
  const scriptErrors: string[] = [];
  const networkFailures: { method: string; status: number }[] = [];
  page.on("response", response => { if (response.status() >= 400) networkFailures.push({ method: response.request().method(), status: response.status() }); });
  page.on("pageerror", (e) => scriptErrors.push(e.name));
  await page.addInitScript(() => {
    const state = { requested: 0, shown: [] as string[], closed: 0 };
    (window as any).__notifications = state;
    class FakeNotification {
      static permission = "default";
      static async requestPermission() {
        state.requested++;
        this.permission = "granted";
        return "granted";
      }
      onclose?: () => void;
      onclick?: () => void;
      constructor(title: string, options: any) {
        state.shown.push(JSON.stringify({ title, body: options.body }));
      }
      close() {
        state.closed++;
        this.onclose?.();
      }
    }
    Object.defineProperty(window, "Notification", {
      value: FakeNotification,
      configurable: true,
    });
  });
  await page.goto(base + "/#/tasks");
  await page.getByLabel("用户名", { exact: true }).fill("component-admin");
  await page.getByLabel(/个人访问密码|管理员分发的访问 Key/).fill(password);
  await page.getByRole("button", { name: "登录个人工作区" }).click();
  await expect(
    page.getByRole("button", { name: "隔离任务", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  results.push({
    name: "login and automatic discovery beyond empty page",
    status: "passed",
  });
  if (
    (await page.evaluate(() => (window as any).__notifications.requested)) !== 0
  )
    throw Error("notification_without_intent");
  await page.getByRole("button", { name: "开启系统通知", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "关闭系统通知", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "隔离任务", exact: true }).click();
  phase = "running";
  await expect(page.getByRole("dialog")).toContainText("执行中", {
    timeout: 5000,
  });
  await page.keyboard.press("Escape");
  phase = "succeeded";
  await page.getByRole("button", { name: "刷新观察", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__notifications.shown.length),
    )
    .toBeGreaterThan(0);
  await page.getByRole("tab", { name: "任务历史与结果", exact: true }).click();
  await page.getByRole("button", { name: "隔离任务", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("已完成", {
    timeout: 5000,
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__notifications.shown.length),
    )
    .toBeGreaterThan(0);
  if (
    await page.evaluate(() =>
      (window as any).__notifications.shown.some(
        (s: string) => s.includes("隔离任务") || s.includes("eikona://"),
      ),
    )
  )
    throw Error("notification_sensitive_content");
  await page.getByRole("tab", { name: /^结果（/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Test result");
  await page.getByRole("tab", { name: "执行与证据", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("已受理");
  await expect(page.getByText("事件历史存在缺口或尚未记录", { exact: false })).toHaveCount(0);

  await page.getByRole("tab", { name: /^结果（/ }).click();

  results.push({
    name: "original task state changes without resubmission",
    status: "passed",
  });
  await page.getByRole("button", { name: "预览", exact: true }).first().click();
  const image = page.getByRole("dialog").locator("img");
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0),
    )
    .toBe(true);
  const src = await image.getAttribute("src");
  if (!src?.startsWith("/api/control-center/v1/media/"))
    throw Error("upstream_url_leaked");
  results.push({
    name: "controlled image bytes behind session media handle",
    status: "passed",
  });
  await page.screenshot({ path: run + "/artifacts/task-result.png" });
  await page.keyboard.press("Escape");
  const videoCard = page.locator(".task-artifact-card").filter({ hasText: "Test video" });
  await expect(videoCard.getByRole("button", { name: "预览", exact: true })).toBeFocused().catch(() => {});
  await videoCard.getByRole("button", { name: "预览", exact: true }).click();
  const video = page.locator("[data-task-preview] video");
  await expect(video).toBeInViewport();
  await expect(video).toHaveAttribute("controls", "");
  await expect(video).toHaveAttribute("preload", "metadata");
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState >= 2 && el.videoWidth === 64 && !el.autoplay && el.paused)).toBe(true);
  await video.evaluate((el: HTMLVideoElement) => { el.currentTime = 0.5; });
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => Math.abs(el.currentTime - 0.5) < 0.1 && !el.seeking)).toBe(true);
  await page.screenshot({ path: run + "/artifacts/video-preview.png" });
  const videoSrc = await video.getAttribute("src");
  if (!videoSrc?.startsWith("/api/control-center/v1/media/")) throw Error("video_media_handle_missing");
  if (videoSrc.includes("?t=") || videoSrc.includes("signature") || videoSrc.includes("credential")) throw Error("video_sensitive_url_leaked");
  await expect.poll(() => mediaRequests.some((url) => url.includes("/api/control-center/v1/media/"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(videoCard.getByRole("button", { name: "预览", exact: true })).toBeFocused();
  const notifications = await page.evaluate(() => {
    if (!("__notifications" in window)) return [];
    const value = window.__notifications;
    if (!value || typeof value !== "object" || !("shown" in value) || !Array.isArray(value.shown)) return [];
    return value.shown.filter((item): item is string => typeof item === "string");
  });
  if (notifications.some((item) => /eikona:\/\/|browser-original|signature|credential|Authorization/i.test(item))) throw Error("notification_sensitive_content");
  results.push({ name: "video/mp4 preview uses same-origin media handle and omits sensitive URLs", status: "passed" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "关闭系统通知", exact: true }).click();
  await expect(page.getByRole("button", { name: "开启系统通知", exact: true })).toBeVisible();
  results.push({
    name: "notifications require explicit opt-in and omit task content (browser API stub)",
    status: "passed",
  });
  await page.goto(base + "/#/tasks?connection=e-content-off&project=p&family=run&ref=browser-content-off");
  await expect(page.getByRole("dialog")).toContainText("本地内容关闭任务");
  const disabledAccessCount = accessRequests.length;
  await page.getByRole("tab", { name: /^结果（/ }).click();
  await expect(page.getByRole("dialog")).toContainText("本地未开启内容读取");
  await expect(page.getByRole("button", { name: "预览", exact: true }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "预览", exact: true }).nth(1)).toBeDisabled();
  await expect(page.getByRole("button", { name: "下载结果", exact: true }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "下载结果", exact: true }).nth(1)).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.goto(base + "/#/tasks?connection=e-owner-denied&project=p&family=run&ref=browser-owner-denied");
  await expect(page.getByRole("dialog")).toContainText("来源内容拒绝任务");
  await expect(page.getByRole("dialog")).toContainText("已完成");
  await page.getByRole("tab", { name: /^结果（/ }).click();
  await expect(page.getByRole("button", { name: "预览", exact: true }).first()).toBeEnabled();
  await page.getByRole("button", { name: "预览", exact: true }).first().click();
  await expect(page.getByRole("alert")).toBeVisible();
  const observed = await page.request.get(base + "/api/control-center/v1/connections?scope=test");
  const observation = await observed.json();
  expect(observation.connections.find((connection: { id: string }) => connection.id === "e-owner-denied")).toMatchObject({ state: "ready", runtime: { authorization: "verified", content: "denied" } });
  await page.getByRole("button", { name: "关闭预览", exact: true }).click();
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.getByRole("button", { name: "刷新观察", exact: true }).click();
  await expect(page.getByRole("button", { name: "来源内容拒绝任务", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "来源内容拒绝任务", exact: true }).click();
  await page.getByRole("tab", { name: /^结果（/ }).click();
  await expect(page.getByRole("button", { name: "预览", exact: true }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "下载结果", exact: true }).first()).toBeDisabled();
  expect(accessRequests.length).toBe(disabledAccessCount + 1);
  await page.keyboard.press("Escape");
  await page.goto(base + "/#/tasks");
  await page.getByRole("tab", { name: "任务历史与结果", exact: true }).click();
  results.push({ name: "local content disabled preserves task rows and blocks preview/download", status: "passed" });
  results.push({ name: "owner content denial preserves ready task state and reports denied content", status: "passed" });
  for (const [title, button, tag] of [
    ["隔离音频", "预览", "audio"],
    ["隔离片场结果", "预览", "img"],
  ]) {
    await page.getByRole("button", { name: title, exact: true }).click();
    if (title === "隔离片场结果") {
      const work = page.getByRole("link", { name: "返回作品（新标签页）" });
      await expect(work).toHaveAttribute(
        "href",
        "http://127.0.0.1:16920/#/work?project=p&episode=e",
      );
      await expect(work).toHaveAttribute("rel", "noopener noreferrer");
    }
    await page.getByRole("tab", { name: /^结果（/ }).click();
    await page.getByRole("button", { name: button, exact: true }).click();
    const media = page.getByRole("dialog").locator(tag);
    await expect(media).toBeVisible();
    await expect
      .poll(() =>
        media.evaluate((el: any) =>
          el.tagName === "IMG"
            ? el.complete && el.naturalWidth > 0
            : el.readyState >= 1,
        ),
      )
      .toBe(true);
    if (
      !(await media.getAttribute("src"))?.startsWith(
        "/api/control-center/v1/media/",
      )
    )
      throw Error("media_url_leaked");
    await page.screenshot({
      path: run + "/artifacts/" + tag + "-owner-result.png",
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: button, exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
  }
  results.push({
    name: "Sonora audio and Scaena media via task-scoped grants without leaking upstream credentials",
    status: "passed",
  });
  await page
    .getByRole("button", { name: "隔离可取消任务", exact: true })
    .click();
  await page.getByRole("button", { name: "请求取消", exact: true }).click();
  cancelRevision = "changed-after-confirmation";
  const refreshed = page.waitForResponse(
    async (r) =>
      r.request().method() === "GET" &&
      r.url().includes("/tasks/") &&
      !r.url().includes("/events") &&
      (await r
        .text()
        .then((text) => text.includes("changed-after-confirmation"))),
  );
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await refreshed;
  await page.getByRole("button", { name: "确认取消", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "任务版本已变化，未取消",
  );
  if (cancelCalls !== 0) throw new Error("confirmation_revision_drifted");
  await page.keyboard.press("Escape");
  results.push({
    name: "confirmation pins revision despite background detail refresh",
    status: "passed",
  });
  let dropped = false;
  await page.route(
    "**/api/control-center/v1/tasks/*/cancel?*",
    async (route) => {
      if (route.request().method() === "POST" && !dropped) {
        dropped = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page
    .getByRole("button", { name: "隔离可取消任务", exact: true })
    .click();
  await page.getByRole("button", { name: "请求取消", exact: true }).click();
  await page.getByRole("button", { name: "确认取消", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "查询原取消回执", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "隔离可取消任务", exact: true })
    .click();
  cancelOutcome = "unknown";
  await page
    .getByRole("button", { name: "查询原取消回执", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("禁止自动重发");
  await expect(
    page.getByRole("button", { name: "请求取消", exact: true }),
  ).toBeDisabled();
  cancelOutcome = "requested";
  await page
    .getByRole("button", { name: "查询原取消回执", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("取消请求已受理");
  await expect(
    page.getByRole("button", { name: "请求取消", exact: true }),
  ).toBeDisabled();
  cancelOutcome = "cancelled";
  await page
    .getByRole("button", { name: "查询原取消回执", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("已取消");
  await expect(
    page.getByRole("button", { name: "查询原取消回执", exact: true }),
  ).toHaveCount(0);
  if (cancelCalls !== 1) throw Error("cancel_resubmitted_after_unknown_reply");
  await page.keyboard.press("Escape");
  results.push({
    name: "cancel reply loss survives reload and queries one original receipt without resubmission",
    status: "passed",
  });
  await page.goto(
    base +
      "/#/tasks?connection=scaena&project=p&family=delegation&ref=media-original",
  );
  await expect(page.getByRole("dialog")).toContainText("隔离片场结果");
  await page.keyboard.press("Escape");
  await page.goto(
    base +
      "/#/tasks?connection=scaena&project=other&family=delegation&ref=media-original",
  );
  await expect(page.getByRole("alert")).toContainText("task_not_found");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto(base + "/#/tasks");
  results.push({
    name: "deep links reauthorize exact task scope and return only to configured Studio origin",
    status: "passed",
  });
  await page.getByLabel("任务 / 项目引用", { exact: true }).fill("隔离音频");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("隔离音频");
  await page.getByLabel("任务状态", { exact: true }).selectOption("succeeded");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.goto(base + "/#/overview");
  await expect(
    page.getByRole("region", { name: "现在需要处理" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "核心服务接入" }),
  ).toBeVisible();
  results.push({
    name: "authorized batch filters and action-first overview",
    status: "passed",
  });
  await page.goto(base + "/#/services");
  await expect(page.getByRole("heading", { name: "服务与连接", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "搜索服务、用途或 owner" }).fill("Eikona");
  const serviceRow = page.locator("tbody tr").filter({ hasText: "Eikona" });
  await serviceRow.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("Eikona test");
  await expect(page.getByRole("dialog")).not.toContainText(privateDir);
  const directoryResponse = await page.request.get(base + "/api/control-center/v1/services?scope=test");
  expect(directoryResponse.status()).toBe(200);
  const directoryText = await directoryResponse.text();
  expect(directoryText).not.toContain("credential_ref");
  expect(directoryText).not.toContain("test-only-observer");
  await page.keyboard.press("Escape");
  await page.goto(base + "/#/assets");
  await expect(page.getByRole("heading", { name: "任务结果与资产引用", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "隔离片场结果", exact: true }).click();
  await expect(page.getByRole("tab", { name: /^结果（/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await page.goto(base + "/#/overview");
  results.push({ name: "named admin, scoped service directory and historical asset results", status: "passed" });
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 768)
      await expect
        .poll(() =>
          page
            .locator(".sidebar")
            .evaluate((e) => e.getBoundingClientRect().right),
        )
        .toBeLessThanOrEqual(1);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
      }, theme);
      await page.screenshot({
        path: `${run}/artifacts/layout-${width}-${theme}.png`,
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      if (overflow) throw Error("viewport_overflow_" + width);
    }
  }
  if (scriptErrors.length) throw Error("browser_script_errors");
  if (
    operations.some(
      (a) => !a.startsWith("control_center.") && a !== "artifact.access",
    )
  )
    throw Error("unsafe_action");
  results.push({
    name: "four layouts and no generation or script errors",
    status: "passed",
  });
} catch (e) {
  results.push({
    // Only synthetic fixture UI is captured; never serialize a grant or credential.
    name: e instanceof Error ? e.message : "component_failed",
    status: "failed",
  });
  await fs.appendFile(
    run + "/stderr.log",
    (e instanceof Error ? e.message : "component_failed") + "\n",
  );
  process.exitCode = 1;
  await page?.screenshot({ path: run + "/artifacts/failure.png" }).catch(() => {});
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await mock.stop(true);
  await fs.rm(privateDir, { recursive: true, force: true });
  await fs.writeFile(
    run + "/stdout.log",
    results.map((r) => r.status + " " + r.name).join("\n") + "\n",
  );
  await fs.writeFile(
    run + "/summary.json",
    JSON.stringify(
      {
        status: results.every((r) => r.status === "passed")
          ? "passed"
          : "failed",
        results,
        mcp_calls: calls,
        release: release || null,
        real_owner_processes: false,
        provider_calls: false,
      },
      null,
      2,
    ),
  );
  console.log("Component evidence: " + run);
}
