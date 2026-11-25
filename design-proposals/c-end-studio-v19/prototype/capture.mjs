import { chromium } from 'playwright';
const [url, out, w, h, dpr, full, scroll, theme] = process.argv.slice(2);
const exe = '/home/yeshugen/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(dpr || 1) });
if (theme) await page.addInitScript((value) => localStorage.setItem('yeisme.studio.theme', value), theme);
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1400);
if (scroll) { await page.evaluate((y) => window.scrollTo(0, Number(y)), scroll); await page.waitForTimeout(600); }
await page.screenshot({ path: out, fullPage: full === 'full' });
console.log(JSON.stringify({ status: resp && resp.status(), errors }));
await browser.close();
