import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sanitizeHtml from 'sanitize-html';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.join(__dirname, 'data', 'reports');

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

  // Sources status from feeds-snapshot.json
  eleventyConfig.addGlobalData('sourcesStatus', () => {
    const snapshotPath = path.join(__dirname, 'data', 'feeds-snapshot.json');
    if (!fs.existsSync(snapshotPath)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      if (!data.by_source) return [];
      return Object.entries(data.by_source).map(([name, items]) => ({
        name,
        ok: Array.isArray(items) && items.length > 0,
        count: Array.isArray(items) ? items.length : 0,
      }));
    } catch (err) {
      throw new Error(`[eleventy] sourcesStatus: failed to read ${snapshotPath}: ${err.message}`);
    }
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
