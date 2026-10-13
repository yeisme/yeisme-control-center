import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.CONTROL_CENTER_URL || "http://127.0.0.1:4320";
const area = path.resolve(
  "temp/integration-test-runs/visual-v7-" +
    new Date().toISOString().replace(/[:.]/g, "-"),
);
await fs.mkdir(area + "/artifacts", { recursive: true });
await fs.writeFile(
  area + "/command.txt",
  "CONTROL_CENTER_URL=" + base + " node scripts/inspect-ui.mjs\n",
);
await fs.writeFile(
  area + "/env.json",
  JSON.stringify({ base, synthetic_data: true }),
);
await fs.writeFile(area + "/stdout.log", "");
await fs.writeFile(area + "/stderr.log", "");
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const errors = [],
  results = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  for (const view of ["members", "tasks", "services", "overview", "settings"]) {
    await page.goto(base + "#/" + view + "?env=main&project=rain", {
      waitUntil: "networkidle",
    });
    if (view === "tasks")
      await page.getByRole("tab", { name: /请求历史/ }).click();
    await page.screenshot({
      path: area + "/artifacts/" + view + ".png",
      animations: "disabled",
    });
    const first = await page
      .locator("tbody tr")
      .first()
      .boundingBox()
      .catch(() => null);
    results.push({
      view,
      firstRow: first,
      overflow: await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    });
    if (view === "members") {
      await page.getByRole("button", { name: "邀请成员", exact: true }).click();
      await page.screenshot({
        path: area + "/artifacts/member-sheet.png",
        animations: "disabled",
      });
    }
  }
  await page.goto(base + "#/tasks?env=main&project=rain", {
    waitUntil: "networkidle",
  });
  await page.getByRole("tab", { name: /请求历史/ }).click();
  await page.locator("tbody tr").first().locator("td").nth(1).click();
  await page.getByRole("tab", { name: "内容", exact: true }).click();
  await page.screenshot({
    path: area + "/artifacts/request-sheet.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: area + "/artifacts/mobile-requests.png",
    animations: "disabled",
  });
} catch (e) {
  errors.push(e.message);
} finally {
  await browser.close();
}
const summary = {
  status: errors.length ? "failed" : "passed",
  results,
  errors,
};
await fs.writeFile(area + "/summary.json", JSON.stringify(summary, null, 2));
await fs.writeFile(area + "/stderr.log", errors.join("\n"));
console.log(JSON.stringify({ area, ...summary }));
