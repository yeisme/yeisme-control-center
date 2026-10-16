
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { expect } from "@playwright/test";

const contentStates = ["参考字节可预览", "有引用，无字节", "无内容读取权限", "来源未采集"];
const openAssetDetail = async (p, id) => {
  await p.locator('[data-object-id="' + id + '"]').click();
  await expect(p.locator(".asset-detail")).toBeVisible();
};
const closeDetail = async (p) => {
  const close = p.getByRole("button", { name: "关闭详情", exact: true });
  if (await close.isVisible()) await close.click();
};
const chooseLocal = async (p, name, mimeType, buffer) => {
  const chooser = p.waitForEvent("filechooser");
  await p.getByRole("button", { name: "本地文件预览", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType, buffer });
};

export async function verifyAssets({ check, fresh, shot }) {
  await check("v17 asset table shows production attribution fixtures", async () => {
    const { p, ctx } = await fresh("#/assets?env=main&project=all");
    await expect(p.getByRole("heading", { name: "资产与生产归因", exact: true })).toBeVisible();
    await expect(p.locator(".asset-data-table")).toHaveCount(1);
    await expect(p.locator(".asset-data-table tbody tr")).toHaveCount(4);
    for (const name of ["雨夜街道 · 图像候选", "雨夜环境音 · 引用", "受限候选 · 元数据", "历史视觉 · 固定引用"])
      await expect(p.locator(".asset-data-table")).toContainText(name);
    for (const label of ["生产者", "项目", "服务", "内容状态", "审阅", "日期"])
      await expect(p.locator(".asset-data-table thead")).toContainText(label);
    await expect(p.locator(".asset-data-table")).toContainText("参考字节可预览");
    await expect(p.locator(".asset-data-table")).toContainText("有引用，无字节");
    await expect(p.locator(".asset-data-table")).toContainText("无内容读取权限");
    await expect(p.locator(".asset-data-table")).toContainText("来源未采集");
    await shot(p, "v17-assets-table");
    await ctx.close();
  });

  await check("v17 asset filters, chips, empty recovery and column settings", async () => {
    const { p, ctx } = await fresh("#/assets?env=main&project=all");
    await p.getByRole("combobox", { name: "内容可用性", exact: true }).click();
    await p.getByRole("option", { name: "有引用，无字节", exact: true }).click();
    await expect(p.locator(".asset-data-table tbody tr")).toHaveCount(1);
    await expect(p.locator(".filter-chips")).toContainText("内容：有引用，无字节");
    await p.getByRole("combobox", { name: "生产用户", exact: true }).click();
    await p.getByRole("option", { name: "陈序", exact: true }).click();
    await expect(p.locator(".asset-data-table tbody tr")).toHaveCount(1);
    await p.getByRole("button", { name: "高级筛选", exact: false }).click();
    await expect(p.getByRole("heading", { name: "高级筛选", exact: true })).toBeVisible();
    await p.getByRole("combobox", { name: "项目", exact: true }).click();
    await p.getByRole("option", { name: "雨夜重逢", exact: true }).click();
    await p.getByRole("button", { name: "完成", exact: true }).click();
    await p.getByRole("button", { name: "显示列", exact: true }).click();
    await p.locator('[data-column="producer"]').uncheck();
    await expect(p.locator(".asset-data-table .col-producer")).toHaveCount(0);
    await p.getByRole("button", { name: "清除全部", exact: true }).click();
    await expect(p.locator(".asset-data-table tbody tr")).toHaveCount(4);
    await p.getByRole("textbox", { name: "搜索资产", exact: true }).fill("没有此资产");
    await expect(p.locator(".empty")).toContainText("当前授权和筛选条件下没有资源");
    await p.getByRole("button", { name: "清空筛选", exact: true }).click();
    await expect(p.locator(".asset-data-table tbody tr")).toHaveCount(4);
    await ctx.close();
  });

  await check("v17 asset sorting, grid view and directory entry", async () => {
    const { p, ctx } = await fresh("#/assets?env=main&project=all");
    await p.getByRole("button", { name: "图标视图", exact: true }).click();
    await expect(p.locator(".asset-v17-card")).toHaveCount(4);
    await p.getByRole("button", { name: "列表视图", exact: true }).click();
    await p.getByRole("combobox", { name: "资产排序", exact: true }).click();
    await p.getByRole("option", { name: "名称：升序", exact: true }).click();
    const first = await p.locator(".asset-data-table tbody tr").first().innerText();
    assert.match(first, /历史视觉/);
    await p.getByRole("button", { name: "目录整理", exact: true }).click();
    await expect(p.locator('[data-od-id="asset-directory"]')).toBeVisible();
    await expect(p.locator('[data-od-id="asset-directory"]')).toContainText("视觉与参考");
    await ctx.close();
  });

  await check("v17 asset detail preserves compact attribution and content states", async () => {
    const { p, ctx } = await fresh("#/assets?env=main&project=all");
    await openAssetDetail(p, "asset-image");
    await expect(p.locator(".asset-detail")).toContainText("生产者");
    await expect(p.locator(".asset-detail")).toContainText("上传者");
    await expect(p.locator(".asset-detail")).toContainText("当前负责人");
    await expect(p.locator(".asset-detail")).toContainText("参考字节可预览");
    await expect(p.locator(".asset-detail .media-stage img")).toBeVisible();
    await closeDetail(p);
    await openAssetDetail(p, "asset-audio");
    await expect(p.locator(".asset-detail")).toContainText("有引用，无字节");
    await expect(p.locator(".asset-detail audio, .asset-detail video, .asset-detail img")).toHaveCount(0);
    await closeDetail(p);
    await openAssetDetail(p, "asset-denied");
    await expect(p.locator(".asset-detail")).toContainText("无内容读取权限");
    await expect(p.locator(".asset-detail audio, .asset-detail video, .asset-detail img")).toHaveCount(0);
    await closeDetail(p);
    await openAssetDetail(p, "asset-missing");
    await expect(p.locator(".asset-detail")).toContainText("来源未采集");
    await expect(p.locator(".asset-detail")).toContainText("个人归因未知");
    await shot(p, "v17-asset-detail");
    await ctx.close();
  });

  await check("v17 asset detail responsive split and local preview stays ephemeral", async () => {
    const { p, ctx } = await fresh("#/assets?env=main&project=all");
    await p.setViewportSize({ width: 390, height: 844 });
    await openAssetDetail(p, "asset-image");
    await expect.poll(() => p.locator(".asset-workspace-grid").evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(" ").length)).toBe(1);
    await closeDetail(p);
    await p.setViewportSize({ width: 1440, height: 1000 });
    await openAssetDetail(p, "asset-image");
    await p.getByRole("button", { name: "展开全屏详情", exact: true }).click();
    await expect.poll(() => p.locator(".asset-properties").evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBe(320);
    await p.getByRole("button", { name: "还原详情", exact: true }).click();
    await closeDetail(p);
    const chooser = p.waitForEvent("filechooser");
    await p.getByRole("button", { name: "本地文件预览", exact: true }).click();
    await (await chooser).setFiles({
      name: "local-v17.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("v17 local preview"),
    });
    const modal = p.locator(".modal");
    await expect(modal).toContainText("本地预览 · 未上传");
    const stored = await p.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    assert.equal(stored.includes("local-v17.txt"), false);
    await p.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await ctx.close();
  });
}
