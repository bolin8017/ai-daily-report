// Tab bar + filter + pulse mode + hash navigation for AI Creative Daily.
//
// Implements the WAI-ARIA 1.2 tabs pattern with automatic activation:
// Arrow Left/Right (and Up/Down) move focus to adjacent tabs and activate
// them; Home/End jump to first/last. Only the active tab is in the Tab
// order (tabindex=0); inactive tabs are reachable via arrow keys only.
//
// Filter and pulse-mode buttons toggle aria-pressed in lockstep with the
// .active class so assistive tech sees the same state the CSS does.
//
// Filter clicks are scoped to the .tab-panel containing the clicked button
// so activating a filter in one tab doesn't affect sibling tabs.

// Auto-reload when a newer daily report is available.
// GitHub Pages serves HTML with Cache-Control: max-age=600 which we can't
// override (no _headers support on github.io; <meta http-equiv="Cache-Control">
// is ignored by modern browsers). Detect staleness client-side: if the rendered
// report date is before today (Asia/Taipei) and today's archive exists, reload
// once. sessionStorage keyed by today guards against reload loops when the
// browser still serves the stale copy after the first reload.
(() => {
  if (location.pathname.includes('/archive/')) return;
  const pageDate = document.querySelector('time[datetime]')?.dateTime;
  if (!pageDate) return;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  if (pageDate >= today) return;
  const guardKey = `ai-daily-report.reloaded-for-${today}`;
  if (sessionStorage.getItem(guardKey)) return;
  fetch(`/ai-daily-report/archive/${today}.html`, { method: 'HEAD', cache: 'no-store' })
    .then((res) => {
      if (!res.ok) return;
      sessionStorage.setItem(guardKey, '1');
      location.reload();
    })
    .catch(() => {});
})();

(() => {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = document.querySelectorAll('.tab-panel');

  const activateTab = (id, { focus = false } = {}) => {
    let activeTab = null;
    tabs.forEach((t) => {
      const isActive = t.dataset.tab === id;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      t.setAttribute('tabindex', isActive ? '0' : '-1');
      if (isActive) activeTab = t;
    });
    panels.forEach((p) => {
      p.classList.toggle('active', p.id === id);
    });
    if (focus && activeTab) {
      activeTab.focus();
    } else {
      // Only reset scroll on pointer clicks; keyboard arrow navigation
      // should feel like in-place focus movement.
      window.scrollTo({ top: 0, behavior: 'instant' });
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

  // Source filter within each tab panel. Scoped to the panel containing the
  // button so clicks in one tab don't affect sibling tabs.
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

  // Pulse mode toggle (與我相關 / 熱門總覽)
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

  // Respond to back/forward navigation and initial hash
  const onHash = () => {
    const id = location.hash.slice(1);
    if (id && document.getElementById(id)) activateTab(id);
  };
  window.addEventListener('hashchange', onHash);
  if (location.hash) onHash();
})();
