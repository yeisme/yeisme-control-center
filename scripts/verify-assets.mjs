import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { expect } from "@playwright/test";

const stationId = "demo:eikona:station-v3";
const blobState = (p, url) =>
  p.evaluate((u) => fetch(u).then(() => "alive", () => "revoked"), url);
const pcmWav = (seconds = 1) => {
  const rate = 16000;
  const samples = rate * seconds;
  const pcm = Buffer.alloc(44 + samples * 2);
  pcm.write("RIFF");
  pcm.writeUInt32LE(pcm.length - 8, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(rate, 24);
  pcm.writeUInt32LE(rate * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    pcm.writeInt16LE(
      Math.round(Math.sin((i / rate) * 440 * Math.PI * 2) * 1000),
      44 + i * 2,
    );
  return pcm;
};
// Real playable bytes recorded in the browser; returns null when MediaRecorder is unavailable.
const recordWebm = (p) =>
  p.evaluate(async () => {
    if (typeof MediaRecorder === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext("2d");
    const recorder = new MediaRecorder(canvas.captureStream(10), {
      mimeType: "video/webm",
    });
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start();
    for (let i = 0; i < 8; i++) {
      context.fillStyle = `hsl(${i * 40},80%,50%)`;
      context.fillRect(0, 0, 64, 48);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    recorder.stop();
    await stopped;
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
// Selecting inserts a toolbar that shifts items, so double-click is unreliable on narrow screens.
const openAssetDetail = async (p, id) => {
  await p.locator(`[data-object-id="${id}"]`).click();
  await p.getByRole("button", { name: "查看详情", exact: true }).click();
  await expect(p.locator(".asset-detail")).toBeVisible();
};
const previewReady = (p) =>
  expect(p.locator(".asset-detail .media-stage")).toHaveAttribute(
    "data-state",
    "ready",
  );
const chooseLocal = async (p, name, mimeType, buffer) => {
  const chooser = p.waitForEvent("filechooser");
  const again = p.getByRole("button", { name: "选择其他文件" }).first();
  const open = p.getByRole("button", { name: "本地文件预览", exact: true });
  await ((await p.locator(".modal").count()) ? again : open).click();
  await (await chooser).setFiles({ name, mimeType, buffer });
};

export async function verifyAssets({ check, fresh, pick, nav, shot }) {
  await check(
    "Generation library: folder validation, dirty close, nested creation and duplicate names",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      await p.getByRole("button", { name: "新建目录", exact: true }).click();
      await p.getByRole("button", { name: "创建目录", exact: true }).click();
      const input = p.getByRole("textbox", { name: "目录名称", exact: true });
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toBeFocused();
      await input.fill("视觉与参考");
      await p.getByRole("button", { name: "创建目录", exact: true }).click();
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await input.fill("第一集候选");
      await p.getByRole("button", { name: "取消", exact: true }).click();
      await expect(p.getByRole("alertdialog")).toBeVisible();
      await p.getByRole("button", { name: "继续编辑", exact: true }).click();
      await expect(input).toHaveValue("第一集候选");
      await pick(p, "上级目录", "视觉与参考");
      await shot(p, "generation-folder-form");
      await p.getByRole("button", { name: "创建目录", exact: true }).click();
      await expect(p.getByRole("dialog")).toHaveCount(0);
      await expect(
        p
          .locator(".library-directory .folder-label")
          .filter({ hasText: "第一集候选" }),
      ).toBeVisible();
      await ctx.close();
    },
  );
  await check(
    "Generation library: intersecting filters, removable chips and empty recovery",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      await pick(p, "资产类型", "图像");
      await p.locator('[data-od-id="advanced-asset-filters"]').click();
      await pick(p, "生成来源", "Eikona");
      await pick(p, "产物状态", "待审阅");
      await p.getByRole("button", { name: "完成", exact: true }).click();
      await expect(
        p.getByRole("listbox", { name: "资产浏览器" }).getByRole("option"),
      ).toHaveCount(1);
      await p
        .getByRole("textbox", { name: "搜索资产", exact: true })
        .fill("没有此产物");
      await expect(
        p.getByRole("listbox", { name: "资产浏览器" }).getByRole("option"),
      ).toHaveCount(0);
      await p.getByRole("button", { name: "清除全部", exact: true }).click();
      await expect(
        p.getByRole("listbox", { name: "资产浏览器" }).getByRole("option"),
      ).toHaveCount(4);
      await ctx.close();
    },
  );
  await check(
    "Generation library: asset and directory drag, undo and cycle rejection",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      const image = p.locator('[data-object-id="demo:eikona:station-v3"]');
      await image.dragTo(p.locator('[data-od-id="folder-sound"]'));
      await p.locator('[data-od-id="folder-sound"] .folder-label').click();
      await expect(
        p.getByRole("listbox", { name: "资产浏览器" }).getByRole("option"),
      ).toHaveCount(2);
      await p.getByRole("button", { name: "撤销", exact: true }).click();
      await expect(
        p.getByRole("listbox", { name: "资产浏览器" }).getByRole("option"),
      ).toHaveCount(1);
      await p
        .locator('[data-od-id="folder-visual"]')
        .dragTo(p.locator('[data-od-id="folder-writing"]'));
      await expect(
        p
          .locator('[data-od-id="folder-writing"]')
          .locator("..")
          .locator('[data-od-id="folder-visual"]'),
      ).toBeVisible();
      await p
        .locator('[data-od-id="folder-writing"]')
        .dragTo(p.locator('[data-od-id="folder-visual"]'));
      await expect(p.locator(".polished-toast")).toContainText("不能");
      await p.getByRole("button", { name: "撤销", exact: true }).click();
      await p.locator('[data-od-id="folder-visual"] .folder-label').click();
      await expect(
        p.getByRole("listbox", { name: "资产浏览器" }).getByRole("option"),
      ).toHaveCount(2);
      await ctx.close();
    },
  );
  await check(
    "Generation library: keyboard move alternative and preserved original identity",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      await p.locator('[data-object-id="demo:eikona:station-v3"]').click();
      await p.getByRole("button", { name: "移动到", exact: true }).click();
      await pick(p, "目标目录", "文稿与内容");
      await p.getByRole("button", { name: "确认移动", exact: true }).click();
      await p.locator('[data-od-id="folder-writing"] .folder-label').click();
      await expect(
        p.locator('[data-object-id="demo:eikona:station-v3"]'),
      ).toBeVisible();
      await p.locator('[data-object-id="demo:eikona:station-v3"]').dblclick();
      await expect(p.locator(".asset-detail")).toContainText("Eikona");
      await expect(p.locator(".asset-detail")).toContainText("文稿与内容");
      await expect(p.locator(".asset-detail")).toContainText(
        "demo:eikona:station-v3",
      );
      await ctx.close();
    },
  );
  await check(
    "Generation library: detail notes, dirty navigation, source and rights tabs",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      await p.locator('[data-object-id="demo:eikona:station-v3"]').dblclick();
      await p
        .locator(".asset-note-heading")
        .getByRole("button", { name: "编辑" })
        .click();
      await p
        .getByRole("textbox", { name: "产物备注", exact: true })
        .fill("片头视觉候选，等待美术确认");
      await p.getByRole("button", { name: "关闭详情", exact: true }).click();
      await expect(p.getByRole("alertdialog")).toBeVisible();
      await p.getByRole("button", { name: "继续编辑", exact: true }).click();
      await expect(
        p.getByRole("textbox", { name: "产物备注", exact: true }),
      ).toHaveValue("片头视觉候选，等待美术确认");
      await p.getByRole("button", { name: "保存备注", exact: true }).click();
      await expect(p.locator(".asset-note-body")).toContainText("片头视觉候选");
      await shot(p, "generation-asset-detail");
      await p.getByRole("tab", { name: "来源与版本", exact: true }).click();
      await expect(p.locator(".asset-detail")).toContainText(
        "当前固定版本 · v3",
      );
      await p.getByRole("tab", { name: "权利与交接", exact: true }).click();
      await expect(p.locator(".asset-detail")).toContainText("不可正式交付");
      await ctx.close();
    },
  );
  await check(
    "Generation library: notification read state and artifact deep link",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      await p.locator('[data-od-id="notification-center-trigger"]').click();
      await expect(p.locator(".notification-item")).toHaveCount(2);
      await p.getByRole("button", { name: "全部已读", exact: true }).click();
      await p.getByRole("tab", { name: /未读/ }).click();
      await expect(p.locator(".notification-item")).toHaveCount(0);
      await p.getByRole("tab", { name: /全部/ }).click();
      await shot(p, "generation-notifications");
      await p
        .getByRole("button", { name: "查看产物", exact: true })
        .first()
        .click();
      await expect(p.locator(".asset-detail")).toBeVisible();
      await expect(p.locator(".asset-detail")).toContainText(
        "demo:eikona:station-v3",
      );
      await ctx.close();
    },
  );
  await check(
    "Generation library: save failure retains draft and viewer cannot organize",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      await pick(p, "状态演练", "配置保存失败");
      await p.getByRole("button", { name: "新建目录", exact: true }).click();
      await p
        .getByRole("textbox", { name: "目录名称", exact: true })
        .fill("保留此草稿");
      await p.getByRole("button", { name: "创建目录", exact: true }).click();
      await expect(
        p.getByRole("textbox", { name: "目录名称", exact: true }),
      ).toHaveValue("保留此草稿");
      await expect(p.locator(".library-form-error")).toBeVisible();
      await p.getByRole("button", { name: "取消", exact: true }).click();
      await p.getByRole("button", { name: "放弃修改", exact: true }).click();
      await pick(p, "状态演练", "正常场景");
      await pick(p, "身份演练", "只读成员");
      await expect(
        p.getByRole("button", { name: "新建目录", exact: true }),
      ).toBeDisabled();
      await expect(p.locator('[data-od-id="folder-visual"]')).toHaveAttribute(
        "draggable",
        "false",
      );
      await ctx.close();
    },
  );
  await check(
    "Generation library: responsive light and dark surfaces preserve usable controls",
    async () => {
      for (const width of [1440, 1280, 768, 390])
        for (const theme of ["light", "dark"]) {
          const { p, ctx } = await fresh("#/assets");
          await p.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
          await p.evaluate(
            (theme) =>
              localStorage.setItem("yeisme-control-center.ui.theme", theme),
            theme,
          );
          await p.reload();
          await p.emulateMedia({ reducedMotion: "reduce" });
          await shot(p, `generation-${theme}-${width}`);
          assert.ok(
            await p.evaluate(() => document.body.scrollWidth <= innerWidth),
          );
          const overlap = await p.evaluate(() => {
            const controls = [
              ...document.querySelectorAll(
                ".header-actions > .notification-trigger,.header-actions > .theme-tool,.header-left > .header-search",
              ),
            ].map((e) => e.getBoundingClientRect());
            return controls.some((a, i) =>
              controls.some(
                (b, j) =>
                  i < j &&
                  a.left < b.right &&
                  b.left < a.right &&
                  a.top < b.bottom &&
                  b.top < a.bottom,
              ),
            );
          });
          assert.equal(overlap, false);
          await ctx.close();
        }
    },
  );
  await check(
    "Media preview: image reports real pixel size and keeps aspect ratio across fit, width and zoom",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      await openAssetDetail(p, stationId);
      await previewReady(p);
      await expect(p.locator(".asset-detail [data-media-metadata]")).toHaveText(
        /^\d+ × \d+ px$/,
      );
      const image = p.locator(".asset-detail .media-stage img");
      await p.getByLabel("图片适配方式").selectOption("width");
      const ratio = await image.evaluate((e) => ({
        actual: e.clientWidth / e.clientHeight,
        natural: e.naturalWidth / e.naturalHeight,
      }));
      assert.ok(Math.abs(ratio.actual - ratio.natural) < 0.02);
      await p.getByLabel("图片缩放比例").selectOption("1");
      assert.equal(
        await image.evaluate((e) => e.clientWidth === e.naturalWidth),
        true,
      );
      await p.getByLabel("图片缩放比例").selectOption("0.5");
      assert.equal(
        await image.evaluate(
          (e) => Math.abs(e.clientWidth - e.naturalWidth / 2) <= 1,
        ),
        true,
      );
      await p.getByRole("button", { name: "放大预览" }).click();
      assert.equal(await p.getByLabel("图片缩放比例").inputValue(), "0.75");
      await p.getByRole("button", { name: "缩小预览" }).click();
      assert.equal(await p.getByLabel("图片缩放比例").inputValue(), "0.5");
      await p.getByLabel("图片适配方式").selectOption("fit");
      assert.equal(
        await image.evaluate((e) => getComputedStyle(e).objectFit),
        "contain",
      );
      await p.getByRole("button", { name: "切换图片背景" }).click();
      await expect(p.locator(".asset-detail .media-stage")).toHaveAttribute(
        "data-background",
        "dark",
      );
      await shot(p, "media-preview-image");
      await ctx.close();
    },
  );
  await check(
    "Media preview: assets without bytes stay metadata-only with no simulated player",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      await openAssetDetail(p, "demo:sonora:coast-audio");
      assert.equal(
        await p
          .locator(".asset-detail audio, .asset-detail video, .asset-detail img")
          .count(),
        0,
      );
      await expect(p.locator(".asset-detail")).toContainText(
        "真实审听媒体尚未接入",
      );
      await expect(p.locator(".asset-detail")).toContainText("仅元数据");
      await shot(p, "media-preview-metadata-only");
      await ctx.close();
    },
  );
  await check(
    "Media preview: failed image read keeps the record and retries the same reference",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      let failures = 0;
      await p.route("**/media/rain-street.jpg", (route) => {
        failures++;
        return route.fulfill({ status: 404, body: "" });
      });
      await openAssetDetail(p, stationId);
      await expect(p.locator(".asset-detail .media-error")).toBeVisible();
      await expect(p.locator(".asset-detail")).toContainText("未能读取预览");
      await expect(p.locator(".asset-detail")).toContainText(stationId);
      await shot(p, "media-preview-read-error");
      await p.unroute("**/media/rain-street.jpg");
      await p.getByRole("button", { name: "重新读取预览" }).click();
      await previewReady(p);
      await expect(p.locator(".asset-detail .media-error")).toHaveCount(0);
      assert.ok(failures >= 1);
      await ctx.close();
    },
  );
  await check(
    "Media preview: local image and text previews stay in memory, escape markup and revoke URLs",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      const records = () => p.locator(".library-summary strong").first().innerText();
      const before = await records();
      const modal = p.locator(".modal");
      await chooseLocal(
        p,
        "local-test.jpg",
        "image/jpeg",
        await fs.readFile("public/media/rain-street.jpg"),
      );
      await expect(modal.locator(".media-stage")).toHaveAttribute(
        "data-state",
        "ready",
      );
      await expect(modal).toContainText("本地预览 · 未上传");
      const first = await modal.locator(".media-stage img").getAttribute("src");
      assert.match(first, /^blob:/);
      await shot(p, "media-preview-local-image");
      await chooseLocal(
        p,
        "local-note.txt",
        "text/plain",
        Buffer.from("<script>window.fileExecuted=true</script>\n仅供本地预览检查。"),
      );
      await expect(modal.locator(".text-preview")).toHaveText(
        "<script>window.fileExecuted=true</script>\n仅供本地预览检查。",
      );
      assert.equal(await p.evaluate(() => window.fileExecuted), undefined);
      assert.equal(await blobState(p, first), "revoked");
      const last = await modal
        .getByRole("link", { name: "下载本地副本" })
        .getAttribute("href");
      await p.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);
      assert.equal(await blobState(p, last), "revoked");
      assert.equal(await records(), before);
      const stored = await p.evaluate(
        () => JSON.stringify({ ...localStorage, ...sessionStorage }) + location.href,
      );
      for (const name of ["local-test.jpg", "local-note.txt"])
        assert.equal(stored.includes(name), false, name + " leaked");
      await ctx.close();
    },
  );
  await check(
    "Media preview: local audio and video play from browser-generated bytes without autoplay",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      const modal = p.locator(".modal");
      await chooseLocal(p, "local-tone.wav", "audio/wav", pcmWav());
      await expect(modal.locator(".media-stage")).toHaveAttribute(
        "data-state",
        "ready",
      );
      await expect(modal.locator("[data-media-metadata]")).toHaveText("0:01");
      assert.deepEqual(
        await modal.locator("audio").evaluate((a) => ({
          autoplay: a.autoplay,
          paused: a.paused,
          controls: a.controls,
        })),
        { autoplay: false, paused: true, controls: true },
      );
      const webm = await recordWebm(p);
      assert.ok(webm, "MediaRecorder fixture is required to verify video");
      await chooseLocal(p, "local-clip.webm", "video/webm", Buffer.from(webm));
      await expect(modal.locator(".media-stage")).toHaveAttribute(
        "data-state",
        "ready",
      );
      await expect(modal.locator("[data-media-metadata]")).toHaveText(
        /^64 × 48 · /,
      );
      assert.equal(await modal.locator("video").evaluate((v) => v.autoplay), false);
      await ctx.close();
    },
  );
  await check(
    "Media preview: unreadable, document and oversized local files are never embedded or persisted",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      const modal = p.locator(".modal");
      await chooseLocal(p, "broken.wav", "audio/wav", Buffer.from("not playable"));
      await expect(modal.locator(".media-error")).toBeVisible();
      await expect(modal).toContainText("未能读取预览");
      await shot(p, "media-preview-local-broken");
      await chooseLocal(
        p,
        "local-manual.pdf",
        "application/pdf",
        Buffer.from("%PDF-1.4 fake"),
      );
      assert.equal(
        await modal.locator("img,audio,video,iframe,embed,object").count(),
        0,
      );
      await expect(modal).toContainText("暂不支持内嵌预览");
      await expect(modal.getByRole("link", { name: "下载本地副本" })).toBeVisible();
      await chooseLocal(p, "big.txt", "text/plain", Buffer.alloc(512 * 1024 + 1, 97));
      await expect(modal).toContainText("文本超过 512 KB 预览限制");
      assert.equal(await modal.locator(".text-preview").count(), 0);
      await p.keyboard.press("Escape");
      const huge = path.join(os.tmpdir(), `control-center-huge-${process.pid}.mp4`);
      const handle = await fs.open(huge, "w");
      await handle.truncate(64 * 1024 * 1024 + 1);
      await handle.close();
      try {
        const chooser = p.waitForEvent("filechooser");
        await p.getByRole("button", { name: "本地文件预览", exact: true }).click();
        await (await chooser).setFiles(huge);
        await expect(p.getByText("本地预览支持不超过 64 MB 的文件。")).toBeVisible();
        await expect(modal).toHaveCount(0);
      } finally {
        await fs.rm(huge, { force: true });
      }
      const stored = await p.evaluate(
        () => JSON.stringify({ ...localStorage, ...sessionStorage }) + location.href,
      );
      for (const name of ["broken.wav", "local-manual.pdf", "big.txt", "huge"])
        assert.equal(stored.includes(name), false, name + " leaked");
      await ctx.close();
    },
  );
  await check(
    "Media preview: changing scope or page releases an open local preview",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      const modal = p.locator(".modal");
      const open = async () => {
        await chooseLocal(
          p,
          "scope.jpg",
          "image/jpeg",
          await fs.readFile("public/media/rain-street.jpg"),
        );
        await expect(modal.locator(".media-stage")).toHaveAttribute(
          "data-state",
          "ready",
        );
        return modal.locator(".media-stage img").getAttribute("src");
      };
      const scoped = await open();
      await p.evaluate(() => {
        location.hash = "#/assets?env=main&project=coast";
      });
      await expect(modal).toHaveCount(0);
      assert.equal(await blobState(p, scoped), "revoked");
      const paged = await open();
      await p.evaluate(() => {
        location.hash = "#/services";
      });
      await expect(modal).toHaveCount(0);
      assert.equal(await blobState(p, paged), "revoked");
      await ctx.close();
    },
  );
  await check(
    "Media preview: detail fits 390px with 44px touch targets and splits into two columns when expanded",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      await p.setViewportSize({ width: 390, height: 844 });
      await p.reload();
      await expect(p.locator(`[data-object-id="${stationId}"]`)).toBeVisible();
      await openAssetDetail(p, stationId);
      await previewReady(p);
      assert.ok(
        (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <=
          0,
      );
      for (const name of ["放大预览", "缩小预览"]) {
        const box = await p.getByRole("button", { name }).boundingBox();
        assert.ok(box.width >= 43.5 && box.height >= 43.5, name);
      }
      for (const label of ["图片适配方式", "图片缩放比例"])
        assert.ok((await p.getByLabel(label).boundingBox()).height >= 43.5, label);
      await shot(p, "media-preview-390");
      await p.setViewportSize({ width: 1440, height: 1000 });
      await p.getByRole("button", { name: "展开全屏详情" }).click();
      const columns = () =>
        p
          .locator(".asset-workspace-grid")
          .evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(" ").length);
      await expect.poll(columns).toBe(2);
      await shot(p, "media-preview-expanded");
      await p.getByRole("button", { name: "还原详情" }).click();
      await expect.poll(columns).toBe(1);
      await ctx.close();
    },
  );
}
