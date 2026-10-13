import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createServer as createHTTPServer } from "node:http";
import { chromium, expect } from "@playwright/test";
import { hashPassword } from "../server/password";
const root = path.resolve("../..");
const run = path.resolve(
  "temp/integration-test-runs/task-processes-" +
    new Date().toISOString().replace(/[:.]/g, "-"),
);
await fs.mkdir(run + "/artifacts", { recursive: true });
await fs.writeFile(
  run + "/command.txt",
  "bun scripts/verify-task-processes.ts\n",
);
await fs.writeFile(
  run + "/env.json",
  JSON.stringify({
    layer: "system",
    real_owner_processes: true,
    owner_test_binaries: true,
    real_persistence: true,
    fake_external_boundaries: true,
    paid_provider_calls: false,
  }),
);
await fs.writeFile(run + "/stdout.log", "");
await fs.writeFile(run + "/stderr.log", "");
const privateDir = await fs.mkdtemp("/tmp/task-owner-processes-");
const children: ChildProcess[] = [];
const childOutput = new Map<ChildProcess, string>();
const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1kAAAAASUVORK5CYII=",
  "base64",
);
const wav = Buffer.alloc(1644);
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
await fs.writeFile(privateDir + "/image.png", png);
let release!: () => void;
const gate = new Promise<void>((r) => (release = r));
const calls: Record<string, number> = { image: 0, audio: 0, delegation: 0 };
const fake = createHTTPServer(async (request, response) => {
  const kind =
    request.url === "/audio"
      ? "audio"
      : request.url === "/delegation"
        ? "delegation"
        : "image";
  calls[kind]++;
  await gate;
  response.setHeader(
    "Content-Type",
    kind === "audio" ? "audio/wav" : "application/json",
  );
  response.end(
    kind === "audio"
      ? wav
      : kind === "delegation"
        ? "complete"
        : JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }),
  );
});
await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
const fakePort = (fake.address() as { port: number }).port;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  CGO_ENABLED: "0",
  GOFLAGS: "",
};
delete env.TASK_OBSERVATION_FIXTURE_DIR;
function child(
  command: string,
  args: string[],
  cwd: string,
  extra: Record<string, string> = {},
) {
  const c = spawn(command, args, {
    cwd,
    env: { ...env, ...extra },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(c);
  childOutput.set(c, "");
  for (const stream of [c.stdout, c.stderr])
    stream?.on("data", (b) =>
      childOutput.set(c, (childOutput.get(c) + String(b)).slice(-4000)),
    );
  return c;
}
async function build(owner: string, pkg: string, binary: string) {
  const c = child("go", ["test", "-c", "-o", binary, pkg], root + "/" + owner);
  const code = await new Promise<number>((r) => {
    c.once("error", () => r(127));
    c.once("exit", (n) => r(n ?? 1));
  });
  if (code !== 0) throw new Error("owner_fixture_build_failed_" + owner);
}
const owners = [
  { name: "eikona", cwd: "cli/eikona", pkg: "./internal/api" },
  { name: "sonora", cwd: "cli/sonora", pkg: "./internal/api" },
  {
    name: "scaena",
    cwd: "agent/scaena",
    pkg: "./internal/productionbackend/app",
  },
];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const results: string[] = [];
try {
  const video = child(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=gray:s=64x64:r=10:d=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      privateDir + "/video.mp4",
    ],
    process.cwd(),
  );
  const videoCode = await new Promise<number>((resolve) => {
    video.once("error", () => resolve(127));
    video.once("exit", (code) => resolve(code ?? 1));
  });
  if (videoCode !== 0) throw new Error("video_fixture_generation_failed");
  const settings = [];
  for (const owner of owners) {
    const dir = privateDir + "/" + owner.name;
    await fs.mkdir(dir, { mode: 0o700 });
    const binary = dir + "/fixture";
    await build(owner.cwd, owner.pkg, binary);
    const port = await freePort();
    const c = child(
      binary,
      ["-test.run=^TestTaskObservationProcessFixture$", "-test.timeout=180s"],
      root + "/" + owner.cwd,
      {
        TASK_OBSERVATION_FIXTURE_DIR: dir,
        TASK_OBSERVATION_FIXTURE_PORT: String(port),
        TASK_OBSERVATION_FIXTURE_PROVIDER: `http://127.0.0.1:${fakePort}`,
        TASK_OBSERVATION_FIXTURE_IMAGE: privateDir + "/image.png",
        TASK_OBSERVATION_FIXTURE_VIDEO: privateDir + "/video.mp4",
      },
    );
    await expect
      .poll(
        async () => {
          if (c.exitCode !== null)
            throw new Error("owner_fixture_exited_" + owner.name);
          return fs.access(dir + "/ready").then(
            () => true,
            () => false,
          );
        },
        { timeout: 30000 },
      )
      .toBe(true);
    const project =
      owner.name === "eikona"
        ? "p"
        : await fs.readFile(dir + "/project", "utf8");
    settings.push({
      id: owner.name,
      owner: owner.name,
      instance_id: "process-" + owner.name,
      label: owner.name,
      environment: "isolated",
      project,
      endpoint: `http://127.0.0.1:${port}/mcp`,
      credential_ref: dir + "/observer",
      enabled: true,
      allow_private_http: true,
      allow_content: true,
      allow_cancel: true,
      child: c,
      dir,
    });
  }
  const password = "process-browser-test";
  await fs.writeFile(privateDir + "/password", await hashPassword(password), {
    mode: 0o600,
  });
  const port = await freePort(),
    origin = `http://127.0.0.1:${port}`;
  await fs.writeFile(
    privateDir + "/config",
    JSON.stringify({
      origin,
      port,
      auth_mode: "personal",
      personal: {
        name: "process",
        role: "admin",
        password_hash_ref: privateDir + "/password",
        scope_ids: ["test"],
      },
      owners: {},
      connections: settings.map(({ child: _child, dir: _dir, ...c }) => c),
      principals: [
        {
          issuer: "config",
          subject: "process",
          name: "process",
          scopes: [
            {
              id: "test",
              tenant: "personal",
              team: "",
              project: "p",
              label: "Isolated",
              connection_ids: owners.map((o) => o.name),
              owners: {},
            },
          ],
        },
      ],
    }),
    { mode: 0o600 },
  );
  const center = child("bun", ["server/index.ts"], process.cwd(), {
    YEISME_CONTROL_CONFIG: privateDir + "/config",
  });
  await expect
    .poll(() => childOutput.get(center)?.includes("listening"), {
      timeout: 10000,
    })
    .toBe(true);
  const e = settings[0],
    executor = await fs.readFile(e.dir + "/executor", "utf8");
  if (!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(e.endpoint))
    throw new Error("fixture_endpoint_denied");
  const submit = await fetch(e.endpoint, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    method: "POST",
    headers: {
      Authorization: "Bearer " + executor,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "eikona.execute",
        arguments: {
          action: "generate",
          args: {
            run_id: "process-image",
            project_id: "p",
            model: "openai/gpt-5.4-image-2",
            prompt: "synthetic process fixture",
            size: "1024x1024",
            execution_mode: "background",
          },
        },
      },
    }),
  });
  const submitted = await submit.json();
  if (!submit.ok || submitted.result?.isError)
    throw new Error("MCP_submission_failed");
  for (const s of settings)
    s.child.stdin?.write(JSON.stringify("execute") + "\n");
  await expect
    .poll(() => Object.values(calls).every((n) => n > 0), { timeout: 15000 })
    .toBe(true);
  browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(origin + "/#/tasks");
  await page.getByLabel("个人访问密码").fill(password);
  await page.getByRole("button", { name: "登录个人工作区" }).click();
  await expect(
    page.getByRole("button", { name: "刷新观察", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  const observed = await page.request.get(origin + "/api/control-center/v1/services?scope=test&observe=1");
  if (!observed.ok()) throw Error("service_observation_failed");
  const directory = await observed.json();
  for (const owner of owners) {
    const service = directory.services.find((s: any) => s.id === owner.name);
    if (service?.connections.length !== 1 || service.connections[0].runtime?.state !== "ready")
      throw Error("service_contract_not_verified_" + owner.name);
  }
  results.push("three real owner capability contracts and scoped list authorization are projected through the service directory");
  const snapshots = async () => {
    const response = await page.request.get(
      origin + "/api/control-center/v1/tasks?scope=test&mode=history",
    );
    const p = await response.json();
    if (!response.ok()) throw new Error("task_list_failed");
    const rows = [...p.rows];
    let cursors = p.next_cursors;
    for (let i = 0; Object.keys(cursors).length && i < 10; i++) {
      const next = await (
        await page.request.get(
          origin +
            "/api/control-center/v1/tasks?scope=test&mode=history&cursors=" +
            encodeURIComponent(JSON.stringify(cursors)),
        )
      ).json();
      rows.push(...next.rows);
      cursors = next.next_cursors;
    }
    if (Object.keys(cursors).length)
      throw new Error("fixture_pagination_limit");
    return rows;
  };
  let initial: any[] = [];
  await expect
    .poll(
      async () => {
        initial = await snapshots();
        return owners.every((o) =>
          initial.some(
            (t) =>
              t.locator.owner === o.name &&
              !["succeeded", "completed"].includes(t.state) &&
              t.locator.task_ref !== "process-cancel" &&
              t.locator.task_family !== "local-job",
          ),
        );
      },
      { timeout: 10000 },
    )
    .toBe(true);
  results.push(
    "three independent owner processes expose persisted in-flight tasks while external boundaries block",
  );
  const before = { ...calls };
  await snapshots();
  await snapshots();
  if (JSON.stringify(before) !== JSON.stringify(calls))
    throw new Error("observation_advanced_provider");
  const identities = initial
    .filter(
      (t) =>
        t.locator.task_family !== "tts-result" &&
        t.locator.task_family !== "local-job" &&
        t.locator.task_ref !== "process-cancel" &&
        !["succeeded", "completed"].includes(t.state),
    )
    .map((t) => [t.locator.owner, t.locator.task_ref]);
  if (
    !owners.every((owner) => identities.some(([name]) => name === owner.name))
  )
    throw new Error("missing_original_identity");
  release();
  let completed: any[] = [];
  await expect
    .poll(
      async () => {
        completed = await snapshots();
        return identities.every(([owner, ref]) =>
          completed.some(
            (t) =>
              t.locator.owner === owner &&
              t.locator.task_ref === ref &&
              ["succeeded", "completed"].includes(t.state) &&
              t.results.length,
          ),
        );
      },
      { timeout: 20000 },
    )
    .toBe(true);
  results.push(
    "original persisted identities complete without observation resubmission",
  );
  await page.getByRole("tab", { name: "任务历史与结果", exact: true }).click();
  for (const target of [
    { owner: "eikona", family: "run", tag: "img" },
    { owner: "sonora", family: "voice-render-job", tag: "audio" },
    { owner: "scaena", family: "delegation", tag: "img" },
    { owner: "scaena", family: "run", tag: "video" },
  ]) {
    const owner = { name: target.owner };
    const task = completed.find(
      (t) =>
        t.locator.owner === owner.name &&
        t.locator.task_family === target.family &&
        t.results.length,
    );
    if (!task) throw new Error("media_task_missing_" + target.family);
    await page
      .locator("tr")
      .filter({ hasText: task.locator.task_ref })
      .getByRole("button", { name: task.title, exact: true })
      .click();
    await page.getByRole("tab", { name: "结果", exact: true }).click();
    await page
      .getByRole("button", {
        name:
          owner.name === "sonora"
            ? "试听音频"
            : owner.name === "eikona"
              ? "查看图片"
              : "查看媒体",
        exact: true,
      })
      .first()
      .click();
    const media = page.getByRole("dialog").locator(target.tag).first();
    await expect(media).toBeVisible();
    await expect
      .poll(
        () =>
          media.evaluate((el: any) =>
            el.tagName === "IMG"
              ? el.complete && el.naturalWidth > 0
              : el.readyState >= 1,
          ),
        { timeout: 10000 },
      )
      .toBe(true);
    if (
      !(await media.getAttribute("src"))?.startsWith(
        "/api/control-center/v1/media/",
      )
    )
      throw new Error("upstream_media_leaked");
    const mediaURL = await media.getAttribute("src");
    if (target.tag === "video") {
      await expect
        .poll(
          () =>
            media.evaluate(
              (el: HTMLVideoElement) =>
                el.videoWidth === 64 &&
                el.readyState >= 2 &&
                !el.autoplay &&
                el.paused,
            ),
          { timeout: 10000 },
        )
        .toBe(true);
      await media.evaluate((el: HTMLVideoElement) => {
        el.currentTime = 0.5;
      });
      await expect
        .poll(
          () =>
            media.evaluate(
              (el: HTMLVideoElement) =>
                Math.abs(el.currentTime - 0.5) < 0.1 && !el.seeking,
            ),
          { timeout: 10000 },
        )
        .toBe(true);
      const ranged = await page.request.get(origin + mediaURL, {
        headers: { Range: "bytes=0-15" },
      });
      if (ranged.status() !== 206 || (await ranged.body()).length !== 16)
        throw new Error("video_range_failed");
      const head = await page.request.head(origin + mediaURL, {
        headers: { Range: "bytes=0-15" },
      });
      if (head.status() !== 206 || head.headers()["content-length"] !== "16")
        throw new Error("video_head_failed");
    }
    await page.screenshot({
      path:
        run + "/artifacts/" + owner.name + "-" + target.family + "-result.png",
    });
    await page.keyboard.press("Escape");
  }
  results.push(
    "browser reads three owners including canonical Scaena run video through authenticated task media bridge",
  );
  const session = await (
    await page.request.get(origin + "/api/control-center/v1/session")
  ).json();
  // A second queued image never enters the fake provider; the other owners
  // seed cancellable work using their own application/repository fixture APIs.
  const cancelSubmit = await fetch(e.endpoint, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    method: "POST",
    headers: {
      Authorization: "Bearer " + executor,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "eikona.execute",
        arguments: {
          action: "generate",
          args: {
            run_id: "process-cancel",
            project_id: "p",
            model: "openai/gpt-5.4-image-2",
            prompt: "synthetic queued cancellation",
            size: "1024x1024",
            execution_mode: "background",
          },
        },
      },
    }),
  });
  if ((await cancelSubmit.json()).result?.isError)
    throw new Error("cancel_fixture_submit_failed");
  const cancellationReceipts: {
    owner: string;
    ref: string;
    key: string;
    receipt: string;
    taskKey: string;
  }[] = [];
  for (const setting of settings) {
    const ref =
      setting.owner === "eikona"
        ? "process-cancel"
        : await fs.readFile(setting.dir + "/cancel-task", "utf8");
    const task = (await snapshots()).find(
      (t) => t.locator.owner === setting.owner && t.locator.task_ref === ref,
    );
    if (!task) throw new Error("cancellable_task_missing_" + setting.owner);
    const key = "cancel-process-" + setting.owner,
      endpoint =
        origin +
        "/api/control-center/v1/tasks/" +
        encodeURIComponent(task.task_key);
    const denied = await page.request.post(endpoint + "/cancel?scope=test", {
      data: {
        confirm: true,
        expected_revision: task.revision,
        idempotency_key: key,
      },
    });
    if (denied.status() !== 403) throw new Error("cancel_csrf_bypass");
    const response = await page.request.post(endpoint + "/cancel?scope=test", {
      headers: { Origin: origin, "X-CSRF-Token": session.csrf },
      data: {
        confirm: true,
        expected_revision: task.revision,
        idempotency_key: key,
      },
    });
    const result = await response.json();
    if (!response.ok() || result.receipt?.outcome !== "cancelled")
      throw new Error("owner_cancel_failed_" + setting.owner);
    const receipt = await (
      await page.request.get(
        endpoint + "/cancel-receipt?scope=test&idempotency_key=" + key,
      )
    ).json();
    if (receipt.receipt?.ref !== result.receipt.ref)
      throw new Error("owner_receipt_changed");
    cancellationReceipts.push({
      owner: setting.owner,
      ref,
      key,
      receipt: result.receipt.ref,
      taskKey: task.task_key,
    });
  }
  results.push(
    "three owner cancellation receipts and CSRF denial via authenticated control-center API",
  );
  const centerStopped = new Promise<void>((resolve) =>
    center.once("exit", () => resolve()),
  );
  center.kill("SIGTERM");
  await centerStopped;
  const restoredCenter = child("bun", ["server/index.ts"], process.cwd(), {
    YEISME_CONTROL_CONFIG: privateDir + "/config",
  });
  await expect
    .poll(() => childOutput.get(restoredCenter)?.includes("listening"), {
      timeout: 10000,
    })
    .toBe(true);
  const staleSession = await page.request.get(
    origin + "/api/control-center/v1/session",
  );
  if (staleSession.status() !== 401)
    throw new Error("restart_retained_session");
  await page.reload();
  await page.getByLabel("个人访问密码").fill(password);
  await page.getByRole("button", { name: "登录个人工作区" }).click();
  await expect(
    page.getByRole("button", { name: "刷新观察", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  const restoredTasks = await snapshots();
  for (const original of cancellationReceipts) {
    const task = restoredTasks.find(
      (t) =>
        t.locator.owner === original.owner &&
        t.locator.task_ref === original.ref,
    );
    if (!task || task.task_key === original.taskKey)
      throw new Error("restart_task_identity_failed");
    const receipt = await (
      await page.request.get(
        origin +
          "/api/control-center/v1/tasks/" +
          encodeURIComponent(task.task_key) +
          "/cancel-receipt?scope=test&idempotency_key=" +
          original.key,
      )
    ).json();
    if (receipt.receipt?.ref !== original.receipt)
      throw new Error("restart_receipt_lost");
  }
  results.push(
    "control-center restart invalidates sessions and task keys; re-login resolves original owner receipts without cancellation resubmission",
  );
  const restoredSession = await (
    await page.request.get(origin + "/api/control-center/v1/session")
  ).json();
  const originalImage = restoredTasks.find(
    (t) =>
      t.locator.owner === "eikona" && t.locator.task_ref === "process-image",
  );
  const grantResponse = await page.request.post(
    origin +
      "/api/control-center/v1/tasks/" +
      encodeURIComponent(originalImage.task_key) +
      "/artifacts/" +
      encodeURIComponent(originalImage.results[0].ref) +
      "/access?scope=test",
    {
      headers: { Origin: origin, "X-CSRF-Token": restoredSession.csrf },
      data: { purpose: "preview" },
    },
  );
  const mediaHandle = await grantResponse.json();
  if (!grantResponse.ok() || !mediaHandle.url)
    throw new Error("reauthorization_handle_missing");
  const originalObserver = await fs.readFile(e.dir + "/observer");
  await fs.writeFile(e.dir + "/observer", "invalid-isolated-observer", {
    mode: 0o600,
  });
  const invalidated = await page.request.get(origin + mediaHandle.url);
  if (invalidated.status() !== 403)
    throw new Error("old_handle_survived_credential_loss");
  await fs.writeFile(e.dir + "/observer", originalObserver, { mode: 0o600 });
  const stoppedReads = await page.request.get(origin + mediaHandle.url);
  if (stoppedReads.status() !== 403)
    throw new Error("denied_connection_silently_resumed");
  const sonora = settings.find((s) => s.owner === "sonora")!;
  const disconnected = new Promise<void>((resolve) =>
    sonora.child.once("exit", () => resolve()),
  );
  sonora.child.kill("SIGTERM");
  await disconnected;
  const isolated = await (
    await page.request.get(
      origin + "/api/control-center/v1/tasks?scope=test&mode=history",
    )
  ).json();
  if (
    !isolated.connections.some(
      (c: any) => c.owner === "eikona" && c.state === "needs_authorization",
    ) ||
    !isolated.connections.some(
      (c: any) => c.owner === "sonora" && c.state !== "ready",
    ) ||
    !isolated.connections.some(
      (c: any) => c.owner === "scaena" && c.state === "ready",
    )
  )
    throw new Error("source_failure_not_isolated");
  results.push(
    "credential loss rejects an existing media handle and stops that connection; disconnected Sonora does not hide readable Scaena",
  );
  if (calls.image !== 1 || calls.audio !== 6 || calls.delegation !== 1)
    throw new Error("unexpected_external_repetition");
  results.push("no paid providers, no metadata-triggered external calls");
} catch (e) {
  process.exitCode = 1;
  await fs.writeFile(
    run + "/stderr.log",
    (e instanceof Error ? e.message : "system_failed") + "\n",
  );
} finally {
  release();
  await browser?.close();
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  await Promise.all(
    children
      .filter((c) => c.exitCode === null)
      .map(
        (c) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              c.kill("SIGKILL");
              resolve();
            }, 2000);
            c.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          }),
      ),
  );
  fake.closeAllConnections();
  await new Promise<void>((resolve) => fake.close(() => resolve()));
  await fs.rm(privateDir, { recursive: true, force: true });
  await fs.writeFile(run + "/stdout.log", results.join("\n") + "\n");
  await fs.writeFile(
    run + "/summary.json",
    JSON.stringify(
      {
        status: process.exitCode ? "failed" : "passed",
        results,
        real_owner_processes: true,
        owner_test_binaries: true,
        real_persistence: true,
        paid_provider_calls: false,
        fake_boundary_calls: calls,
        submission_entrypoints: {
          eikona: "MCP generate",
          sonora: "application ExecuteLanguageRender",
          scaena: "application CenterService.Delegate",
        },
        limitations: [
          "Sonora and Scaena generation submission uses owner application entry, not MCP generation actions",
          "Scaena uses a test principal authenticator; production key lifecycle is covered by separate owner tests",
          "processes run compiled owner test fixtures, not released daemon binaries",
          "daily services and credentials untouched",
        ],
      },
      null,
      2,
    ),
  );
  console.log("System evidence: " + run);
}
