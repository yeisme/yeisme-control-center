/* 原型交互：主题、筛选、预览灯箱、命令面板、未落地页面提示。 */
(function () {
  const root = document.documentElement;
  const KEY = 'yeisme.studio.theme';
  const filterState = { kind: 'all', project: 'all' };

  function applyFilters() {
    document.querySelectorAll('[data-work-kind]').forEach(function (card) {
      const kindOk = filterState.kind === 'all' || card.dataset.workKind === filterState.kind;
      const projectOk = filterState.project === 'all' || card.dataset.project === filterState.project;
      card.hidden = !(kindOk && projectOk);
    });
    const counter = document.querySelector('[data-filter-count]');
    if (counter) counter.textContent = String(document.querySelectorAll('[data-work-kind]:not([hidden])').length);
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.setAttribute('aria-label', theme === 'light' ? '切换到深色' : '切换到浅色');
      button.dataset.theme = theme;
    });
  }
  const saved = localStorage.getItem(KEY);
  if (saved) applyTheme(saved);

  document.addEventListener('click', function (event) {
    const toggle = event.target.closest('[data-theme-toggle]');
    if (toggle) {
      const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
      localStorage.setItem(KEY, next);
      return;
    }

    const chip = event.target.closest('[data-filter-group] .chip');
    if (chip) {
      const group = chip.closest('[data-filter-group]');
      group.querySelectorAll('.chip').forEach(function (item) { item.classList.toggle('active', item === chip); });
      if (group.dataset.filterBy === 'project') filterState.project = chip.dataset.filter || 'all';
      else filterState.kind = chip.dataset.filter || 'all';
      applyFilters();
      return;
    }

    const card = event.target.closest('[data-preview]');
    if (card) {
      event.preventDefault();
      openLightbox(card.dataset.preview, card.dataset.previewTitle || '', card.dataset.previewMeta || '');
      return;
    }
    if (event.target.closest('[data-close-lightbox]') || event.target.classList.contains('lightbox')) closeLightbox();

    const pending = event.target.closest('[data-soon]');
    if (pending) {
      event.preventDefault();
      toast(pending.dataset.soon || '这一屏还在画，先看今天。');
      return;
    }

    if (event.target.closest('[data-open-palette]')) { event.preventDefault(); openPalette(); }
    if (event.target.closest('[data-close-palette]') || event.target.classList.contains('palette')) closePalette();
  });

  document.addEventListener('keydown', function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openPalette(); }
    if (event.key === 'Escape') { closeLightbox(); closePalette(); }
    if (event.key === 'Enter' && document.activeElement && document.activeElement.matches('[data-palette-item]')) document.activeElement.click();
  });

  let lightbox;
  function openLightbox(src, title, meta) {
    closeLightbox();
    lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.innerHTML = '<div class="lightbox__panel" role="dialog" aria-modal="true" aria-label="' + escapeHtml(title || '预览') + '">' +
      '<div class="lightbox__media"><img alt="' + escapeHtml(title || '预览') + '" src="' + escapeHtml(src) + '"></div>' +
      '<div class="lightbox__bar"><div><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(meta) + '</span></div>' +
      '<button class="btn btn-ghost btn-sm" data-close-lightbox type="button">关闭</button></div></div>';
    document.body.appendChild(lightbox);
    requestAnimationFrame(function () { lightbox.classList.add('is-open'); });
  }
  function closeLightbox() {
    if (!lightbox) return;
    const node = lightbox;
    lightbox = null;
    node.classList.remove('is-open');
    setTimeout(function () { node.remove(); }, 160);
  }

  let palette;
  const paletteItems = [
    { label: '继续第 3 集', hint: '雨夜重逢', href: 'drama.html' },
    { label: '挑一个「站台 · 人群背景」', hint: '待你挑选', href: 'works.html' },
    { label: '看今天的 34 个结果', hint: '作品', href: 'works.html' },
    { label: '回查「旧车站 · 转场镜头」', hint: '结果未知', href: 'today.html' },
    { label: '切换主题', hint: '外观', action: 'theme' }
  ];
  function openPalette() {
    if (palette) return;
    palette = document.createElement('div');
    palette.className = 'palette';
    palette.innerHTML = '<div class="palette__panel" role="dialog" aria-modal="true" aria-label="搜索">' +
      '<div class="palette__input"><svg class="i"><use href="#i-search"/></svg><input aria-label="搜索作品、任务" placeholder="搜索作品、任务，或者直接说你想做什么" autofocus><span class="kbd">ESC</span></div>' +
      '<ul class="palette__list">' + paletteItems.map(function (item, index) {
        return '<li><button type="button" data-palette-item="' + index + '" ' + (item.href ? 'data-href="' + item.href + '"' : 'data-action="' + item.action + '"') + '><span>' + item.label + '</span><em>' + item.hint + '</em></button></li>';
      }).join('') + '</ul></div>';
    document.body.appendChild(palette);
    palette.querySelectorAll('[data-palette-item]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (button.dataset.href) location.href = button.dataset.href;
        else if (button.dataset.action === 'theme') { const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light'; applyTheme(next); localStorage.setItem(KEY, next); closePalette(); }
      });
    });
    requestAnimationFrame(function () { palette.classList.add('is-open'); palette.querySelector('input').focus(); });
  }
  function closePalette() {
    if (!palette) return;
    const node = palette;
    palette = null;
    node.classList.remove('is-open');
    setTimeout(function () { node.remove(); }, 160);
  }

  let toastTimer;
  function toast(text) {
    let node = document.querySelector('.prototype-toast');
    if (!node) {
      node = document.createElement('div');
      node.className = 'prototype-toast';
      node.setAttribute('role', 'status');
      document.body.appendChild(node);
    }
    node.textContent = text;
    node.classList.add('is-open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('is-open'); }, 2400);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
})();
