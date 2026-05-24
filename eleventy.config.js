import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sanitizeHtml from 'sanitize-html';
import YAML from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.join(__dirname, 'data', 'reports');

// Theme bundle integration. ui-strings.yaml + theme.yaml are exposed
// as Eleventy global data; section partials in
// themes/$ACTIVE_THEME/sections/ are reachable via Nunjucks search
// paths. The legacy v2/section-*.njk partials still drive the current
// rendering path; future template edits can switch to theme-relative
// includes without changing the build pipeline.
const ACTIVE_THEME = process.env.ACTIVE_THEME || 'ai-builder';

function loadThemeUiStrings(themeName) {
  const p = path.join(__dirname, 'themes', themeName, 'ui-strings.yaml');
  if (!fs.existsSync(p)) return null;
  try {
    return YAML.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error(`[eleventy] theme ui-strings parse failed: ${err.message}`);
    return null;
  }
}

// List YYYY-MM-DD.json files in data/reports/, newest first.
function getReportFiles() {
  if (!fs.existsSync(reportsDir)) return [];
  return fs
    .readdirSync(reportsDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();
}

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy('site/assets');

  // Cache-busting: build timestamp appended to asset URLs so CDN/browser
  // caches are invalidated on every deploy.
  eleventyConfig.addGlobalData('cacheBust', () => Date.now());

  // Theme bundle globals.
  eleventyConfig.addGlobalData('ACTIVE_THEME', ACTIVE_THEME);
  const ui = loadThemeUiStrings(ACTIVE_THEME);
  if (ui) eleventyConfig.addGlobalData('uiStrings', ui);
  const themeManifestPath = path.join(__dirname, 'themes', ACTIVE_THEME, 'theme.yaml');
  if (fs.existsSync(themeManifestPath)) {
    try {
      eleventyConfig.addGlobalData('theme', YAML.parse(fs.readFileSync(themeManifestPath, 'utf8')));
    } catch (err) {
      console.error(`[eleventy] theme.yaml parse failed: ${err.message}`);
    }
  }

  // --- Filters ---

  eleventyConfig.addFilter('dayOfWeek', (dateStr) => {
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    return days[new Date(`${dateStr}T00:00:00`).getDay()];
  });

  eleventyConfig.addFilter('safeSlug', (str) => {
    return encodeURIComponent(str).replace(/%/g, '').toLowerCase().slice(0, 30);
  });

  eleventyConfig.addFilter('formatNum', (num) => {
    if (!num && num !== 0) return '';
    return Number(num).toLocaleString();
  });

  eleventyConfig.addFilter('hostname', (url) => {
    if (typeof url !== 'string') return '';
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  });

  // --- HTML sanitization ---
  // LLM-generated HTML is sanitized at data-load time to close the indirect
  // XSS path (compromised RSS → prompt injection → malicious HTML in report).
  // Allows only safe tags/attributes used by the agent's output format.

  const SANITIZE_OPTS = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h3', 'h4', 'h5', 'details', 'summary']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ['href', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https'],
  };

  function sanitizeReport(report) {
    if (!report || typeof report !== 'object') return report;
    const s = (v) => (typeof v === 'string' ? sanitizeHtml(v, SANITIZE_OPTS) : v);

    if (report.lead?.html) report.lead.html = s(report.lead.html);

    // v2.0 (schema_version === 2): signals is an object; predictions live inside it.
    if (report.schema_version === 2) {
      const sig = report.signals ?? {};
      for (const focus of sig.focus ?? []) {
        if (focus.body) focus.body = s(focus.body);
        if (focus.evidence) focus.evidence = s(focus.evidence);
      }
      if (sig.sleeper?.body) sig.sleeper.body = s(sig.sleeper.body);
      if (sig.contrarian?.body) sig.contrarian.body = s(sig.contrarian.body);
      for (const pred of sig.predictions ?? []) {
        if (pred.text) pred.text = s(pred.text);
        if (pred.rationale) pred.rationale = s(pred.rationale);
      }
      return report;
    }

    // Legacy v1.x: signals is a flat array, predictions at top level.
    if (report.contrarian?.body) report.contrarian.body = s(report.contrarian.body);
    if (report.sleeper?.body) report.sleeper.body = s(report.sleeper.body);
    for (const sig of report.signals ?? []) {
      if (sig.body) sig.body = s(sig.body);
      if (sig.evidence) sig.evidence = s(sig.evidence);
    }
    for (const pred of report.predictions ?? []) {
      if (pred.text) pred.text = s(pred.text);
      if (pred.prediction) pred.prediction = s(pred.prediction);
    }
    return report;
  }

  // --- Global data ---

  // Today's report — latest file in data/reports/
  eleventyConfig.addGlobalData('report', () => {
    const files = getReportFiles();
    if (files.length === 0) {
      return {
        date: new Date().toISOString().slice(0, 10),
        lead: { html: '<p>報告準備中，第一份報告將在明日凌晨自動產出。</p>' },
        ideas: [],
        shipped: [],
        pulse: { curated: [], hn: [], lobsters: [] },
        signals: [],
        predictions: [],
      };
    }
    const raw = JSON.parse(fs.readFileSync(path.join(reportsDir, files[0]), 'utf8'));
    return sanitizeReport(raw);
  });

  // Per-lens reports — scan data/reports/lenses/<lens-id>/ for the latest
  // YYYY-MM-DD.json per lens. Returns { [lensId]: <sanitized report> } so
  // templates can do `{% set lens = lensReports['phison-aidaptiv'] %}` or
  // iterate. Sanitized via the same sanitizeReport used for ai-builder so
  // the indirect-XSS path (compromised RSS → prompt injection → malicious
  // HTML in lens report) is closed for every lens uniformly.
  eleventyConfig.addGlobalData('lensReports', () => {
    const lensesDir = path.join(__dirname, 'data', 'reports', 'lenses');
    if (!fs.existsSync(lensesDir)) return {};

    const result = {};
    for (const lensId of fs.readdirSync(lensesDir)) {
      const lensDir = path.join(lensesDir, lensId);
      if (!fs.statSync(lensDir).isDirectory()) continue;
      const files = fs
        .readdirSync(lensDir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort()
        .reverse();
      if (files.length === 0) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(lensDir, files[0]), 'utf8'));
        result[lensId] = sanitizeReport(raw);
      } catch (err) {
        console.error(`[eleventy] lensReports: failed to read ${lensId}: ${err.message}`);
      }
    }
    return result;
  });

  // Archive links for footer (last 7 dates)
  eleventyConfig.addGlobalData('archiveLinks', () => {
    return getReportFiles()
      .slice(0, 7)
      .map((f) => ({
        date: f.replace('.json', ''),
        url: `archive/${f.replace('.json', '.html')}`,
      }));
  });

  // Archived reports for 11ty pagination (generates /archive/YYYY-MM-DD.html).
  // Capped to the most recent 90 reports to avoid unbounded memory growth
  // as the archive accumulates over time (~30KB × 365 = 10MB/year).
  eleventyConfig.addGlobalData('archiveReports', () => {
    return getReportFiles()
      .slice(0, 90)
      .map((f) => sanitizeReport(JSON.parse(fs.readFileSync(path.join(reportsDir, f), 'utf8'))));
  });

  // Sources status from feeds-snapshot.json, enriched with per-tab routing.
  //
  // Each source pill carries `tabs: [...]` listing which top-level tabs the
  // source actually feeds. The footer template renders these as data-tabs
  // attributes so JS can hide pills irrelevant to the current tab. This
  // gives users discriminating info per tab instead of the same dense list
  // everywhere.
  //
  // Category → tab mapping derived from config.json. GitHub-derived sources
  // (Trending, Topic Discovery, Dev Watch …) aren't in by_source — they're
  // synthesized from report.shipped.<key> at render time and tagged ['shipped'].
  // Sources missing from config (e.g. legacy "NVIDIA Developer" without
  // "Blog" suffix) fall through to OVERRIDE_TABS; unmatched ones default
  // to [] which means "show only on the synthesis tabs" (訊號 / 動手做).
  const CATEGORY_TO_TABS = {
    community: ['pulse'],
    中文社群: ['pulse'],
    'AI 部落格': ['pulse'],
    '系統/底層': ['pulse'],
    'AI 公司': ['tech'],
    論文: ['tech'],
    大廠技術: ['tech'],
    aidaptiv: ['tech'],
    market: ['market'],
    policy: ['market'],
    台灣媒體: ['market'],
  };
  // For snapshot source names that don't match any config.json entry verbatim.
  const OVERRIDE_TABS = {
    'NVIDIA Developer': ['tech'],
    'Phison Blog': ['tech', 'market'],
    'SK Hynix News': ['tech'],
  };

  function loadConfigCategoryMap() {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
      const map = {};
      for (const f of cfg?.sources?.feeds ?? []) {
        if (f?.name && f?.category) map[f.name] = f.category;
      }
      return map;
    } catch {
      return {};
    }
  }

  function shippedSyntheticSources(latestReport) {
    if (latestReport?.schema_version !== 2 || !latestReport?.shipped) return [];
    const groups = [
      ['trending', 'GitHub Trending'],
      ['topic_discovery', 'Topic Discovery'],
      ['dev_watch_taiwan', 'Dev Watch 台灣'],
      ['dev_watch_global', 'Dev Watch 全球'],
    ];
    return groups
      .filter(
        ([key]) => Array.isArray(latestReport.shipped[key]) && latestReport.shipped[key].length > 0,
      )
      .map(([key, name]) => ({
        name,
        ok: true,
        count: latestReport.shipped[key].length,
        tabs: ['shipped'],
      }));
  }

  eleventyConfig.addGlobalData('sourcesStatus', () => {
    const snapshotPath = path.join(__dirname, 'data', 'feeds-snapshot.json');
    if (!fs.existsSync(snapshotPath)) return [];
    let snapshot;
    try {
      snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    } catch (err) {
      throw new Error(`[eleventy] sourcesStatus: failed to read ${snapshotPath}: ${err.message}`);
    }
    if (!snapshot.by_source) return [];

    const categoryMap = loadConfigCategoryMap();
    const feedSources = Object.entries(snapshot.by_source).map(([name, items]) => {
      const category = categoryMap[name];
      const tabs = category ? (CATEGORY_TO_TABS[category] ?? []) : (OVERRIDE_TABS[name] ?? []);
      return {
        name,
        ok: Array.isArray(items) && items.length > 0,
        count: Array.isArray(items) ? items.length : 0,
        tabs,
      };
    });

    // Synthesize shipped-tab entries from the latest report so the 上線 tab
    // footer actually shows GitHub Trending / Topic Discovery / Dev Watch.
    const reportFiles = getReportFiles();
    let latestReport = null;
    if (reportFiles.length > 0) {
      try {
        latestReport = JSON.parse(fs.readFileSync(path.join(reportsDir, reportFiles[0]), 'utf8'));
      } catch {
        // Best-effort: if the report won't parse, just skip shipped synth.
      }
    }
    return [...feedSources, ...shippedSyntheticSources(latestReport)];
  });

  // Community feeds from feeds-snapshot.json (excludes HN and Lobsters)
  eleventyConfig.addGlobalData('rssByCategory', () => {
    const snapshotPath = path.join(__dirname, 'data', 'feeds-snapshot.json');
    if (!fs.existsSync(snapshotPath)) return {};
    try {
      const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      if (!data.by_source) return {};
      const exclude = new Set(['hackernews', 'Lobsters']);
      const filtered = {};
      for (const [source, items] of Object.entries(data.by_source)) {
        if (exclude.has(source)) continue;
        filtered[source] = items;
      }
      return filtered;
    } catch (err) {
      throw new Error(`feeds-snapshot.json parse failed: ${err.message}`);
    }
  });

  eleventyConfig.addGlobalData('config', () => {
    const configPath = path.join(__dirname, 'config.json');
    if (!fs.existsSync(configPath)) {
      throw new Error(`[eleventy] config.json not found at ${configPath}`);
    }
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new Error(`[eleventy] config.json parse failed: ${err.message}`);
    }
  });

  return {
    pathPrefix: '/ai-daily-report/',
    dir: {
      input: 'site',
      output: '_site',
      includes: '_includes',
      data: '_data',
    },
    templateFormats: ['njk', 'md', 'html'],
    htmlTemplateEngine: 'njk',
    markdownTemplateEngine: 'njk',
  };
}
