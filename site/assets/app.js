// Tab bar + per-tab sub-section filter + cross-tab anchor navigation
// for AI Creative Daily.
//
// — Top-level tabs follow the WAI-ARIA 1.2 tabs pattern (arrow keys move
//   focus + activate). Only the active tab is in the tab order.
//
// — Per-tab .section-filter is a radiogroup of .section-chip buttons
//   (single-select mutually exclusive). Arrow keys move between chips.
//   Clicking a chip hides sibling .sub-section blocks via [hidden].
//   Switching main tabs resets the destination tab's filter to "全部".
//
// — Cross-tab anchor navigation: clicking a source_link like
//   <a href="#pulse.chinese_community.0:oschina-d4a8f923"> finds the
//   element, identifies its containing .tab-panel, activates that tab,
//   then scrolls to the element. Without this the link silently no-ops
//   because the destination tab is display:none.
//
// — All non-anchor external links get target="_blank" rel="noopener"
//   applied on load (replaces the prior <base target="_blank"> which
//   broke internal anchors).

// Auto-reload when a newer daily report is available.
// GitHub Pages serves HTML with Cache-Control: max-age=600. We can't override
// it (no _headers on github.io), so client-side staleness detection. Each day
// gets one guarded reload attempt; cache-busting query param forces a fresh
// fetch from the CDN even if the stale copy is still in browser cache.
(() => {
  if (location.pathname.includes('/archive/')) return;
  const pageDate = document.querySelector('time[datetime]')?.dateTime;
  if (!pageDate) return;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  if (pageDate >= today) return;
  // Don't try reload before ~04:30 Asia/Taipei — pipeline isn't done yet.
  const taipeiHour = Number(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei', hour: 'numeric', hour12: false }),
  );
  if (Number.isFinite(taipeiHour) && taipeiHour < 5) return;
  const guardKey = `ai-daily-report.reloaded-for-${today}`;
  if (sessionStorage.getItem(guardKey)) return;
  fetch(`/ai-daily-report/archive/${today}.html`, { method: 'HEAD', cache: 'no-store' })
    .then((res) => {
      if (!res.ok) return;
      sessionStorage.setItem(guardKey, '1');
      // Force a fresh fetch with a cache-busting param so the CDN-cached
      // stale copy can't satisfy the reload from browser cache.
      const url = new URL(location.href);
      url.searchParams.set('v', today);
      location.replace(url.toString());
    })
    .catch(() => {});
})();

// External-link upgrade — opens off-site links in new tab, leaves internal
// #anchors alone. Runs once at startup.
(() => {
  const here = location.hostname;
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) return;
    if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) return;
    try {
      const url = new URL(href, location.href);
      if (url.hostname && url.hostname !== here) {
        a.target = '_blank';
        a.rel = `${a.rel ? `${a.rel} ` : ''}noopener noreferrer`.trim();
      }
    } catch {
      // ignore malformed hrefs
    }
  });
})();

(() => {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = document.querySelectorAll('.tab-panel');
  // Mark body as JS-loaded so the panelIn animation only runs AFTER initial
  // paint — prevents FOUC flash when a hash deep-link switches the active
  // tab post-parse (the original active panel would animate in, then flash
  // out to the target panel). Class is added after first activateTab call.
  let firstActivation = true;

  // Footer "Sources" pill visibility — hide source-status pills whose
  // data-tabs doesn't include the active tab. 訊號 is a synthesis
  // tabs that read from every source, so all pills stay visible there.
  const sourcesContainer = document.querySelector('.sources');
  const allSourcePills = sourcesContainer
    ? Array.from(sourcesContainer.querySelectorAll('.source-status'))
    : [];
  const tabLabelEl = sourcesContainer?.querySelector('.sources-tab-name');
  const tabCountEl = sourcesContainer?.querySelector('.sources-count');
  const TAB_LABELS = {
    signals: '綜合',
    catalog: '精選',
    shipped: '上線',
    pulse: '脈動',
    market: '市場',
    tech: '技術',
  };
  const isSynthesisTab = (id) => id === 'signals';

  const updateSourcesFor = (id) => {
    if (!sourcesContainer) return;
    let visibleCount = 0;
    allSourcePills.forEach((pill) => {
      const tabsAttr = (pill.dataset.tabs || '').split(',').filter(Boolean);
      const show = isSynthesisTab(id) || tabsAttr.includes(id);
      pill.hidden = !show;
      if (show) visibleCount += 1;
    });
    if (tabLabelEl) tabLabelEl.textContent = TAB_LABELS[id] || '綜合';
    if (tabCountEl) {
      tabCountEl.textContent = isSynthesisTab(id)
        ? `· ${visibleCount}（合成自全部）`
        : `· ${visibleCount}`;
    }
  };

  // Per-tab .section-filter helpers — chip is a [role="radio"] in a
  // [role="radiogroup"], so aria-checked is the truth source (not the
  // .active class — both stay in sync).
  const resetPanelFilter = (panel) => {
    const chips = panel.querySelectorAll('.section-chip');
    chips.forEach((c) => {
      const isAll = c.dataset.filter === 'all';
      c.classList.toggle('active', isAll);
      c.setAttribute('aria-checked', isAll ? 'true' : 'false');
      c.setAttribute('tabindex', isAll ? '0' : '-1');
    });
    panel.querySelectorAll('.sub-section').forEach((sub) => {
      sub.hidden = false;
    });
  };

  const applyPanelFilter = (panel, filter) => {
    panel.querySelectorAll('.sub-section').forEach((sub) => {
      sub.hidden = filter !== 'all' && sub.dataset.subsection !== filter;
    });
  };

  const activateTab = (id, { focus = false, resetScroll = true } = {}) => {
    let activeTab = null;
    let activePanel = null;
    tabs.forEach((t) => {
      const isActive = t.dataset.tab === id;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      t.setAttribute('tabindex', isActive ? '0' : '-1');
      if (isActive) activeTab = t;
    });
    panels.forEach((p) => {
      const isActive = p.id === id;
      p.classList.toggle('active', isActive);
      if (isActive) activePanel = p;
    });
    // Reset the destination panel's sub-section filter to 'all' so each tab
    // visit starts with everything visible.
    if (activePanel) resetPanelFilter(activePanel);
    updateSourcesFor(id);
    if (focus && activeTab) {
      activeTab.focus();
    } else if (resetScroll) {
      // Direct click activations scroll to page top so the user lands at
      // the active tab's content. Programmatic activations (cross-tab xref,
      // popstate) preserve scroll position.
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    if (firstActivation) {
      firstActivation = false;
      document.body.classList.add('js-loaded');
    }
  };

  tabs.forEach((tab, idx) => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      history.pushState(null, '', `#${tab.dataset.tab}`);
      activateTab(tab.dataset.tab);
    });

    tab.addEventListener('keydown', (e) => {
      let targetIdx = null;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          targetIdx = (idx + 1) % tabs.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          targetIdx = (idx - 1 + tabs.length) % tabs.length;
          break;
        case 'Home':
          targetIdx = 0;
          break;
        case 'End':
          targetIdx = tabs.length - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      const next = tabs[targetIdx];
      history.pushState(null, '', `#${next.dataset.tab}`);
      activateTab(next.dataset.tab, { focus: true });
    });
  });

  // Per-tab radiogroup chips — click + arrow key navigation.
  const chips = Array.from(document.querySelectorAll('.section-chip'));
  chips.forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const panel = chip.closest('.tab-panel');
      if (!panel) return;
      const filter = chip.dataset.filter;
      panel.querySelectorAll('.section-chip').forEach((c) => {
        const active = c === chip;
        c.classList.toggle('active', active);
        c.setAttribute('aria-checked', active ? 'true' : 'false');
        c.setAttribute('tabindex', active ? '0' : '-1');
      });
      applyPanelFilter(panel, filter);
    });

    chip.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        return;
      }
      const panel = chip.closest('.tab-panel');
      if (!panel) return;
      const panelChips = Array.from(panel.querySelectorAll('.section-chip'));
      const idx = panelChips.indexOf(chip);
      let next = idx;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = (idx + 1) % panelChips.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          next = (idx - 1 + panelChips.length) % panelChips.length;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = panelChips.length - 1;
          break;
      }
      e.preventDefault();
      panelChips[next].focus();
      panelChips[next].click();
    });
  });

  // Cross-tab anchor navigation. Source_link <a href="#qualified.id.path">
  // links jump to elements inside other tab panels — but those panels are
  // display:none, so without intercepting we'd silently scroll nowhere.
  // Here: find the element, find its containing .tab-panel, activate that
  // tab (without scroll-to-top), then scroll the element into view.
  const findContainingTab = (el) => {
    const panel = el.closest('.tab-panel');
    return panel?.id ?? null;
  };
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;
    const hash = link.getAttribute('href');
    if (!hash || hash === '#') return;
    // Skip if it's a tab-bar tab link — those have their own handler.
    if (link.matches('[role="tab"]')) return;
    // Skip the skip-link to main content.
    if (hash === '#main-content') return;
    const targetId = hash.slice(1);
    const target = document.getElementById(targetId);
    if (!target) return;
    e.preventDefault();
    const tabId = findContainingTab(target);
    if (tabId) {
      const isAlreadyActive = document.querySelector(`[role="tab"].active`)?.dataset.tab === tabId;
      if (!isAlreadyActive) {
        history.pushState(null, '', `#${targetId}`);
        activateTab(tabId, { resetScroll: false });
      }
    }
    // Use rAF so the panel's display:block transition is committed before scroll.
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Highlight pulse so user notices where they landed.
      target.classList.add('xref-target');
      setTimeout(() => target.classList.remove('xref-target'), 1600);
    });
  });

  // Respond to back/forward navigation and initial hash.
  // popstate / hashchange shouldn't scroll-to-top (browser handles scroll
  // restoration); only click activations do.
  const onHash = ({ source = 'hash' } = {}) => {
    const id = location.hash.slice(1);
    if (!id) return;
    // If hash matches a tab id, activate that tab.
    if (document.querySelector(`[role="tab"][data-tab="${CSS.escape(id)}"]`)) {
      activateTab(id, { resetScroll: source === 'click' });
      return;
    }
    // Otherwise it's a deep-anchor — find element, activate containing tab.
    const target = document.getElementById(id);
    if (!target) return;
    const tabId = findContainingTab(target);
    if (tabId) {
      activateTab(tabId, { resetScroll: false });
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };
  window.addEventListener('hashchange', () => onHash({ source: 'hash' }));
  if (location.hash) {
    onHash({ source: 'hash' });
  } else {
    const initialTab = document.querySelector('[role="tab"].active')?.dataset.tab;
    if (initialTab) updateSourcesFor(initialTab);
    document.body.classList.add('js-loaded');
  }
})();

// Legacy v1.x in-pane controls (kept for archive page rendering only).
// v1 archive pages use lens/ai-builder.njk which has .filter-btn + .pulse-btn.
// These handlers are no-ops on v2 today's-report pages where the markup
// doesn't exist.
(() => {
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const filter = btn.dataset.filter;
      const panel = btn.closest('.tab-panel') || document;
      panel.querySelectorAll('.filter-btn').forEach((b) => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      panel.querySelectorAll('.filter-group').forEach((g) => {
        if (filter === 'all') {
          g.classList.remove('hidden');
        } else {
          g.classList.toggle('hidden', g.dataset.group !== filter);
        }
      });
    });
  });

  document.querySelectorAll('.pulse-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const mode = btn.dataset.mode;
      document.querySelectorAll('.pulse-btn').forEach((b) => {
        const active = b.dataset.mode === mode;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      document.querySelectorAll('.pulse-mode').forEach((m) => {
        m.classList.toggle('active', m.id === `pulse-${mode}`);
      });
    });
  });
})();

// Lens-tab controller — distinct from the report-internal [role="tab"]
// driver above. Selects [data-lens-tab] to avoid namespace collision.
// Hash pattern is #lens=<id>, distinct from in-pane hashes.
(() => {
  const lensTabs = Array.from(document.querySelectorAll('[data-lens-tab]'));
  const lensPanes = Array.from(document.querySelectorAll('.lens-pane'));
  if (lensTabs.length === 0) return;

  const activateLens = (id) => {
    lensTabs.forEach((t) => {
      const active = t.dataset.lensTab === id;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    lensPanes.forEach((p) => {
      p.hidden = p.id !== `lens-${id}`;
    });
  };

  lensTabs.forEach((tab) => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const id = tab.dataset.lensTab;
      history.pushState(null, '', `#lens=${id}`);
      activateLens(id);
    });
  });

  const lensMatch = location.hash.match(/^#lens=([a-z0-9-]+)$/);
  if (lensMatch) {
    const id = lensMatch[1];
    if (lensTabs.some((t) => t.dataset.lensTab === id)) {
      activateLens(id);
    }
  }

  window.addEventListener('hashchange', () => {
    const m = location.hash.match(/^#lens=([a-z0-9-]+)$/);
    if (m) activateLens(m[1]);
  });
})();
