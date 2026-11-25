import { chromium } from 'playwright';
const exe = '/home/yeshugen/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const base = 'http://127.0.0.1:4330/design-proposals/c-end-studio-v19/prototype/';
const browser = await chromium.launch({ executablePath: exe });
const results = {};
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

// works: filters + lightbox
await page.goto(base + 'works.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const visible = () => page.evaluate(() => document.querySelectorAll('[data-work-kind]:not([hidden])').length);
results['works.visibleAll'] = await visible();
await page.click('[data-filter-group][data-filter-by="kind"] .chip[data-filter="video"]');
results['works.visibleVideo'] = await visible();
await page.click('[data-filter-group][data-filter-by="kind"] .chip[data-filter="image"]');
results['works.visibleImage'] = await visible();
await page.click('[data-filter-group][data-filter-by="project"] .chip[data-filter="coast"]');
results['works.visibleImageCoast'] = await visible();
await page.click('[data-filter-group][data-filter-by="kind"] .chip[data-filter="all"]');
await page.click('[data-filter-group][data-filter-by="project"] .chip[data-filter="all"]');
results['works.visibleReset'] = await visible();
await page.click('.work__frame');
await page.waitForTimeout(300);
results['works.lightboxOpen'] = await page.locator('.lightbox.is-open').count();
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
results['works.lightboxClosed'] = await page.locator('.lightbox').count();

// today: palette + theme
await page.goto(base + 'today.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.click('[data-open-palette]');
await page.waitForTimeout(250);
results['today.paletteOpen'] = await page.locator('.palette.is-open').count();
results['today.paletteItems'] = await page.locator('.palette__list button').count();
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
results['today.paletteClosed'] = await page.locator('.palette').count();
await page.click('[data-theme-toggle]');
results['today.themeAfterToggle'] = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
await page.click('[data-theme-toggle]');
results['today.themeBack'] = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
await page.click('.hero .btn-primary');
results['today.continueHref'] = page.url().split('/').pop();

// global a11y-ish checks per page
const pages = ['today.html','works.html','drama.html','mobile.html','index.html'];
const checks = {};
for (const name of pages) {
  const p = await browser.newPage({ viewport: { width: name === 'mobile.html' ? 390 : 1440, height: 900 } });
  await p.goto(base + name, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  checks[name] = await p.evaluate(() => {
    const buttons = [...document.querySelectorAll('button, a')];
    const unnamed = buttons.filter(el => {
      const text = (el.textContent || '').trim();
      const label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
      return !text && !label;
    }).length;
    const imgs = [...document.images];
    return {
      h1: document.querySelectorAll('h1').length,
      buttons: buttons.length,
      unnamedControls: unnamed,
      imgs: imgs.length,
      imgsWithoutAlt: imgs.filter(i => !i.hasAttribute('alt')).length,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      title: document.title,
    };
  });
  await p.close();
}
results['checks'] = checks;
results['consoleErrors'] = errors;
console.log(JSON.stringify(results, null, 2));
await browser.close();
